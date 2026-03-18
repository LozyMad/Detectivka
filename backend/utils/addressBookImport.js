const XLSX = require('xlsx');
const path = require('path');

const DEFAULT_ADDRESS_BOOK_XLSX_PATH = path.join(
  __dirname,
  '..',
  '..',
  'Адресная книга',
  'Адресная книга (1).xlsx'
);

function normalizeCellText(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function pickNonEmptyCells(row) {
  const result = [];
  for (const cell of row) {
    const t = normalizeCellText(cell);
    if (t) result.push(t);
  }
  return result;
}

function parseLetterGroupFromName(name) {
  // По референсу: группы букв для вкладок “Частные лица”
  const raw = normalizeCellText(name);
  if (!raw) return null;

  let ch = raw[0].toUpperCase();
  // Нормализация частых “не-русских” вариантов
  if (ch === 'Ё') ch = 'Е';
  if (ch === 'Й') ch = 'И';
  if (ch < 'А' || ch > 'Я') return null;

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

function computeAllCategoriesFromWorkbook(wb) {
  const categories = new Set();
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    for (const row of rows) {
      const picked = pickNonEmptyCells(row || []);
      if (picked.length === 1) {
        const v = picked[0];
        // В первой строке листов часто лежит название района (например “Северный район”),
        // это не “категория адресной книги”, поэтому исключаем совпадения с sheetName.
        if (v && !v.startsWith('Адресная книга') && v !== sheetName) categories.add(v);
      }
    }
  }
  return categories;
}

function parseAddressBookXlsx(filePath) {
  const addressBookXlsxPath = filePath || DEFAULT_ADDRESS_BOOK_XLSX_PATH;
  const wb = XLSX.readFile(addressBookXlsxPath, { cellDates: true });

  const categories = computeAllCategoriesFromWorkbook(wb);

  const entries = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

    let currentCategory = null;
    for (const row of rows) {
      const picked = pickNonEmptyCells(row || []);

      if (picked.length === 0) continue;

      if (picked.length === 1) {
        const v = picked[0];
        if (categories.has(v)) {
          currentCategory = v;
        }
        continue;
      }

      if (!currentCategory) continue;

      if (currentCategory === 'Частные лица') {
        // Структура: [Район, Номер дома, Квартира, Имя/название, (необяз.) Примечание]
        if (picked.length >= 4) {
          const district = picked[0];
          const house_number = picked[1];
          const apartment = picked[2] || '';
          const name = picked[3] || '';
          const note = picked[4] || '';

          entries.push({
            category: currentCategory,
            district,
            house_number,
            apartment,
            name,
            note,
            _letter_group: parseLetterGroupFromName(name)
          });
        }
      } else {
        // Структура: [Район, Номер дома, Имя/название, (необяз.) Категория]
        if (picked.length >= 3) {
          const district = picked[0];
          const house_number = picked[1];
          const name = picked[2] || '';
          const categoryFromRow = picked[3] && categories.has(picked[3]) ? picked[3] : currentCategory;

          entries.push({
            category: categoryFromRow,
            district,
            house_number,
            apartment: '',
            name,
            note: '',
            _letter_group: null
          });
        }
      }
    }
  }

  return { entries, categories: Array.from(categories) };
}

module.exports = {
  DEFAULT_ADDRESS_BOOK_XLSX_PATH,
  parseAddressBookXlsx
};

