// Адресная книга (глобальная, единая для всех сценариев).
// При первом обращении сидируется из backend/data/addressBook.json, если таблица пуста.

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let AddressBook;

if (DB_TYPE === 'postgresql') {
  AddressBook = require('./addressBookPostgreSQL');
} else {
  const { db } = require('../config/database');
  const fs = require('fs');
  const path = require('path');

  const ADDRESS_BOOK_JSON = path.join(__dirname, '..', 'data', 'addressBook.json');
  const allowedDistricts = new Set(['С', 'Ю', 'З', 'В', 'Ц', 'П', 'СВ', 'СЗ', 'ЮВ', 'ЮЗ']);

  function sanitizeEntryInput(input) {
    const category = String(input.category || '').trim();
    const district = String(input.district || '').trim();
    const house_number = String(input.house_number || '').trim();
    const apartment = String(input.apartment || '').trim();
    const name = String(input.name || '').trim();
    const note = String(input.note || '').trim();

    if (!category) throw new Error('category is required');
    if (!district) throw new Error('district is required');
    if (!house_number) throw new Error('house_number is required');
    if (!name) throw new Error('name is required');
    if (!allowedDistricts.has(district)) throw new Error('Unknown district');

    if (category !== 'Частные лица') {
      return { category, district, house_number, apartment: '', name, note };
    }
    return { category, district, house_number, apartment, name, note };
  }

  async function ensureSeeded() {
    const countRow = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM address_book_entries', (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (countRow && Number(countRow.count) > 0) return;

    if (!fs.existsSync(ADDRESS_BOOK_JSON)) return;

    let entries;
    try {
      const raw = fs.readFileSync(ADDRESS_BOOK_JSON, 'utf8');
      entries = JSON.parse(raw);
    } catch (e) {
      console.error('addressBook.json read error:', e);
      return;
    }

    if (!Array.isArray(entries) || entries.length === 0) return;

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO address_book_entries (category, district, house_number, apartment, name, note) VALUES (?, ?, ?, ?, ?, ?)`
        );
        for (const e of entries) {
          stmt.run([
            e.category || 'Частные лица',
            e.district || '',
            e.house_number || '',
            e.apartment || '',
            e.name || '',
            e.note || ''
          ]);
        }
        stmt.finalize((err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
          db.run('COMMIT', (commitErr) => (commitErr ? reject(commitErr) : resolve()));
        });
      });
    });
  }

  AddressBook = {
    ensureSeeded,

    listCategories: async () => {
      return new Promise((resolve, reject) => {
        db.all(
          `SELECT DISTINCT category FROM address_book_entries ORDER BY category`,
          [],
          (err, rows) => {
            if (err) return reject(err);
            resolve((rows || []).map(r => r.category));
          }
        );
      });
    },

    getEntriesByCategory: async ({ category, limit = 500, offset = 0 }) => {
      return new Promise((resolve, reject) => {
        db.all(
          `SELECT id, category, district, house_number, apartment, name, note, updated_at
           FROM address_book_entries WHERE category = ?
           ORDER BY district, house_number, apartment, name LIMIT ? OFFSET ?`,
          [category, limit, offset],
          (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
          }
        );
      });
    },

    // Глобальный поиск: вернуть все записи (будет дополнительно отфильтровано в контроллере)
    getAllEntries: async ({ limit = 50000, offset = 0 } = {}) => {
      return new Promise((resolve, reject) => {
        db.all(
          `SELECT id, category, district, house_number, apartment, name, note, updated_at
           FROM address_book_entries
           ORDER BY category, district, house_number, apartment, name
           LIMIT ? OFFSET ?`,
          [limit, offset],
          (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
          }
        );
      });
    },

    getEntryById: async (id) => {
      return new Promise((resolve, reject) => {
        db.get(
          `SELECT id, category, district, house_number, apartment, name, note, updated_at FROM address_book_entries WHERE id = ?`,
          [id],
          (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
          }
        );
      });
    },

    updateEntry: async (id, input) => {
      const entry = sanitizeEntryInput(input);
      return new Promise((resolve, reject) => {
        db.run(
          `UPDATE address_book_entries SET category = ?, district = ?, house_number = ?, apartment = ?, name = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [entry.category, entry.district, entry.house_number, entry.apartment, entry.name, entry.note, id],
          function (err) {
            if (err) return reject(err);
            resolve({ id, changes: this.changes });
          }
        );
      });
    },

    createEntry: async (input) => {
      const entry = sanitizeEntryInput(input);
      return new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO address_book_entries (category, district, house_number, apartment, name, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [entry.category, entry.district, entry.house_number, entry.apartment, entry.name, entry.note],
          function (err) {
            if (err) return reject(err);
            resolve({ id: this.lastID, ...entry });
          }
        );
      });
    },

    deleteEntry: async (id) => {
      return new Promise((resolve, reject) => {
        db.run(`DELETE FROM address_book_entries WHERE id = ?`, [id], function (err) {
          if (err) return reject(err);
          resolve({ deletedId: id, changes: this.changes });
        });
      });
    }
  };
}

module.exports = AddressBook;
