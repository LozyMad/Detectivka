const fs = require('fs');
const path = require('path');
const manifest = require('../data/addressBookRevision.json');
const FIELDS = ['category', 'district', 'house_number', 'apartment', 'name'];
const DISTRICTS = new Set(['С', 'Ю', 'З', 'В', 'Ц', 'П', 'СВ', 'СЗ', 'ЮВ', 'ЮЗ']);

function validateEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('Empty address book');
  const keys = new Set();
  for (const entry of entries) {
    if (!entry.category || !DISTRICTS.has(entry.district) || !entry.house_number || !entry.name || typeof entry.apartment !== 'string') {
      throw new Error('Invalid address book entry');
    }
    const key = JSON.stringify(FIELDS.map(field => entry[field]));
    if (keys.has(key)) throw new Error('Duplicate address book entry');
    keys.add(key);
  }
}

// Update only the six known corrections. Preserve IDs, notes and additional entries.
// Both the backup and revision marker commit atomically with the corrections.
async function applyRevision({ client, dialect = 'sqlite', entries, changes = manifest.changes, revision = manifest.revision }) {
  validateEntries(entries);
  const p = i => dialect === 'postgresql' ? `$${i}` : '?';
  const where = FIELDS.map((field, i) => `${field} = ${p(i + 1)}`).join(' AND ');
  const values = entry => FIELDS.map(field => entry[field]);
  await client.query(`CREATE TABLE IF NOT EXISTS address_book_revisions (
    revision TEXT PRIMARY KEY,
    previous_entries_json TEXT NOT NULL,
    imported_count INTEGER NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.query(dialect === 'postgresql' ? 'BEGIN' : 'BEGIN IMMEDIATE');
  try {
    if (dialect === 'postgresql') await client.query('LOCK TABLE address_book_revisions IN EXCLUSIVE MODE');
    const applied = await client.query(`SELECT revision FROM address_book_revisions WHERE revision = ${p(1)}`, [revision]);
    if (applied.rows.length) {
      await client.query('COMMIT');
      return { applied: false, revision };
    }
    const backup = [];
    for (const { before, after } of changes) {
      const current = (await client.query(`SELECT * FROM address_book_entries WHERE ${where}`, values(before))).rows;
      if (!current.length) continue; // Already corrected, or an administrator has edited this record.
      const target = (await client.query(`SELECT id FROM address_book_entries WHERE ${where}`, values(after))).rows;
      if (target.length) throw new Error(`Address book conflict: ${after.name}`);
      backup.push(...current);
      await client.query(`UPDATE address_book_entries SET ${FIELDS.map((field, i) => `${field} = ${p(i + 1)}`).join(', ')},
        updated_at = CURRENT_TIMESTAMP WHERE id = ${p(6)}`, [...values(after), current[0].id]);
    }
    for (const entry of entries) {
      await client.query(`INSERT INTO address_book_entries (${FIELDS.join(',')}, note)
        VALUES (${[1, 2, 3, 4, 5, 6].map(p).join(',')})
        ON CONFLICT (category, district, house_number, apartment, name) DO NOTHING`, [...values(entry), entry.note || '']);
    }
    await client.query(`INSERT INTO address_book_revisions (revision, previous_entries_json, imported_count)
      VALUES (${[1, 2, 3].map(p).join(',')})`, [revision, JSON.stringify(backup), entries.length]);
    await client.query('COMMIT');
    return { applied: true, revision, corrected: backup.length, source_entries: entries.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function loadEntries() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../data/addressBook.json'), 'utf8'));
}

async function updateAddressBook() {
  const database = require('../config/database');
  const client = await database.getClient();
  try {
    const result = await applyRevision({ client, dialect: process.env.DB_TYPE || 'sqlite', entries: loadEntries() });
    console.log('[AddressBook] Revision:', result);
    return result;
  } finally { client.release(); }
}

async function getAddressBookStatus() {
  const { query } = require('../config/database');
  const rows = (await query(`SELECT ${FIELDS.join(',')} FROM address_book_entries`)).rows;
  const keys = new Set(rows.map(row => JSON.stringify(FIELDS.map(field => row[field]))));
  const entries = loadEntries();
  const matched = entries.filter(entry => keys.has(JSON.stringify(FIELDS.map(field => entry[field])))).length;
  const revisions = (await query('SELECT revision FROM address_book_revisions')).rows;
  const applied = revisions.some(row => row.revision === manifest.revision);
  return { ready: applied && matched === entries.length, revision: applied ? manifest.revision : null,
    source_entries: entries.length, matched_entries: matched, total_entries: rows.length };
}

module.exports = { validateEntries, applyRevision, updateAddressBook, getAddressBookStatus };
