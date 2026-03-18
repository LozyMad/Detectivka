const AddressBook = require('../models/addressBook');

const LETTER_TABS = ['А-Е', 'Б-И', 'К-Л', 'М-Н', 'О-П', 'Р-С', 'Т-Ф', 'Х-Я'];

function normalizeCellText(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function letterGroupForName(name) {
  const raw = normalizeCellText(name);
  if (!raw) return null;

  let ch = raw[0].toUpperCase();
  if (ch === 'Ё') ch = 'Е';
  if (ch === 'Й') ch = 'И';
  const alphabet = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
  const idx = alphabet.indexOf(ch);
  if (idx === -1) return null;

  const inRange = (from, to) => {
    const a = alphabet.indexOf(from);
    const b = alphabet.indexOf(to);
    if (a === -1 || b === -1) return false;
    return idx >= a && idx <= b;
  };

  if (inRange('А', 'Е')) return 'А-Е';
  if (inRange('Б', 'И')) return 'Б-И';
  if (inRange('К', 'Л')) return 'К-Л';
  if (inRange('М', 'Н')) return 'М-Н';
  if (inRange('О', 'П')) return 'О-П';
  if (inRange('Р', 'С')) return 'Р-С';
  if (inRange('Т', 'Ф')) return 'Т-Ф';
  if (inRange('Х', 'Я')) return 'Х-Я';
  return null;
}

function orderEnterpriseCategories(categories) {
  // Порядок ближе к референсу (если категории отсутствуют — пропускаем).
  const preferred = [
    'Муниципальные и государственные учреждения',
    'Почта',
    'Транспорт',
    'Торговля и услуги',
    'Финансовые учреждения',
    'Медицина',
    'Промышленные и коммунальные объекты',
    'СМИ',
    'Экстренные службы',
    'Культура и отдых',
    'Места для ночлега',
    'Религиозные и мемориальные объекты',
    'Учебные заведения'
  ];

  const set = new Set(categories || []);
  const ordered = [];
  for (const p of preferred) if (set.has(p)) ordered.push(p);
  for (const c of categories || []) if (!ordered.includes(c) && c !== 'Частные лица') ordered.push(c);
  return ordered;
}

async function getAddressBookSections(req, res) {
  try {
    await AddressBook.ensureImported();
    const categories = await AddressBook.listCategories();

    const privateCategory = 'Частные лица';
    const enterpriseCategories = orderEnterpriseCategories(categories.filter((c) => c !== privateCategory));

    res.json({
      private_category: privateCategory,
      private_letter_groups: LETTER_TABS,
      enterprise_categories: enterpriseCategories
    });
  } catch (err) {
    console.error('getAddressBookSections error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

async function getAddressBookEntries(req, res) {
  try {
    const { category, letter_group: letterGroup, q, limit, offset } = req.query || {};

    if (!category) return res.status(400).json({ error: 'category is required' });

    await AddressBook.ensureImported();
    const lim = Math.max(1, Number(limit || 500));
    const off = Math.max(0, Number(offset || 0));

    let entries = await AddressBook.getEntriesByCategory({ category, limit: lim + off, offset: 0 });

    if (category === 'Частные лица' && letterGroup) {
      entries = entries.filter((e) => letterGroupForName(e.name) === letterGroup);
    }

    if (q) {
      const query = String(q).toLowerCase();
      entries = entries.filter((e) => {
        const hay = `${e.district} ${e.house_number} ${e.apartment || ''} ${e.name || ''} ${e.note || ''}`.toLowerCase();
        return hay.includes(query);
      });
    }

    // pagination (простая обрезка после фильтрации)
    const total = entries.length;
    entries = entries.slice(off, off + lim);

    res.json({ entries, total, category, letter_group: letterGroup || null });
  } catch (err) {
    console.error('getAddressBookEntries error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

async function getAddressBookEntryById(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const entry = await AddressBook.getEntryById(id);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    res.json({ entry });
  } catch (err) {
    console.error('getAddressBookEntryById error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

async function createAddressBookEntry(req, res) {
  try {
    const input = req.body || {};
    const created = await AddressBook.createEntry(input);
    res.status(201).json({ entry: created });
  } catch (err) {
    console.error('createAddressBookEntry error:', err);
    res.status(400).json({ error: err.message || 'Bad request' });
  }
}

async function updateAddressBookEntry(req, res) {
  try {
    const { id } = req.params;
    const input = req.body || {};
    const updated = await AddressBook.updateEntry(id, input);
    res.json({ entry: updated });
  } catch (err) {
    console.error('updateAddressBookEntry error:', err);
    res.status(400).json({ error: err.message || 'Bad request' });
  }
}

async function deleteAddressBookEntry(req, res) {
  try {
    const { id } = req.params;
    const deleted = await AddressBook.deleteEntry(id);
    res.json({ deleted });
  } catch (err) {
    console.error('deleteAddressBookEntry error:', err);
    res.status(400).json({ error: err.message || 'Bad request' });
  }
}

module.exports = {
  getAddressBookSections,
  getAddressBookEntries,
  getAddressBookEntryById,
  createAddressBookEntry,
  updateAddressBookEntry,
  deleteAddressBookEntry
};

