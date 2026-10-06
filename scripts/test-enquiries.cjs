'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'detectum-enquiries-test-'));
process.env.DB_TYPE = 'sqlite';
process.env.SQLITE_DB_PATH = path.join(fixtureDirectory, 'fixture.sqlite');
process.env.JWT_SECRET = randomUUID();

const express = require(path.join(root, 'backend/node_modules/express'));
const database = require('../backend/config/database');
const { createEnquiryStore, normalizeSubmission, CONSENT_VERSION } = require('../backend/services/enquiryStore');
const { createEnquiryRoutes, createSubmissionLimiter, clientAddress } = require('../backend/routes/enquiries');
const { generateToken } = require('../backend/middleware/auth');
const User = require('../backend/models/user');
const sqlite3 = require(path.join(root, 'backend/node_modules/sqlite3'));
let server;
let base;
let owner;
let staff;
let player;

const body = overrides => ({
  submission_id: randomUUID(), company: 'Команда Тест', participants: '24', format: 'online',
  phone: '+7 000 000-00-00', telegram: '@example_test', email: 'test@example.com',
  consent: true, consent_version: CONSENT_VERSION, ...overrides
});

async function http(url, options = {}) {
  const response = await fetch(base + url, options);
  const data = await response.json();
  return { status: response.status, data, headers: response.headers };
}
const send = values => http('/api/enquiries/corporate', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values)
});
const admin = (url = '', options = {}, token = owner) => http('/api/admin/enquiries' + url, {
  ...options, headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) }
});

test.before(async () => {
  await database.init();
  const ownerUser = await User.findByUsername('admin');
  owner = generateToken(ownerUser);
  staff = generateToken(await User.create({ username: 'fixture-staff', password: 'fixture-only', is_admin: true, admin_level: 'admin' }));
  player = generateToken(await User.create({ username: 'fixture-player', password: 'fixture-only', is_admin: false, admin_level: 'user' }));
  const app = express();
  app.use(express.json());
  const routes = createEnquiryRoutes({ limiter: () => true });
  app.use('/api/enquiries', routes.publicRouter);
  app.use('/api/admin/enquiries', routes.adminRouter);
  app.use('/api/rate-test', createEnquiryRoutes({ limiter: createSubmissionLimiter({ limit: 2 }) }).publicRouter);
  const unavailable = createEnquiryRoutes({
    store: { findSubmission: async () => null, submit: async () => { throw new Error('fixture-storage-down'); } },
    limiter: () => true
  });
  app.use('/api/failure-test', unavailable.publicRouter);
  server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  base = 'http://127.0.0.1:' + server.address().port;
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await new Promise((resolve, reject) => database.db.close(error => error ? reject(error) : resolve()));
  assert.ok(path.resolve(fixtureDirectory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(fixtureDirectory).startsWith('detectum-enquiries-test-'));
  fs.rmSync(fixtureDirectory, { recursive: true, force: true });
});

test('a submitted enquiry is stored with normalized fields; the public response has no customer contacts', async () => {
  const result = await send(body({ company: '  Команда Тест  ', status: 'agreed', notes: 'Injected' }));
  assert.equal(result.status, 201);
  assert.deepEqual(Object.keys(result.data).sort(), ['id', 'ok']);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const detail = await admin('/' + result.data.id);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.enquiry.company, 'Команда Тест');
  assert.equal(detail.data.enquiry.participants, 24);
  assert.equal(detail.data.enquiry.phone, '+7 000 000-00-00');
  assert.equal(detail.data.enquiry.kind, 'corporate');
  assert.equal(detail.data.enquiry.source, '/corporate');
  assert.equal(detail.data.enquiry.status, 'new');
  assert.equal(detail.data.enquiry.notes, '');
  assert.equal(detail.data.enquiry.submission_key, undefined);
  assert.equal(detail.data.enquiry.consent_version, CONSENT_VERSION);
  assert.equal(detail.data.enquiry.consented_at, detail.data.enquiry.created_at);
});

