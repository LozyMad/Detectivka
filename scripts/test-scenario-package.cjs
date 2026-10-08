const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const backendRequire = createRequire(path.resolve('backend/package.json'));
const { zipSync } = backendRequire('./vendor/fflate/index.cjs');
const pdf = Buffer.from('%PDF-1.4\nУлика\n%%EOF');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9kAAAAASUVORK5CYII=', 'base64');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detectum-package-'));
  const cache = new Map();
  const sqlite3 = backendRequire('sqlite3').verbose();
  const db = new sqlite3.Database(':memory:');
  const run = (sql, values = []) => new Promise((resolve, reject) => db.run(sql, values, function(error) { if (error) reject(error); else resolve({ id: this.lastID }); }));
  // Real SQLite models with temporary storage, independent of project data.
  const load = file => {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    cache.set(file, module.exports);
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, Buffer, console: { ...console, log() {} },
      __dirname: path.join(root, path.basename(path.dirname(file))), process: { env: { DB_TYPE: 'sqlite' } },
      require: name => {
        if (name === '../config/database') return { db };
        if (name.endsWith('.cjs')) return backendRequire(path.resolve(path.dirname(file), name));
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.js'));
        return backendRequire(name);
      }
    }, { filename: file });
    cache.set(file, module.exports);
    return module.exports;
  };
  const models = { Scenario: load('backend/models/scenario.js'), Address: load('backend/models/address.js'),
    Question: load('backend/models/question.js'), Page: load('backend/models/internetPage.js') };
  const packages = load('backend/services/scenarioPackage.js');
  const applications = load('backend/services/scenarioApplications.js');
  const banners = load('backend/services/scenarioBanner.js');
  const scenarioDb = load('backend/config/scenarioDatabase.js');
  const controller = load('backend/controllers/backupController.js');
  const express = backendRequire('express');
  const app = express();
  // Use the real backup router with only the auth middleware replaced.
  const routeModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync('backend/routes/backup.js', 'utf8'), { module: routeModule, require: name => {
    if (name === '../middleware/auth') return {
      authenticateToken: (req, res, next) => { if (req.headers.authorization !== 'Bearer test') return res.status(401).end(); req.user = { id: 1 }; next(); },
      superAdminRequired: (req, res, next) => next()
    };
    if (name === '../controllers/backupController') return controller;
    if (name === '../services/scenarioPackage') return packages;
    return backendRequire(name);
  } });
  app.use('/api/backup', routeModule.exports);
  const ids = [];
  t.after(async () => {
    for (const id of ids) await scenarioDb.deleteScenarioDb(id);
    await new Promise(resolve => db.close(resolve));
    await fs.promises.rm(root, { recursive: true, force: true });
  });
  const initialize = async () => {
    await run('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
    await run("INSERT INTO users VALUES (1, 'test')");
    await run('CREATE TABLE scenarios (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, is_active BOOLEAN, created_by INTEGER, created_at TEXT)');
    await run('CREATE TABLE questions (id INTEGER PRIMARY KEY AUTOINCREMENT, scenario_id INTEGER, question_text TEXT, question_order INTEGER DEFAULT 1, is_active BOOLEAN DEFAULT 1, created_at TEXT)');
    const original = models.Scenario.create;
    models.Scenario.create = async data => { const result = await original(data); ids.push(result.id); return result; };
  };
  const seed = async () => {
    await initialize();
    const s = await models.Scenario.create({ name: 'Дело «Кафе»', description: 'Описание\nсценария', is_active: true, created_by: 1 });
    // Deliberately create noncontiguous source IDs; import must map relationships.
    const discarded = await models.Address.create({ scenario_id: s.id, district: 'С', house_number: '0', description: '' });
    await models.Address.delete(s.id, discarded.id);
    const discarded2 = await models.Address.create({ scenario_id: s.id, district: 'С', house_number: '00', description: '' });
    await models.Address.delete(s.id, discarded2.id);
    const clue = await models.Address.create({ scenario_id: s.id, district: 'Ц', house_number: '12', apartment: '2', description: 'Текст\nс переносами' });
    const cafe = await models.Address.create({ scenario_id: s.id, district: 'В', house_number: '9', description: 'Кафе', is_internet_cafe: true });
    const inactive = await models.Address.createChoice(s.id, { address_id: clue.id, choice_text: 'Спросить\nещё', response_text: 'Ответ\nна вопрос', choice_order: 7 });
    await models.Address.updateChoice(s.id, inactive.id, { choice_text: 'Спросить\nещё', response_text: 'Ответ\nна вопрос', choice_order: 7, is_active: false });
    await models.Address.createChoice(s.id, { address_id: clue.id, choice_text: 'Осмотреть', response_text: 'Улика', choice_order: 1 });
    await models.Question.create({ scenario_id: s.id, question_text: 'Кто?\nПочему?', question_order: 8, is_active: false });
    await models.Question.create({ scenario_id: s.id, question_text: 'Где?', question_order: 2 });
    await models.Page.create(s.id, { title: 'Архив', content_html: '<p>Страница\nкафе</p>', cafe_address_id: cafe.id, unlock_address_id: clue.id, page_order: 4, is_active: false });
    await applications.save(s.id, clue.id, 3, [{ originalname: 'Улика.pdf', buffer: pdf, size: pdf.length }, { originalname: 'Фото.png', buffer: png, size: png.length }]);
    await applications.saveBriefing(s.id, [{ originalname: 'Брифинг.pdf', buffer: pdf, size: pdf.length }]);
    await banners.saveBanner(s.id, png);
    return s;
  };
  return { ...models, packages, applications, banners, db, seed, initialize, app };
}
function renamePackage(entries, name) {
  const manifest = JSON.parse(entries.get('scenario.json'));
  manifest.scenario.name = name;
  entries.set('scenario.json', Buffer.from(JSON.stringify(manifest)));
  return entries;
}
async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return (url, options = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/backup${url}`, { ...options, headers: { Authorization: 'Bearer test', ...options.headers } });
}

test('ZIP and unpacked folder restore all scenario data, exact files and remapped café addresses', async t => {
  const f = fixture(t); const s = await f.seed();
  const request = await listen(t, f.app);
  const response = await request(`/export?scenario_id=${s.id}`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8/);
  const entries = f.packages.readArchive(Buffer.from(await response.arrayBuffer()));
  assert.ok(entries.has('scenario.xlsx'));
  for (const folder of [false, true]) {
    renamePackage(entries, folder ? 'Из папки' : 'Из ZIP');
    const body = new FormData();
    if (folder) {
      body.append('paths', JSON.stringify([...entries.keys()].map(name => `Дело/${name}`)));
      for (const [name, buffer] of entries) body.append('files', new Blob([buffer]), path.basename(name));
    } else body.append('backupFile', new Blob([zipSync(Object.fromEntries(entries))]), 'Пакет.zip');
    const imported = await request(folder ? '/import-folder' : '/import', { method: 'POST', body });
    const result = await imported.json();
    assert.equal(imported.status, 200, JSON.stringify(result)); assert.equal(result.success, true);
    const restored = await f.Scenario.getById(result.scenario_id);
    assert.equal(restored.description, s.description); assert.equal(restored.is_active, 0);
    const addresses = await f.Address.getByScenario(restored.id);
    const clue = addresses.find(a => a.house_number === '12'); const cafe = addresses.find(a => a.house_number === '9');
    assert.notEqual(clue.id, 3, 'source address IDs must be remapped');
    assert.equal(clue.apartment, '2'); assert.equal(clue.description, 'Текст\nс переносами'); assert.equal(cafe.is_internet_cafe, 1);
    const pages = await f.Page.getByScenario(restored.id);
    assert.equal(pages[0].cafe_address_id, cafe.id); assert.equal(pages[0].unlock_address_id, clue.id);
    assert.equal(pages[0].content_html, '<p>Страница\nкафе</p>'); assert.equal(pages[0].is_active, 0); assert.equal(pages[0].page_order, 4);
    const choices = await f.Address.getChoices(restored.id, clue.id, true);
    assert.equal(choices.length, 2); assert.equal(choices[1].choice_text, 'Спросить\nещё'); assert.equal(choices[1].is_active, 0);
    assert.equal((await f.Address.getChoices(restored.id, clue.id)).length, 1);
    const questions = await f.Question.getByScenario(restored.id, true);
    assert.equal(questions[1].question_text, 'Кто?\nПочему?'); assert.equal(questions[1].question_order, 8); assert.equal(questions[1].is_active, 0);
    const apps = await f.applications.list(restored.id, clue.id);
    assert.equal(apps[0].number, 3); assert.equal(apps[0].files.length, 2);
    const file = apps[0].files.find(file => file.name === 'Улика.pdf');
    assert.deepEqual(await fs.promises.readFile((await f.applications.getFile(restored.id, clue.id, 3, file.id)).path), pdf);
    const briefing = await f.applications.getBriefing(restored.id);
    assert.equal(briefing.files[0].name, 'Брифинг.pdf');
    assert.deepEqual(await fs.promises.readFile((await f.applications.getBriefingFile(restored.id, briefing.files[0].id)).path), pdf);
    assert.deepEqual(await fs.promises.readFile(f.banners.getBannerFile(restored.id).file), png);
  }
});

test('invalid, missing and corrupt materials fail before creating a scenario; duplicates are retained safely', async t => {
  const f = fixture(t); const s = await f.seed();
  const original = f.packages.readArchive(await f.packages.exportPackage(s, Buffer.from('xlsx')));
  const count = (await f.Scenario.getAll()).length;
  const material = [...original.keys()].find(name => name.startsWith('applications/'));
  for (const mutate of [
    entries => entries.delete(material),
    entries => entries.set(material, Buffer.from('broken')),
    entries => entries.set('../escape.pdf', pdf),
    entries => entries.set('nested/scenario.json', entries.get('scenario.json')),
    entries => { const m = JSON.parse(entries.get('scenario.json')); m.internet_pages[0].unlock_address_id = 9999; entries.set('scenario.json', Buffer.from(JSON.stringify(m))); },
    entries => { const m = JSON.parse(entries.get('scenario.json')); m.version = 999; entries.set('scenario.json', Buffer.from(JSON.stringify(m))); }
  ]) {
    const entries = renamePackage(new Map(original), 'Ошибочный пакет'); mutate(entries);
    await assert.rejects(f.packages.importPackage(entries, 1));
    assert.equal((await f.Scenario.getAll()).length, count);
  }
  await assert.rejects(f.packages.importPackage(original, 1), /уже существует/);
  assert.throws(() => f.packages.readArchive(Buffer.from('invalid zip')), /ZIP/);
  assert.throws(() => f.packages.readArchive(Buffer.from(zipSync({ '../escape.pdf': pdf }))), /путь/);
  assert.throws(() => f.packages.readFolder([{ buffer: pdf }], '["one.pdf","two.pdf"]'), /список/);
});

test('a storage failure rolls back the new scenario, questions, application files and database', async t => {
  const f = fixture(t); const s = await f.seed();
  const entries = renamePackage(f.packages.readArchive(await f.packages.exportPackage(s, Buffer.from('xlsx'))), 'Неудачный импорт');
  const saveBanner = f.banners.saveBanner;
  f.banners.saveBanner = async () => { throw new Error('disk full'); };
  await assert.rejects(f.packages.importPackage(entries, 1), /disk full/);
  f.banners.saveBanner = saveBanner;
  assert.equal((await f.Scenario.getAll()).length, 1);
  const questions = await new Promise((resolve, reject) => f.db.all('SELECT DISTINCT scenario_id FROM questions', (e, rows) => e ? reject(e) : resolve(rows)));
  assert.deepEqual(questions.map(q => q.scenario_id), [s.id]);
  assert.equal(await f.applications.getBriefing(s.id + 1), null);
});

test('legacy Excel import and export remain available, with readable Russian filenames', async t => {
  const f = fixture(t); const s = await f.seed(); const request = await listen(t, f.app);
  const response = await request(`/export?scenario_id=${s.id}&format=xlsx`);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /spreadsheetml/);
  const body = new FormData(); body.append('backupFile', new Blob([await response.arrayBuffer()]), 'Старый формат.xlsx');
  const result = await request('/import', { method: 'POST', body });
  const data = await result.json(); assert.equal(result.status, 200, JSON.stringify(data));
  assert.equal(data.scenario_name, 'Старый формат');
  assert.equal((await f.Scenario.getAll()).length, 2);
  const scenarios = await f.Scenario.getAll(); const imported = scenarios.find(s => s.name === 'Старый формат');
  assert.equal((await f.Address.getByScenario(imported.id)).length, 2);
});

test('backup routes reject unauthorized requests and unsupported file types with JSON errors', async t => {
  const f = fixture(t); await f.initialize(); const request = await listen(t, f.app);
  assert.equal((await request('/export?scenario_id=1', { headers: { Authorization: '' } })).status, 401);
  assert.equal((await request('/export?scenario_id=1garbage')).status, 400);
  const body = new FormData(); body.append('backupFile', new Blob(['x']), 'file.exe');
  const result = await request('/import', { method: 'POST', body }); assert.equal(result.status, 400);
  assert.equal((await result.json()).success, false);
});

test('browser folder import sends every relative path once and permits retry after a server error', async () => {
  const { browser, deferred } = require('./test-helpers/browser-runtime.cjs');
  const transfer = deferred();
  const b = browser(() => transfer.promise);
  const controls = [{ disabled: false }, { disabled: false }];
  b.document.querySelectorAll = () => controls;
  b.sandbox.FormData = FormData;
  const messages = [];
  b.sandbox.showMessage = (message, type) => messages.push({ message, type });
  b.sandbox.API_BASE = '/api';
  b.sandbox.loadScenarios = async () => {};
  b.sandbox.populateExportScenarioSelect = async () => {};
  b.element('importForm').reset = () => {};
  b.load('frontend/js/backup.js');
  b.element('backupFolder').files = [
    Object.assign(new Blob(['{}']), { name: 'scenario.json', webkitRelativePath: 'Дело/scenario.json' }),
    Object.assign(new Blob([pdf]), { name: '1.pdf', webkitRelativePath: 'Дело/applications/3/2/1.pdf' })
  ];
  const pending = b.run('importScenarios()');
  assert.ok(controls.every(control => control.disabled));
  await b.run('importScenarios()');
  assert.equal(b.calls.length, 1, 'prevent accidental duplicate imports');
  assert.equal(b.calls[0].url, '/api/backup/import-folder');
  assert.deepEqual(JSON.parse(b.calls[0].options.body.get('paths')), ['Дело/scenario.json', 'Дело/applications/3/2/1.pdf']);
  assert.equal(b.calls[0].options.body.getAll('files').length, 2);
  transfer.resolve(new Response(JSON.stringify({ error: 'Файл отсутствует', success: false }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  await pending;
  assert.ok(controls.every(control => !control.disabled));
  assert.equal(messages.at(-1).message, 'Файл отсутствует');
  assert.equal(messages.at(-1).type, 'danger');
  await b.run('importScenarios()');
  assert.equal(b.calls.length, 2, 'allow explicit retry after correcting the package');
});

test('browser ZIP export uses the original Cyrillic name from Content-Disposition', async () => {
  const { browser } = require('./test-helpers/browser-runtime.cjs');
  const b = browser(() => new Response('zip', { headers: { 'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="scenario.zip"; filename*=UTF-8''${encodeURIComponent('Дело кафе.zip')}` } }));
  b.sandbox.API_BASE = '/api'; b.sandbox.showMessage = () => {};
  b.element('exportScenarioSelect').value = '12';
  let clicked = false; let removed = false; const link = { click: () => { clicked = true; }, remove: () => { removed = true; } };
  b.document.createElement = () => link;
  b.document.body.appendChild = () => {};
  b.load('frontend/js/backup.js');
  await b.run('exportScenarios()');
  assert.equal(link.download, 'Дело кафе.zip'); assert.equal(clicked, true); assert.equal(removed, true);
  assert.equal(b.calls[0].url, '/api/backup/export?scenario_id=12');
});

test('PostgreSQL models export inactive content and preserve question ordering', async () => {
  const queries = [];
  const query = async (sql, params) => { queries.push({ sql, params }); return { rows: [{ id: 88 }] }; };
  function model(file) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, console: { log() {} }, require: () => ({ query, queryScenario: async (id, sql, params) => query(sql, params), ensureTables: async () => {} }) });
    return module.exports;
  }
  const addresses = model('backend/models/addressPostgreSQL.js');
  const questions = model('backend/models/questionPostgreSQL.js');
  await addresses.getChoices(12, 14);
  assert.match(queries.at(-1).sql, /AND is_active = true/);
  await addresses.getChoices(12, 14, true);
  assert.doesNotMatch(queries.at(-1).sql, /AND is_active/);
  await questions.getByScenario(12, true);
  assert.doesNotMatch(queries.at(-1).sql, /AND is_active/);
  await questions.create({ scenario_id: 12, question_text: 'Почему?', question_order: 7, is_active: false });
  assert.deepEqual(Array.from(queries.at(-1).params), [12, 'Почему?', 7, false]);
});
