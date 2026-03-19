const { query, getClient } = require('../config/postgresql');
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
  const res = await query('SELECT COUNT(*)::int AS count FROM address_book_entries');
  const count = res?.rows?.[0]?.count || 0;
  if (count > 0) return;

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

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const batchSize = 100;
    for (let i = 0; i < entries.length; i += batchSize) {
      const chunk = entries.slice(i, i + batchSize);
      const values = [];
      const placeholders = chunk.map((e, idx) => {
        const base = idx * 6;
        values.push(
          e.category || 'Частные лица',
          e.district || '',
          e.house_number || '',
          e.apartment || '',
          e.name || '',
          e.note || ''
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`;
      });
      await client.query(
        `INSERT INTO address_book_entries (category, district, house_number, apartment, name, note)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (category, district, house_number, apartment, name) DO NOTHING`,
        values
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const AddressBook = {
  ensureSeeded,

  listCategories: async () => {
    const res = await query(
      `SELECT DISTINCT category FROM address_book_entries ORDER BY category`
    );
    return (res.rows || []).map(r => r.category);
  },

  getEntriesByCategory: async ({ category, limit = 500, offset = 0 }) => {
    const res = await query(
      `SELECT id, category, district, house_number, apartment, name, note, updated_at
       FROM address_book_entries WHERE category = $1
       ORDER BY district, house_number, apartment, name LIMIT $2 OFFSET $3`,
      [category, limit, offset]
    );
    return res.rows || [];
  },

  getEntryById: async (id) => {
    const res = await query(
      `SELECT id, category, district, house_number, apartment, name, note, updated_at FROM address_book_entries WHERE id = $1`,
      [id]
    );
    return (res.rows || [])[0] || null;
  },

  updateEntry: async (id, input) => {
    const entry = sanitizeEntryInput(input);
    const res = await query(
      `UPDATE address_book_entries SET category = $1, district = $2, house_number = $3, apartment = $4, name = $5, note = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7`,
      [entry.category, entry.district, entry.house_number, entry.apartment, entry.name, entry.note, id]
    );
    return { id, changes: res.rowCount || 0 };
  },

  createEntry: async (input) => {
    const entry = sanitizeEntryInput(input);
    const res = await query(
      `INSERT INTO address_book_entries (category, district, house_number, apartment, name, note, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
       RETURNING id, category, district, house_number, apartment, name, note`,
      [entry.category, entry.district, entry.house_number, entry.apartment, entry.name, entry.note]
    );
    return (res.rows || [])[0];
  },

  deleteEntry: async (id) => {
    const res = await query('DELETE FROM address_book_entries WHERE id = $1', [id]);
    return { deletedId: id, changes: res.rowCount || 0 };
  }
};

module.exports = AddressBook;