test('anonymous visitors, players, game staff and room tokens cannot read or change enquiries', async () => {
  const saved = await send(body({ company: 'Private contacts' }));
  for (const suffix of ['', '/summary', '/' + saved.data.id]) {
    assert.equal((await http('/api/admin/enquiries' + suffix)).status, 401);
    assert.equal((await admin(suffix, {}, staff)).status, 403);
    assert.equal((await admin(suffix, {}, player)).status, 403);
  }
  const jwt = require(path.join(root, 'backend/node_modules/jsonwebtoken'));
  const roomToken = jwt.sign({ room_user_id: 42, room_id: 7 }, process.env.JWT_SECRET);
  assert.equal((await admin('', {}, roomToken)).status, 403);
  assert.equal((await admin('/' + saved.data.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'closed', notes: '', revision: 0 }) }, staff)).status, 403);
});

test('invalid required fields, phone, email, format and request identifiers never save an enquiry', async () => {
  const before = (await admin('/summary')).data.total;
  for (const values of [
    body({ company: ' ' }), body({ participants: 1 }), body({ participants: 2.5 }),
    body({ participants: true }), body({ participants: '2e3' }), body({ phone: 'not-a-phone' }),
    body({ email: 'wrong' }), body({ email: '' }), body({ email: null }),
    body({ format: 'unknown' }), body({ format: false }), body({ company: {} }),
    body({ company: 'x'.repeat(161) }), body({ submission_id: 'invalid' }),
    body({ phone: '+7 123\n4567890' })
  ]) assert.equal((await send(values)).status, 400);
  assert.equal((await admin('/summary')).data.total, before);
  const optional = await send(body({ telegram: '', format: 'undecided' }));
  assert.equal(optional.status, 201);
});

test('the three-field form stores server-dated consent without requiring legacy fields', async () => {
  const result = await send({
    submission_id: randomUUID(), company: 'Три поля', phone: '+7 000 000-00-00',
    email: 'three-fields@example.com', consent: true, consent_version: CONSENT_VERSION,
    consented_at: '1900-01-01T00:00:00.000Z'
  });
  assert.equal(result.status, 201);
  const saved = (await admin('/' + result.data.id)).data.enquiry;
  assert.equal(saved.participants, null);
  assert.equal(saved.format, 'undecided');
  assert.equal(saved.telegram, '');
  assert.equal(saved.email, 'three-fields@example.com');
  assert.equal(saved.consent_version, CONSENT_VERSION);
  assert.equal(saved.consented_at, saved.created_at);
  assert.ok(Math.abs(Date.now() - Date.parse(saved.consented_at)) < 10000);
});

test('missing, false, coerced or obsolete consent is rejected without saving data', async () => {
  const before = (await admin('/summary')).data.total;
  for (const override of [
    { consent: undefined }, { consent: false }, { consent: 'true' }, { consent: 1 },
    { consent_version: undefined }, { consent_version: 'corporate-old' }
  ]) {
    const result = await send(body(override));
    assert.equal(result.status, 400);
    assert.ok(result.data.fields.consent);
  }
  assert.equal((await admin('/summary')).data.total, before);
});

test('concurrent retries of the same submission create exactly one row, and changed payload cannot reuse the identifier', async () => {
  const values = body({ company: 'Retry-safe enquiry' });
  const before = (await admin('/summary')).data.total;
  const attempts = await Promise.all(Array.from({ length: 12 }, () => send(values)));
  assert.equal(new Set(attempts.map(item => item.data.id)).size, 1);
  assert.equal(attempts.filter(item => item.status === 201).length, 1);
  assert.equal(attempts.filter(item => item.status === 200).length, 11);
  assert.equal((await admin('/summary')).data.total, before + 1);
  const saved = (await admin('/' + attempts[0].data.id)).data.enquiry;
  assert.equal(saved.consented_at, saved.created_at);
  assert.equal((await send(values)).status, 200);
  assert.equal((await admin('/' + saved.id)).data.enquiry.consented_at, saved.consented_at);
  assert.equal((await send({ ...values, company: 'Different request' })).status, 409);
  assert.equal((await admin('/summary')).data.total, before + 1);
});

