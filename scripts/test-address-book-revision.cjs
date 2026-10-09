const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const backendRequire = createRequire(path.resolve('backend/package.json'));
const sqlite3 = backendRequire('sqlite3');
const { applyRevision, validateEntries } = require('../backend/services/addressBookRevision');
const entries = require('../backend/data/addressBook.json');
const manifest = require('../backend/data/addressBookRevision.json');

async function fixture(t) {
  const db = new sqlite3.Database(':memory:');
  t.after(() => new Promise(resolve => db.close(resolve)));
  const client = { query: (sql, values = []) => new Promise((resolve, reject) =>
    db.all(sql, values, (error, rows) => error ? reject(error) : resolve({ rows }))) };
  await client.query(`CREATE TABLE address_book_entries (id INTEGER PRIMARY KEY, category TEXT NOT NULL,
    district TEXT NOT NULL, house_number TEXT NOT NULL, apartment TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category, district, house_number, apartment, name))`);
  return client;
}
const insert = (client, entry, note = '') => client.query(`INSERT INTO address_book_entries
  (category,district,house_number,apartment,name,note) VALUES (?,?,?,?,?,?)`,
[entry.category, entry.district, entry.house_number, entry.apartment, entry.name, note]);

test('revision corrects known entries and preserves IDs, notes and custom records', async t => {
  const client = await fixture(t);
  for (const change of manifest.changes) await insert(client, change.before, 'Заметка организатора');
  await insert(client, {category:'Частные лица', district:'Ц', house_number:'999', apartment:'1', name:'Моя запись'}, 'Сохранить');
  const before = (await client.query('SELECT * FROM address_book_entries ORDER BY id')).rows;
  const result = await applyRevision({ client, entries });
  assert.equal(result.corrected, 6);
  const rows = (await client.query('SELECT * FROM address_book_entries ORDER BY id')).rows;
  assert.equal(rows.length, entries.length + 1);
  for (let i = 0; i < manifest.changes.length; i++) {
    assert.equal(rows[i].id, before[i].id);
    assert.equal(rows[i].note, before[i].note);
    for (const key of ['category','district','house_number','apartment','name']) assert.equal(rows[i][key], manifest.changes[i].after[key]);
  }
  assert.ok(rows.some(row => row.name === 'Моя запись' && row.note === 'Сохранить'));
  const backup = (await client.query('SELECT * FROM address_book_revisions')).rows[0];
  assert.deepEqual(JSON.parse(backup.previous_entries_json), before.slice(0, 6));
  await client.query('UPDATE address_book_entries SET house_number = ? WHERE id = ?', ['777', before[0].id]);
  assert.equal((await applyRevision({client,entries})).applied, false);
  assert.equal((await client.query('SELECT house_number FROM address_book_entries WHERE id = ?', [before[0].id])).rows[0].house_number, '777');
});

test('conflicting records roll back earlier corrections and do not mark the revision applied', async t => {
  const client = await fixture(t);
  for (const change of manifest.changes) await insert(client, change.before);
  await insert(client, manifest.changes[1].after);
  const before = (await client.query('SELECT * FROM address_book_entries ORDER BY id')).rows;
  await assert.rejects(applyRevision({client,entries}), /conflict/);
  assert.deepEqual((await client.query('SELECT * FROM address_book_entries ORDER BY id')).rows, before);
  assert.equal((await client.query('SELECT * FROM address_book_revisions')).rows.length, 0);
});

test('source contains the corrected links without the stale Roman Gurek duplicate', () => {
  validateEntries(entries);
  assert.equal(entries.length, 982);
  for (const change of manifest.changes) {
    assert.ok(entries.some(entry => JSON.stringify(entry) === JSON.stringify(change.after)));
    assert.ok(!entries.some(entry => JSON.stringify(entry) === JSON.stringify(change.before)));
  }
  assert.ok(entries.some(entry => entry.name === 'Интернет-кафе «Облако»' && entry.district === 'Ц' && entry.house_number === '38'));
  assert.throws(() => validateEntries([entries[0], entries[0]]), /Duplicate/);
});
