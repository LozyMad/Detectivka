const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { zipSync, unzipSync } = require('fflate');
const Scenario = require('../models/scenario');
const Address = require('../models/address');
const Question = require('../models/question');
const InternetPage = require('../models/internetPage');
const applications = require('./scenarioApplications');
const banners = require('./scenarioBanner');

const MAX_BYTES = 250 * 1024 * 1024;
const MAX_FILES = 10000;
const FORMAT = 'detectum-scenario';
const flag = value => value === true || value === 1 || value === '1';
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
function safePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || /[:\x00-\x1f]/.test(value) ||
      value.split('/').some(part => !part || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(part))) {
    throw invalid('Некорректный путь в пакете сценария');
  }
  return value;
}
function positiveId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid('Некорректный идентификатор в пакете');
  return value;
}
function text(value, label) {
  if (typeof value !== 'string') throw invalid(`Некорректное поле: ${label}`);
  return value;
}
function list(value, label) {
  if (!Array.isArray(value) || value.length > MAX_FILES || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw invalid(`Некорректный список: ${label}`);
  return value;
}

async function exportPackage(scenario, workbook) {
  const entries = Object.create(null);
  let total = 0;
  function add(name, buffer) {
    total += buffer.length;
    if (total > MAX_BYTES || Object.keys(entries).length >= MAX_FILES) throw invalid('Пакет сценария превышает 250 МБ или 10000 файлов');
    entries[safePath(name)] = buffer;
    return { path: name, size: buffer.length, sha256: hash(buffer) };
  }
  async function exportFiles(files, prefix, getFile) {
    const result = [];
    for (const file of files) {
      const stored = await getFile(file.id);
      if (!stored) throw new Error(`Файл приложения не найден: ${file.name}`);
      const buffer = await fs.readFile(stored.path);
      const extension = path.extname(file.name).toLowerCase();
      const ref = add(`${prefix}/${result.length + 1}${extension}`, buffer);
      result.push({ ...ref, name: file.name, type: file.type });
    }
    return result;
  }
  const [addresses, questions, pages, briefing] = await Promise.all([
    Address.getByScenario(scenario.id), Question.getByScenario(scenario.id, true),
    InternetPage.getByScenario(scenario.id), applications.getBriefing(scenario.id)
  ]);
  const manifest = {
    format: FORMAT, version: 1,
    scenario: { name: scenario.name, description: scenario.description || '' },
    addresses: [], questions: questions.map((q, i) => ({ question_text: q.question_text, question_order: q.question_order ?? i + 1, is_active: q.is_active == null ? true : flag(q.is_active) })),
    internet_pages: pages.map(p => ({ title: p.title, content_html: p.content_html,
      cafe_address_id: Number(p.cafe_address_id), unlock_address_id: Number(p.unlock_address_id),
      page_order: p.page_order, is_active: flag(p.is_active) })),
    briefing: [], banner: null
  };
  for (const address of addresses) {
    const choices = await Address.getChoices(scenario.id, address.id, true);
    const item = { id: Number(address.id), district: address.district, house_number: address.house_number,
      apartment: address.apartment || '', description: address.description || '', is_internet_cafe: flag(address.is_internet_cafe),
      choices: choices.map(c => ({ choice_text: c.choice_text, response_text: c.response_text,
        choice_order: c.choice_order, is_active: flag(c.is_active) })), applications: [] };
    for (const app of await applications.list(scenario.id, address.id)) {
      item.applications.push({ number: app.number,
        files: await exportFiles(app.files, `applications/${address.id}/${app.number}`,
          fileId => applications.getFile(scenario.id, address.id, app.number, fileId)) });
    }
    manifest.addresses.push(item);
  }
  if (briefing) manifest.briefing = await exportFiles(briefing.files, 'briefing', fileId => applications.getBriefingFile(scenario.id, fileId));
  const banner = banners.getBannerFile(scenario.id);
  if (banner) manifest.banner = add(`banner/cover.${banner.extension}`, await fs.readFile(banner.file));
  add('scenario.xlsx', workbook);
  add('scenario.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  // Validate our own output too: never export a package that cannot be imported.
  validatePackage(new Map(Object.entries(entries)));
  const archive = Buffer.from(zipSync(entries, { level: 0 }));
  if (archive.length > MAX_BYTES) throw invalid('Пакет сценария превышает 250 МБ');
  return archive;
}

function readArchive(buffer) {
  if (buffer.length > MAX_BYTES) throw invalid('Пакет сценария превышает 250 МБ');
  let total = 0;
  const names = new Set();
  try {
    const entries = unzipSync(buffer, { filter: entry => {
      if (entry.name.endsWith('/')) { safePath(entry.name.slice(0, -1)); return false; }
      safePath(entry.name);
      if (names.has(entry.name)) throw invalid('В архиве повторяются пути файлов');
      names.add(entry.name);
      total += entry.originalSize;
      if (names.size > MAX_FILES || total > MAX_BYTES || entry.originalSize > 100 * 1024 * 1024) {
        throw invalid('Распакованный пакет превышает допустимый размер (250 МБ, до 100 МБ на файл)');
      }
      return true;
    } });
    return new Map(Object.entries(entries).map(([name, data]) => [name, Buffer.from(data)]));
  } catch (error) {
    if (error.status) throw error;
    throw invalid('Не удалось прочитать ZIP-пакет сценария');
  }
}

function readFolder(files, paths) {
  if (!files?.length) throw invalid('Выберите папку сценария');
  let names;
  try { names = JSON.parse(paths); } catch (_) { throw invalid('Не переданы пути файлов папки'); }
  if (!Array.isArray(names) || names.length !== files.length) throw invalid('Некорректный список файлов папки');
  const entries = new Map();
  let total = 0;
  files.forEach((file, index) => {
    const name = safePath(names[index]);
    if (entries.has(name)) throw invalid('В папке повторяются пути файлов');
    entries.set(name, file.buffer);
    total += file.buffer.length;
  });
  if (total > MAX_BYTES || entries.size > MAX_FILES) throw invalid('Папка сценария превышает 250 МБ или 10000 файлов');
  return entries;
}

function validatePackage(entries) {
  let total = 0;
  for (const [name, buffer] of entries) { safePath(name); total += buffer.length; }
  if (total > MAX_BYTES || entries.size > MAX_FILES) throw invalid('Пакет превышает 250 МБ или 10000 файлов');
  const manifests = [...entries.keys()].filter(name => name === 'scenario.json' || name.endsWith('/scenario.json'));
  if (manifests.length !== 1) throw invalid('Выберите папку одного сценария с файлом scenario.json');
  const manifestPath = manifests[0];
  const prefix = manifestPath.slice(0, -'scenario.json'.length);
  const raw = entries.get(manifestPath);
  if (raw.length > 10 * 1024 * 1024) throw invalid('Описание пакета превышает 10 МБ');
  let manifest;
  try { manifest = JSON.parse(raw.toString('utf8')); } catch (_) { throw invalid('Повреждён файл scenario.json'); }
  if (manifest?.format !== FORMAT || manifest.version !== 1) throw invalid('Неподдерживаемый формат пакета сценария');
  if (!text(manifest.scenario?.name, 'название').trim()) throw invalid('Название сценария не заполнено');
  text(manifest.scenario.description, 'описание');
  const addresses = list(manifest.addresses, 'адреса');
  const addressById = new Map();
  for (const a of addresses) {
    positiveId(a.id);
    if (addressById.has(a.id)) throw invalid('В пакете повторяются идентификаторы адресов');
    addressById.set(a.id, a);
    if (!['С', 'Ю', 'З', 'В', 'Ц', 'П', 'СВ', 'СЗ', 'ЮВ', 'ЮЗ'].includes(a.district)) throw invalid('Некорректный район адреса');
    if (!text(a.house_number, 'дом').trim()) throw invalid('Номер дома не заполнен');
    text(a.apartment, 'квартира'); text(a.description, 'информация по адресу');
    if (typeof a.is_internet_cafe !== 'boolean') throw invalid('Некорректный признак интернет-кафе');
    for (const c of list(a.choices, 'выборы')) {
      text(c.choice_text, 'вариант выбора'); text(c.response_text, 'результат выбора');
      if (!Number.isSafeInteger(c.choice_order) || typeof c.is_active !== 'boolean') throw invalid('Некорректные настройки выбора');
    }
  }
  for (const q of list(manifest.questions, 'вопросы')) {
    text(q.question_text, 'вопрос');
    if (!Number.isSafeInteger(q.question_order) || typeof q.is_active !== 'boolean') throw invalid('Некорректные настройки вопроса');
  }
  for (const p of list(manifest.internet_pages, 'страницы кафе')) {
    text(p.title, 'название страницы'); text(p.content_html, 'содержимое страницы');
    if (!addressById.get(p.cafe_address_id)?.is_internet_cafe || !addressById.has(p.unlock_address_id)) {
      throw invalid('Страница интернет-кафе ссылается на отсутствующий адрес или адрес без кафе');
    }
    if (!Number.isSafeInteger(p.page_order) || p.page_order < 1 || typeof p.is_active !== 'boolean') throw invalid('Некорректные настройки страницы кафе');
  }
  const referenced = new Set();
  function fileBuffer(ref) {
    const name = prefix + safePath(ref?.path);
    if (referenced.has(name)) throw invalid('В пакете повторяются ссылки на файл');
    referenced.add(name);
    const buffer = entries.get(name);
    if (!buffer) throw invalid(`В пакете отсутствует файл: ${ref.path}`);
    if (buffer.length !== ref.size || hash(buffer) !== ref.sha256) throw invalid(`Повреждён файл: ${ref.path}`);
    return buffer;
  }
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf' };
  function uploadFiles(refs) {
    list(refs, 'файлы приложения');
    if (refs.length > 30) throw invalid('В приложении должно быть не больше 30 файлов');
    let size = 0;
    const files = refs.map(ref => {
      const name = text(ref.name, 'имя файла');
      if (!name || /[/\\\x00-\x1f]/.test(name)) throw invalid('Некорректное имя файла приложения');
      const buffer = fileBuffer(ref);
      const type = applications.detectType(buffer);
      if (!type || types[path.extname(name).toLowerCase()] !== type || ref.type !== type) throw invalid(`Неподдерживаемый файл: ${name}`);
      size += buffer.length;
      return { originalname: name, buffer, size: buffer.length };
    });
    if (size > 100 * 1024 * 1024) throw invalid('Приложение превышает 100 МБ');
    return files;
  }
  const prepared = new Map();
  for (const a of addresses) {
    const numbers = new Set();
    for (const app of list(a.applications, 'приложения')) {
      positiveId(app.number);
      if (numbers.has(app.number)) throw invalid('Повторяется номер приложения по адресу');
      numbers.add(app.number);
      const files = uploadFiles(app.files);
      if (!files.length) throw invalid('Пустое приложение в пакете');
      prepared.set(app, files);
    }
  }
  const briefing = uploadFiles(manifest.briefing);
  let banner = null;
  if (manifest.banner) {
    banner = fileBuffer(manifest.banner);
    if (!banners.detectExtension(banner)) throw invalid('Неподдерживаемая обложка сценария');
  }
  return { manifest, prepared, briefing, banner };
}

async function importPackage(entries, userId) {
  const { manifest, prepared, briefing, banner } = validatePackage(entries);
  const name = manifest.scenario.name.trim();
  const scenarios = await Scenario.getAll();
  if (scenarios.some(s => (s.name || '').trim().toLowerCase() === name.toLowerCase())) throw invalid(`Сценарий с именем «${name}» уже существует`);
  const created = await Scenario.create({ name, description: manifest.scenario.description, is_active: false, created_by: userId });
  const id = created.id;
  const addressIds = new Map();
  const questionIds = [];
  try {
    for (const a of manifest.addresses) {
      const address = await Address.create({ ...a, scenario_id: id });
      addressIds.set(a.id, address.id);
      for (const c of a.choices) {
        const choice = await Address.createChoice(id, { ...c, address_id: address.id });
        // updateChoice preserves inactive choices and the original order (including zero).
        await Address.updateChoice(id, choice.id, c);
      }
      for (const app of a.applications) await applications.save(id, address.id, app.number, prepared.get(app));
    }
    for (const q of manifest.questions) questionIds.push((await Question.create({ ...q, scenario_id: id })).id);
    for (const p of manifest.internet_pages) await InternetPage.create(id, { ...p,
      cafe_address_id: addressIds.get(p.cafe_address_id), unlock_address_id: addressIds.get(p.unlock_address_id) });
    if (briefing.length) await applications.saveBriefing(id, briefing);
    if (banner) await banners.saveBanner(id, banner);
    return { success: true, message: 'Импорт завершён', imported_count: 1, scenario_name: name, scenario_id: id };
  } catch (error) {
    // A failed import owns only this new scenario; remove its files and records.
    const cleanup = [() => applications.removeScenario(id), () => banners.deleteBanner(id),
      ...questionIds.map(q => () => Question.delete(q)), () => Scenario.delete(id)];
    for (const action of cleanup) {
      try { await action(); } catch (cleanupError) { console.error('Scenario import cleanup:', cleanupError); }
    }
    if ((process.env.DB_TYPE || 'sqlite') !== 'postgresql') {
      try { await require('../config/scenarioDatabase').deleteScenarioDb(id); } catch (cleanupError) { console.error('Scenario database cleanup:', cleanupError); }
    }
    throw error;
  }
}

module.exports = { exportPackage, readArchive, readFolder, validatePackage, importPackage, MAX_BYTES, MAX_FILES };