test('status, notes and modification author persist; stale edits cannot overwrite another administrator', async () => {
  const saved = await send(body({ company: 'Processing fixture' }));
  const update = await admin('/' + saved.data.id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'in_progress', notes: '  Созвон в четверг\nОбсудить площадку  ', revision: 0 })
  });
  assert.equal(update.status, 200);
  assert.equal(update.data.enquiry.revision, 1);
  assert.equal(update.data.enquiry.updated_by, 'admin');
  const detail = (await admin('/' + saved.data.id)).data.enquiry;
  assert.equal(detail.status, 'in_progress');
  assert.equal(detail.notes, 'Созвон в четверг\nОбсудить площадку');
  const conflict = await admin('/' + saved.data.id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'closed', notes: 'Lost update', revision: 0 })
  });
  assert.equal(conflict.status, 409);
  assert.equal((await admin('/' + saved.data.id)).data.enquiry.notes, detail.notes);
  assert.equal((await admin('?q=' + encodeURIComponent('СОЗВОН В ЧЕТВЕРГ'))).data.total, 1);
  assert.equal((await admin('?q=' + saved.data.id.slice(0, 8))).data.total, 1);
});

test('search treats SQL wildcards literally and handles Cyrillic case; filtering and pagination retain every enquiry', async () => {
  const baseName = 'Пагинация ' + randomUUID();
  for (let index = 0; index < 27; index++) await database.enquiries.submit(normalizeSubmission(body({ company: baseName + ' ' + index })));
  const first = (await admin('?q=' + encodeURIComponent(baseName.toUpperCase()))).data;
  const second = (await admin('?q=' + encodeURIComponent(baseName) + '&page=2')).data;
  assert.equal(first.total, 27);
  assert.equal(first.items.length, 25);
  assert.equal(second.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 27);
  await send(body({ company: 'Бюро 100%_Тест' }));
  assert.equal((await admin('?q=' + encodeURIComponent('100%_ТЕСТ'))).data.total, 1);
  assert.equal((await admin('?q=' + encodeURIComponent('%_'))).data.total, 1);
  assert.equal((await admin('?status=in_progress')).data.items.every(item => item.status === 'in_progress'), true);
  const summary = (await admin('/summary')).data;
  assert.equal(Object.values(summary.counts).reduce((sum, value) => sum + value, 0), summary.total);
  assert.equal((await admin('?status=invalid')).status, 400);
  assert.equal((await admin('?page=-1')).status, 400);
});

