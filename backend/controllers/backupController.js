const XLSX = require('xlsx');
const Scenario = require('../models/scenario');
const Question = require('../models/question');
const Address = require('../models/address');

const SHEET_TRIPS = 'Поездки';
const SHEET_QUESTIONS = 'Вопросы';
const COLS_TRIPS = ['Район', 'Номер дома', 'Информация по адресу'];
const COLS_QUESTIONS = ['Номер вопроса', 'Вопрос'];

const backupController = {
  // Экспорт одного сценария: XLSX с листами «Поездки» и «Вопросы».
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

      const tripsRows = [COLS_TRIPS];
      for (const a of addresses) {
        tripsRows.push([
          a.district || '',
          a.house_number || '',
          a.description || ''
        ]);
      }

      const questionsRows = [COLS_QUESTIONS];
      questions.forEach((q, i) => {
        questionsRows.push([i + 1, (q.question_text || '').replace(/\r?\n/g, ' ')]);
      });

      const wb = XLSX.utils.book_new();
      const wsTrips = XLSX.utils.aoa_to_sheet(tripsRows);
      const wsQuestions = XLSX.utils.aoa_to_sheet(questionsRows);
      XLSX.utils.book_append_sheet(wb, wsTrips, SHEET_TRIPS);
      XLSX.utils.book_append_sheet(wb, wsQuestions, SHEET_QUESTIONS);

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

  // Импорт: только XLSX с листами «Поездки» и «Вопросы». Имя сценария — из имени файла.
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

      if (sheetTrips) {
        const rows = XLSX.utils.sheet_to_json(sheetTrips, { header: 1, defval: '' });
        const header = (rows[0] || []).map(String).map(s => s.trim().toLowerCase());
        const districtIdx = header.findIndex(h => h.includes('район'));
        const houseIdx = header.findIndex(h => h.includes('номер') && h.includes('дом'));
        const infoIdx = header.findIndex(h => h.includes('информация') || h.includes('адрес'));
        const d = districtIdx >= 0 ? districtIdx : 0;
        const h = houseIdx >= 0 ? houseIdx : 1;
        const i = infoIdx >= 0 ? infoIdx : 2;
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r] || [];
          const district = String(row[d] ?? '').trim();
          const house_number = String(row[h] ?? '').trim();
          if (!district && !house_number) continue;
          await Address.create({
            scenario_id: scenarioId,
            district: district || '-',
            house_number: house_number || '-',
            description: String(row[i] ?? '').trim()
          });
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
