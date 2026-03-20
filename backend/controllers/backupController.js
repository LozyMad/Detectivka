const XLSX = require('xlsx');
const Scenario = require('../models/scenario');
const Question = require('../models/question');
const Address = require('../models/address');

const SHEET_TRIPS = 'Поездки';
const SHEET_QUESTIONS = 'Вопросы';
const SHEET_CHOICES = 'Выборы';
const COLS_TRIPS = ['Район', 'Номер дома', 'Квартира', 'Информация по адресу'];
const COLS_QUESTIONS = ['Номер вопроса', 'Вопрос'];
const COLS_CHOICES = ['Район', 'Номер дома', 'Квартира', 'Текст варианта выбора', 'Результат', 'Порядок'];

const backupController = {
  // Экспорт одного сценария: XLSX с листами «Поездки», «Вопросы» и «Выборы».
  exportScenarios: async (req, res) => {
    try {
      const scenarioId = req.query.scenario_id ? parseInt(req.query.scenario_id, 10) : null;
      if (!scenarioId || Number.isNaN(scenarioId)) {
        if (typeof res.status === 'function') {
          return res.status(400).json({
            success: false,
            error: 'Выберите сценарий для экспорта (scenario_id)'
          });
        }
        return;
      }

      const scenario = await Scenario.getById(scenarioId);
      if (!scenario) {
        return res.status(404).json({
          success: false,
          error: 'Сценарий не найден'
        });
      }

      const [addresses, questions] = await Promise.all([
        Address.getByScenario(scenarioId),
        Question.getByScenario(scenarioId)
      ]);

      const addrList = Array.isArray(addresses) ? addresses : [];
      const qList = Array.isArray(questions) ? questions : [];

      const tripsRows = [COLS_TRIPS];
      for (const a of addrList) {
        tripsRows.push([
          (a && a.district) || '',
          (a && a.house_number) || '',
          (a && a.apartment) || '',
          (a && a.description) || ''
        ]);
      }

      const questionsRows = [COLS_QUESTIONS];
      qList.forEach((q, i) => {
        const text = (q && q.question_text) || (typeof q === 'string' ? q : '');
        questionsRows.push([i + 1, String(text).replace(/\r?\n/g, ' ')]);
      });

      const choicesRows = [COLS_CHOICES];
      for (const a of addrList) {
        const choices = await Address.getChoices(scenarioId, a.id);
        const list = Array.isArray(choices) ? choices : [];
        list.forEach((c, idx) => {
          const choiceText = (c && (c.choice_text ?? c['choice_text'])) != null ? String(c.choice_text ?? c['choice_text']) : '';
          const responseText = (c && (c.response_text ?? c['response_text'])) != null ? String(c.response_text ?? c['response_text']) : '';
          choicesRows.push([
            (a && a.district) || '',
            (a && a.house_number) || '',
            (a && a.apartment) || '',
            choiceText.replace(/\r?\n/g, ' '),
            responseText.replace(/\r?\n/g, ' '),
            (c && (c.choice_order != null || c.choice_order === 0)) ? c.choice_order : idx + 1
          ]);
        });
      }

      const wb = XLSX.utils.book_new();
      const wsTrips = XLSX.utils.aoa_to_sheet(tripsRows);
      const wsQuestions = XLSX.utils.aoa_to_sheet(questionsRows);
      const wsChoices = XLSX.utils.aoa_to_sheet(choicesRows);
      XLSX.utils.book_append_sheet(wb, wsTrips, SHEET_TRIPS);
      XLSX.utils.book_append_sheet(wb, wsQuestions, SHEET_QUESTIONS);
      XLSX.utils.book_append_sheet(wb, wsChoices, SHEET_CHOICES);

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const safeName = (scenario.name || 'scenario').replace(/[^\w\s-]/g, '').trim() || 'scenario';
      const filename = `${safeName}.xlsx`;

      if (typeof res.setHeader !== 'function') return;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
      res.send(buf);
    } catch (error) {
      console.error('Export error:', error);
      if (res.status && typeof res.status === 'function') {
        res.status(500).json({
          success: false,
          error: 'Ошибка экспорта сценария',
          details: error.message
        });
      } else {
        throw error;
      }
    }
  },

  // Импорт: XLSX с листами «Поездки» и «Вопросы»; лист «Выборы» опционален. Имя сценария — из имени файла.
  importScenarios: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'Файл не загружен'
        });
      }

      const buf = req.file.buffer;
      const wb = XLSX.read(buf, { type: 'buffer' });
      const sheetTrips = wb.Sheets[SHEET_TRIPS];
      const sheetQuestions = wb.Sheets[SHEET_QUESTIONS];
      const sheetChoices = wb.Sheets[SHEET_CHOICES];

      if (!sheetTrips && !sheetQuestions) {
        return res.status(400).json({
          success: false,
          error: 'В файле должны быть листы «Поездки» и «Вопросы»'
        });
      }

      const scenarioName = (req.file.originalname || 'Импорт')
        .replace(/\.(xlsx|xls)$/i, '')
        .trim() || 'Импорт';

      const allScenarios = await Scenario.getAll();
      const existingNames = new Set(allScenarios.map(s => (s.name || '').trim().toLowerCase()));
      if (existingNames.has(scenarioName.trim().toLowerCase())) {
        return res.status(400).json({
          success: false,
          error: `Сценарий с именем «${scenarioName}» уже существует`
        });
      }

      const userId = req.user && req.user.id ? req.user.id : null;
      const newScenario = await Scenario.create({
        name: scenarioName,
        description: '',
        is_active: false,
        created_by: userId
      });
      const scenarioId = newScenario.id;
      const addressKey = (d, h, a) => `${String(d).trim()}\t${String(h).trim()}\t${String(a).trim()}`;
      const addressIdByKey = new Map();

      if (sheetTrips) {
        const rows = XLSX.utils.sheet_to_json(sheetTrips, { header: 1, defval: '' });
        const header = (rows[0] || []).map(String).map(s => s.trim().toLowerCase());
        const districtIdx = header.findIndex(h => h.includes('район'));
        const houseIdx = header.findIndex(h => h.includes('номер') && h.includes('дом'));
        const apartmentIdx = header.findIndex(h => h.includes('кварт'));
        const infoIdx = header.findIndex(h => h.includes('информация') || h.includes('адрес'));
        const d = districtIdx >= 0 ? districtIdx : 0;
        const h = houseIdx >= 0 ? houseIdx : 1;
        const i = infoIdx >= 0 ? infoIdx : 2;
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r] || [];
          const district = String(row[d] ?? '').trim();
          const house_number = String(row[h] ?? '').trim();
          const apartment = apartmentIdx >= 0 ? String(row[apartmentIdx] ?? '').trim() : '';
          if (!district && !house_number) continue;
          const created = await Address.create({
            scenario_id: scenarioId,
            district: district || '-',
            house_number: house_number || '-',
            apartment,
            description: String(row[i] ?? '').trim()
          });
          if (created && created.id) addressIdByKey.set(addressKey(district, house_number, apartment), created.id);
        }
      }

      if (sheetQuestions) {
        const rows = XLSX.utils.sheet_to_json(sheetQuestions, { header: 1, defval: '' });
        const header = (rows[0] || []).map(String).map(s => s.trim().toLowerCase());
        const questionIdx = header.findIndex(x => x.includes('вопрос') && !x.includes('номер'));
        const qCol = questionIdx >= 0 ? questionIdx : 1;
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r] || [];
          const question_text = String(row[qCol] ?? '').trim();
          if (!question_text) continue;
          await Question.create({
            scenario_id: scenarioId,
            question_text
          });
        }
      }

      if (sheetChoices && addressIdByKey.size > 0) {
        const rows = XLSX.utils.sheet_to_json(sheetChoices, { header: 1, defval: '' });
        const header = (rows[0] || []).map(String).map(s => s.trim().toLowerCase());
        const districtIdx = header.findIndex(h => h.includes('район'));
        const houseIdx = header.findIndex(h => h.includes('номер') && h.includes('дом'));
        const apartmentIdx = header.findIndex(h => h.includes('кварт'));
        const choiceIdx = header.findIndex(h => h.includes('текст варианта выбора') || h.includes('вариант выбора') || (h.includes('вариант') && !h.includes('порядок')) || (h.includes('выбор') && !h.includes('порядок')));
        const resultIdx = header.findIndex(h => h.includes('результат') || h.includes('ответ'));
        const orderIdx = header.findIndex(h => h.includes('порядок'));
        const d = districtIdx >= 0 ? districtIdx : 0;
        const h = houseIdx >= 0 ? houseIdx : 1;
        const ch = choiceIdx >= 0 ? choiceIdx : 2;
        const res = resultIdx >= 0 ? resultIdx : 3;
        const ord = orderIdx >= 0 ? orderIdx : 4;
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r] || [];
          const district = String(row[d] ?? '').trim();
          const house_number = String(row[h] ?? '').trim();
          const apartment = apartmentIdx >= 0 ? String(row[apartmentIdx] ?? '').trim() : '';
          const choice_text = String(row[ch] ?? '').trim();
          if (!choice_text) continue;
          const address_id = addressIdByKey.get(addressKey(district, house_number, apartment));
          if (!address_id) continue;
          const response_text = String(row[res] ?? '').trim();
          const order = parseInt(row[ord], 10);
          await Address.createChoice(scenarioId, {
            address_id,
            choice_text,
            response_text,
            choice_order: Number.isNaN(order) ? r : order
          });
        }
      }

      res.json({
        success: true,
        message: 'Импорт завершён',
        imported_count: 1,
        scenario_name: scenarioName
      });
    } catch (error) {
      console.error('Import error:', error);
      res.status(500).json({
        success: false,
        error: 'Ошибка импорта сценария',
        details: error.message
      });
    }
  }
};

module.exports = backupController;
