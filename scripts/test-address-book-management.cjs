const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { browser, deferred, flush } = require('./test-helpers/browser-runtime.cjs');
const backendRequire = createRequire(path.resolve('backend/package.json'));
const XLSX = backendRequire('xlsx');

function load(file, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, Buffer, process, __dirname: path.dirname(path.resolve(file)),
    console: { log() {}, error() {} },
    require: name => name in dependencies ? dependencies[name] : backendRequire(name)
  }, { filename: file });
  return module.exports;
}

function controller(store) {
  return load('backend/controllers/addressBookController.js', { '../models/addressBook': store });
}

function response() {
  return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; return this; }, send(data) { this.data = data; return this; },
    setHeader(name, value) { this.headers[name] = value; } };
}

test('XLSX export includes every page regardless of active filters and preserves literal text', async () => {
  const entries = Array.from({ length: 5001 }, (_, i) => ({ id: i + 1, district: 'Ц',
    house_number: String(i + 1), apartment: '', name: `Житель ${i}`, category: 'Частные лица', note: '' }));
  Object.assign(entries[5000], { house_number: '001А', apartment: '02', name: '=1+1', note: 'Строка 1\nСтрока 2' });
  const pages = [];
  const c = controller({ ensureSeeded: async () => {}, getAllEntries: async ({ limit, offset }) => {
    pages.push(offset); return entries.slice(offset, offset + limit);
  } });
  const res = response();
  await c.exportAddressBook({ query: { category: 'Не эта категория', q: 'Нет совпадений' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(pages, [0, 5000]);
  assert.match(res.headers['Content-Type'], /spreadsheetml/);
  assert.match(res.headers['Content-Disposition'], /attachment;.*\.xlsx/);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  const wb = XLSX.read(res.data, { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['Адресная книга']);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  assert.equal(rows.length, 5002);
  const index = rows.findIndex(r => r[3] === '=1+1');
  assert.deepEqual(rows[index], ['Ц', '001А', '02', '=1+1', 'Частные лица', 'Строка 1\nСтрока 2']);
  assert.equal(sheet[`D${index + 1}`].t, 's');
  assert.equal(sheet[`D${index + 1}`].f, undefined);
});

test('empty book produces a valid header-only XLSX; database failures return an error', async () => {
  const c = controller({ ensureSeeded: async () => {}, getAllEntries: async () => [] });
  const res = response();
  await c.exportAddressBook({}, res);
  const wb = XLSX.read(res.data, { type: 'buffer' });
  assert.equal(wb.Sheets['Адресная книга']['!ref'], 'A1:F1');
  const failed = response();
  await controller({ ensureSeeded: async () => { throw new Error('offline'); } }).exportAddressBook({}, failed);
  assert.equal(failed.statusCode, 500);
  assert.match(failed.data.error, /Не удалось/);
});

test('letter groups include residents after the first 500 records and apply offset after filtering', async () => {
  const entries = Array.from({ length: 610 }, (_, i) => ({ district: 'Ц', house_number: String(i),
    name: i < 600 ? `Адам ${i}` : `Яворский ${i}`, category: 'Частные лица' }));
  const c = controller({ ensureSeeded: async () => {},
    getEntriesByCategory: async ({ limit, offset }) => entries.slice(offset, offset + limit) });
  const res = response();
  await c.getAddressBookEntries({ query: { category: 'Частные лица', letter_group: 'Х-Я', limit: '3', offset: '2' } }, res);
  assert.equal(res.data.total, 10);
  assert.equal(res.data.entries.length, 3);
  assert.equal(res.data.entries[0].name, 'Яворский 602');
});

test('delete removes only the selected directory entry; missing and invalid IDs are reported', async t => {
  const sqlite3 = backendRequire('sqlite3');
  const db = new sqlite3.Database(':memory:');
  t.after(() => new Promise(resolve => db.close(resolve)));
  const query = sql => new Promise((resolve, reject) => db.all(sql, (err, rows) => err ? reject(err) : resolve(rows)));
  await query('CREATE TABLE address_book_entries (id INTEGER PRIMARY KEY, name TEXT)');
  await query("INSERT INTO address_book_entries VALUES (1, 'Первый'), (2, 'Второй')");
  await query('CREATE TABLE addresses (id INTEGER PRIMARY KEY, description TEXT)');
  await query("INSERT INTO addresses VALUES (1, 'Сценарная поездка')");
  const model = load('backend/models/addressBook.js', { '../config/database': { db } });
  const c = controller(model);
  const res = response();
  await c.deleteAddressBookEntry({ params: { id: '1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(await query('SELECT id FROM address_book_entries'), [{ id: 2 }]);
  assert.equal((await query('SELECT * FROM addresses'))[0].description, 'Сценарная поездка');
  const missing = response();
  await c.deleteAddressBookEntry({ params: { id: '1' } }, missing);
  assert.equal(missing.statusCode, 404);
  for (const id of ['0', '-1', '1.5', 'abc']) {
    const invalid = response();
    await c.deleteAddressBookEntry({ params: { id } }, invalid);
    assert.equal(invalid.statusCode, 400);
  }
});

test('export stays behind admin authentication and delete stays behind super-admin access', async t => {
  const noOp = (req, res) => res.end();
  const otherControllers = new Proxy({}, { get: () => noOp });
  const users = { 1: { id: 1, is_admin: true, admin_level: 'super_admin' },
    2: { id: 2, is_admin: true, admin_level: 'admin' }, 3: { id: 3, is_admin: false } };
  const auth = load('backend/middleware/auth.js', {
    '../models/user': { findById: async id => users[id] }, '../models/room': {} });
  const c = controller({ ensureSeeded: async () => {}, getAllEntries: async () => [],
    deleteEntry: async id => ({ deletedId: id, changes: 1 }) });
  const deps = { '../middleware/auth': auth, '../controllers/addressBookController': c,
    '../controllers/adminController': otherControllers, '../controllers/superAdminController': otherControllers,
    '../models/scenario': {}, '../services/scenarioBanner': { saveBanner: async () => {} } };
  const express = backendRequire('express');
  const app = express();
  app.use('/api/admin', load('backend/routes/admin.js', deps));
  app.use('/api/super-admin', load('backend/routes/superAdmin.js', deps));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, id, method = 'GET') => {
    const headers = id ? { Authorization: `Bearer ${auth.generateToken(users[id])}` } : {};
    const res = await fetch(url + route, { method, headers });
    await res.arrayBuffer();
    return res.status;
  };
  assert.equal(await call('/api/admin/address-book/export'), 401);
  assert.equal(await call('/api/admin/address-book/export', 3), 403);
  assert.equal(await call('/api/admin/address-book/export', 2), 200);
  assert.equal(await call('/api/super-admin/address-book/entries/1', 2, 'DELETE'), 403);
  assert.equal(await call('/api/super-admin/address-book/entries/1', 1, 'DELETE'), 200);
});

const entry = { id: 7, district: 'Ю', house_number: '27', apartment: '2', name: 'Проверяемая запись' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
function ui(fetchImpl) {
  const b = browser(fetchImpl);
  b.load('frontend/js/admin.js');
  b.run(`isSuperAdmin = true; loadAddressBookEntries = async () => { window.refreshed = true; };
    showMessage = (text, kind) => { window.message = { text, kind }; };`);
  return b;
}

test('row delete confirms the stored name and address; cancel and non-super-admin never delete', async () => {
  const b = ui(() => json({ entry }));
  b.sandbox.confirm = message => { assert.match(message, /Проверяемая запись.*Ю, дом 27, кв\. 2/); return false; };
  await b.run('deleteAddressBookEntry(7)');
  assert.equal(b.calls.length, 1);
  assert.equal(b.calls[0].options.method, undefined);
  assert.equal(b.run('addressBookDeletes.size'), 0);
  b.run('isSuperAdmin = false;');
  await b.run('deleteAddressBookEntry(7)');
  assert.equal(b.calls.length, 1);
});

test('confirmed row delete is sent once, refreshes on success, and handles an already deleted row', async () => {
  const wait = deferred();
  const b = ui(call => call.options.method === 'DELETE' ? wait.promise : json({ entry }));
  const first = b.run('deleteAddressBookEntry(7)');
  await flush();
  await b.run('deleteAddressBookEntry(7)');
  assert.equal(b.calls.filter(c => c.options.method === 'DELETE').length, 1);
  wait.resolve(json({ deleted: { changes: 1 } }));
  await first;
  assert.equal(b.window.refreshed, true);
  assert.equal(b.window.message.kind, 'success');
  assert.equal(b.run('addressBookDeletes.size'), 0);
  const missing = ui(call => call.options.method === 'DELETE' ? json({ error: 'Запись уже удалена' }, 404) : json({ entry }));
  await missing.run('deleteAddressBookEntry(7)');
  assert.equal(missing.window.message.kind, 'danger');
  assert.equal(missing.window.refreshed, undefined);
});

test('download uses the entire-book endpoint, suppresses double clicks and restores the button', async () => {
  const transfer = deferred();
  const b = ui(() => transfer.promise);
  const links = [];
  b.document.createElement = () => ({ click() { links.push(this.download); }, remove() {} });
  b.document.body.appendChild = () => {};
  b.sandbox.URL = class extends URL { static createObjectURL() { return 'blob:fixture'; } static revokeObjectURL() {} };
  b.run("addressBookFilter = {category: 'Транспорт', q: 'Ничего'};");
  const first = b.run('exportAddressBook()');
  await flush();
  await b.run('exportAddressBook()');
  assert.equal(b.calls.length, 1);
  assert.equal(b.calls[0].url, '/api/admin/address-book/export');
  assert.equal(b.element('addressBookExportBtn').disabled, true);
  transfer.resolve(new Response('fixture xlsx'));
  await first;
  assert.equal(links.length, 1);
  assert.match(links[0], /Адресная книга.*\.xlsx$/);
  assert.equal(b.element('addressBookExportBtn').disabled, false);
  const failed = ui(() => json({ error: 'Ошибка выгрузки' }, 500));
  await failed.run('exportAddressBook()');
  assert.equal(failed.element('addressBookExportBtn').disabled, false);
  assert.equal(failed.window.message.kind, 'danger');
});