test('closed enquiries stay in the inbox and invalid edits or missing records cannot alter data', async () => {
  const saved = await send(body({ company: 'Closed fixture' }));
  const patch = values => admin('/' + saved.data.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
  assert.equal((await patch({ status: 'agreed', notes: '', revision: 0 })).status, 200);
  assert.equal((await patch({ status: 'closed', notes: 'Не подошла дата', revision: 1 })).status, 200);
  assert.equal((await patch({ status: 'deleted', notes: '', revision: 2 })).status, 400);
  assert.equal((await patch({ status: 'closed', notes: 'a'.repeat(5001), revision: 2 })).status, 400);
  assert.equal((await patch({ status: 'closed', notes: '', revision: '2' })).status, 400);
  assert.equal((await admin('?status=closed&q=' + encodeURIComponent('Closed fixture'))).data.total, 1);
  assert.equal((await admin('/' + randomUUID())).status, 404);
  assert.equal((await admin('/bad-id')).status, 400);
});

test('submission rate limits block new requests, allow safe retry and reset after their window', async () => {
  const values = body({ company: 'Rate test A' });
  const limitedSend = data => http('/api/rate-test/corporate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await limitedSend(values)).status, 201);
  assert.equal((await limitedSend(body({ company: 'Rate test B' }))).status, 201);
  assert.equal((await limitedSend(body({ company: 'Rate test C' }))).status, 429);
  assert.equal((await limitedSend(values)).status, 200);
  let clock = 0;
  const limiter = createSubmissionLimiter({ limit: 1, windowMs: 100, now: () => clock });
  const direct = { socket: { remoteAddress: '203.0.113.1' }, headers: { 'x-forwarded-for': '203.0.113.2' } };
  assert.equal(clientAddress(direct), '203.0.113.1');
  assert.equal(clientAddress({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': 'spoofed, 203.0.113.3' } }), '203.0.113.3');
  assert.equal(limiter(direct), true);
  assert.equal(limiter(direct), false);
  clock = 101;
  assert.equal(limiter(direct), true);
});

test('a storage error returns failure rather than a false submission confirmation', async () => {
  const result = await http('/api/failure-test/corporate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body())
  });
  assert.equal(result.status, 503);
  assert.equal(result.data.ok, undefined);
  assert.equal(result.data.id, undefined);
  assert.ok(result.data.error.includes('Не удалось сохранить'));
});

test('enquiry data survives closing and reopening a SQLite database', async () => {
  const filename = path.join(fixtureDirectory, 'persistence.sqlite');
  const connection = () => new sqlite3.Database(filename);
  let db = connection();
  let store = createEnquiryStore({ query: (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve({ rows }))) });
  const saved = await store.submit(normalizeSubmission(body({ company: 'Persistent fixture' })));
  await store.update(saved.id, { status: 'agreed', notes: 'Сохранено в базе', revision: 0 }, 'fixture-owner');
  await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  db = connection();
  store = createEnquiryStore({ query: (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve({ rows }))) });
  const restored = await store.get(saved.id);
  assert.equal(restored.company, 'Persistent fixture');
  assert.equal(restored.status, 'agreed');
  assert.equal(restored.notes, 'Сохранено в базе');
  await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
});

test('SQLite migration keeps historical enquiries and permits the shorter form', async () => {
  const db = new sqlite3.Database(':memory:');
  const query = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve({ rows })));
  try {
    // Derive a fixture with the exact previous schema: required participants,
    // no consent fields. Production data is never used by this test.
    await createEnquiryStore({ query }).init();
    const schema = (await query("SELECT sql FROM sqlite_master WHERE name = 'site_enquiries'")).rows[0].sql;
    await query('DROP TABLE site_enquiries');
    await query(schema.replace('participants INTEGER CHECK', 'participants INTEGER NOT NULL CHECK')
      .replace(",\n    consent_version TEXT NOT NULL DEFAULT '',\n    consented_at TEXT NOT NULL DEFAULT ''", ''));
    const id = randomUUID();
    await query(`INSERT INTO site_enquiries
      (id, submission_key, payload_hash, company, participants, format, phone, telegram, email, status, notes, search_text, revision, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, randomUUID(), 'legacy-hash', 'Историческая заявка', 32, 'offline', '+7 000 000-00-00', '@old', 'old@example.com', 'in_progress', 'Старая заметка', 'историческая заявка', 4, 'owner', '2026-10-04T10:00:00.000Z', '2026-10-04T11:00:00.000Z']);
    const original = (await query('SELECT * FROM site_enquiries WHERE id = ?', [id])).rows[0];
    const store = createEnquiryStore({ query });
    await store.init();
    const migrated = (await query('SELECT * FROM site_enquiries WHERE id = ?', [id])).rows[0];
    assert.deepEqual(migrated, { ...original, consent_version: '', consented_at: '' });
    assert.equal((await store.get(id)).notes, 'Старая заметка');
    assert.equal((await query('PRAGMA table_info(site_enquiries)')).rows.find(column => column.name === 'participants').notnull, 0);
    const next = await store.submit(normalizeSubmission(body({ participants: undefined, format: undefined, telegram: undefined })));
    assert.equal((await store.get(next.id)).participants, null);
    assert.equal((await store.get(next.id)).consent_version, CONSENT_VERSION);
    await createEnquiryStore({ query }).init();
    assert.equal((await store.summary()).total, 2);
  } finally {
    await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  }
});

test('a failed SQLite migration rolls back without changing the original table', async () => {
  const db = new sqlite3.Database(':memory:');
  const query = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve({ rows })));
  try {
    await createEnquiryStore({ query }).init();
    const schema = (await query("SELECT sql FROM sqlite_master WHERE name = 'site_enquiries'")).rows[0].sql;
    await query('DROP TABLE site_enquiries');
    await query(schema.replace('participants INTEGER CHECK', 'participants INTEGER NOT NULL CHECK'));
    // An unexpected migration table must cause a safe failure, never be reused.
    await query('CREATE TABLE site_enquiries_migrated (untouched TEXT)');
    const before = (await query("SELECT sql FROM sqlite_master WHERE name = 'site_enquiries'")).rows[0].sql;
    await assert.rejects(createEnquiryStore({ query }).init());
    assert.equal((await query("SELECT sql FROM sqlite_master WHERE name = 'site_enquiries'")).rows[0].sql, before);
    assert.equal((await query('PRAGMA table_info(site_enquiries_migrated)')).rows[0].name, 'untouched');
  } finally {
    await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  }
});
