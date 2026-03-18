// Адресная книга (глобальные адреса для города)
// Хранится в основной базе (database.sqlite / PostgreSQL main schema).

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let AddressBook;

if (DB_TYPE === 'postgresql') {
  AddressBook = require('./addressBookPostgreSQL');
} else {
  const { db } = require('../config/database');
  const {
    parseAddressBookXlsx,
    parseAddressBookXlsxFromBuffer,
    DEFAULT_ADDRESS_BOOK_XLSX_PATH
  } = require('../utils/addressBookImport');
  const fs = require('fs');

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
      // Для “Предприятий” квартиры не используются в XLSX
      return { category, district, house_number, apartment: '', name, note };
    }

    return { category, district, house_number, apartment, name, note };
  }

  async function ensureImported({ filePath } = {}) {
    const countRow = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM address_book_entries', (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (countRow && Number(countRow.count) > 0) return;

    const usedPath = filePath || process.env.ADDRESS_BOOK_XLSX_PATH || DEFAULT_ADDRESS_BOOK_XLSX_PATH;
    if (!fs.existsSync(usedPath)) {
      throw new Error(
        `Адресная книга XLSX не найдена: ${usedPath}. ` +
        'Загрузите файл в админке (суперадмин) или задайте env ADDRESS_BOOK_XLSX_PATH.'
      );
    }

    const { entries } = parseAddressBookXlsx(usedPath);

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        const stmt = db.prepare(
          `INSERT OR IGNORE INTO address_book_entries 
           (category, district, house_number, apartment, name, note)
           VALUES (?, ?, ?, ?, ?, ?)`
        );

        for (const e of entries) {
          stmt.run([e.category, e.district, e.house_number, e.apartment || '', e.name, e.note || '']);
        }

        stmt.finalize((err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
          db.run('COMMIT', (commitErr) => {
            if (commitErr) return reject(commitErr);
            resolve();
          });
        });
      });
    });
  }

  AddressBook = {
    ensureImported,

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
           FROM address_book_entries
           WHERE category = ?
           ORDER BY district, house_number, apartment, name
           LIMIT ? OFFSET ?`,
          [category, limit, offset],
          (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
          }
        );
      });
    },

    getEntryById: async (id) => {
      return new Promise((resolve, reject) => {
        db.get(
          `SELECT id, category, district, house_number, apartment, name, note, updated_at
           FROM address_book_entries
           WHERE id = ?`,
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
          `UPDATE address_book_entries
           SET category = ?, district = ?, house_number = ?, apartment = ?, name = ?, note = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
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
          `INSERT INTO address_book_entries (category, district, house_number, apartment, name, note, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
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
    },

    resetAndLoadFromBuffer: async (buffer) => {
      const { entries } = parseAddressBookXlsxFromBuffer(buffer);
      if (!entries || !entries.length) return { loaded: 0 };

      await new Promise((resolve, reject) => {
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');

          db.run(`DELETE FROM address_book_entries`, [], (delErr) => {
            if (delErr) {
              db.run('ROLLBACK');
              return reject(delErr);
            }

            const stmt = db.prepare(
              `INSERT INTO address_book_entries 
               (category, district, house_number, apartment, name, note)
               VALUES (?, ?, ?, ?, ?, ?)`
            );

            for (const e of entries) {
              stmt.run([e.category, e.district, e.house_number, e.apartment || '', e.name, e.note || '']);
            }

            stmt.finalize((insErr) => {
              if (insErr) {
                db.run('ROLLBACK');
                return reject(insErr);
              }
              db.run('COMMIT', (commitErr) => {
                if (commitErr) return reject(commitErr);
                resolve();
              });
            });
          });
        });
      });

      return { loaded: entries.length };
    }
  };
}

module.exports = AddressBook;

