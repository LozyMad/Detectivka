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

  function loadSeedEntries() {
    if (!fs.existsSync(ADDRESS_BOOK_JSON)) return [];
    try {
      const raw = fs.readFileSync(ADDRESS_BOOK_JSON, 'utf8');
      const entries = JSON.parse(raw);
      return Array.isArray(entries) ? entries : [];
    } catch (e) {
      console.error('addressBook.json read error:', e);
      return [];
    }
  }

  function swapTwoWordName(name) {
    const parts = String(name || '').trim().split(/\s+/);
    if (parts.length !== 2) return null;
    return `${parts[1]} ${parts[0]}`;
  }

  /** Одноразовая миграция: частные лица «Имя Фамилия» → «Фамилия Имя» (по seed). */
  async function ensurePrivateNamesSurnameFirst() {
    const seedNames = new Set(
      loadSeedEntries()
        .filter((e) => e.category === 'Частные лица' && e.name)
        .map((e) => String(e.name).trim())
    );
    if (seedNames.size === 0) return;

    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, name FROM address_book_entries WHERE category = ?`,
        ['Частные лица'],
        (err, result) => (err ? reject(err) : resolve(result || []))
      );
    });

    const updates = [];
    for (const row of rows) {
      const current = String(row.name || '').trim();
      if (!current || seedNames.has(current)) continue;
      const swapped = swapTwoWordName(current);
      if (swapped && seedNames.has(swapped)) {
        updates.push({ id: row.id, name: swapped });
      }
    }
    if (updates.length === 0) return;

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const stmt = db.prepare(
          `UPDATE address_book_entries SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        );
        for (const u of updates) stmt.run([u.name, u.id]);
        stmt.finalize((err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
          db.run('COMMIT', (commitErr) => {
            if (commitErr) return reject(commitErr);
            console.log(`[AddressBook] Renamed ${updates.length} private entries to surname-first`);
            resolve();
          });
        });
      });
    });
  }

  async function ensureSeeded() {
    const countRow = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM address_book_entries', (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (!(countRow && Number(countRow.count) > 0)) {
      const entries = loadSeedEntries();
      if (entries.length > 0) {
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
    }

    await ensurePrivateNamesSurnameFirst();
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

    /** Имена/названия из адресной книги по адресу (район + дом + квартира). */
    findNamesByAddress: async ({ district, house_number, apartment = '' } = {}) => {
      const d = String(district || '').trim();
      const h = String(house_number || '').trim();
      const apt = String(apartment ?? '').trim();
      if (!d || !h) return [];
      return new Promise((resolve, reject) => {
        db.all(
          `SELECT DISTINCT name FROM address_book_entries
           WHERE district = ? AND house_number = ? AND COALESCE(apartment, '') = ?
           ORDER BY name`,
          [d, h, apt],
          (err, rows) => {
            if (err) return reject(err);
            resolve((rows || []).map(r => r.name).filter(Boolean));
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
