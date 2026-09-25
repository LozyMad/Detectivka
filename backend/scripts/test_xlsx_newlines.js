const XLSX = require('xlsx');

function sheetRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
}

function preserveMultiline(value) {
  if (value == null) return '';
  return String(value)
    .replace(/_x000D_/gi, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^\s+|\s+$/g, '');
}

const text = 'Первый абзац.\n\n— Второй абзац с диалогом.';
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['Район', 'Номер дома', 'Квартира', 'Информация по адресу'],
  ['Ц', '31', '4', text]
]);
XLSX.utils.book_append_sheet(wb, ws, 'Поездки');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

const formatted = XLSX.read(buf, { type: 'buffer' });
const formattedRows = XLSX.utils.sheet_to_json(formatted.Sheets['Поездки'], { header: 1, defval: '' });
const formattedDesc = String(formattedRows[1][3]);

const rawWb = XLSX.read(buf, { type: 'buffer', cellText: false, cellHTML: false });
const rawRows = sheetRows(rawWb.Sheets['Поездки']);
const rawDesc = preserveMultiline(rawRows[1][3]);

console.log('formatted has newline:', formattedDesc.includes('\n'));
console.log('raw has newline:', rawDesc.includes('\n'));
console.log('raw equals source:', rawDesc === text);
if (!rawDesc.includes('\n')) {
  process.exit(1);
}
