const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', 'uploads', 'scenario-applications');
const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf'
};

function positiveId(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Неверный идентификатор');
  return number;
}

function folder(scenarioId, addressId, number) {
  return path.join(ROOT, String(positiveId(scenarioId)), String(positiveId(addressId)), String(positiveId(number)));
}

function briefingFolder(scenarioId) {
  return path.join(ROOT, String(positiveId(scenarioId)), 'briefing');
}

function detectType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

// Multer/Busboy reads multipart filenames as latin1. Browsers send UTF-8 bytes,
// so Cyrillic names arrive as "Ð..." unless decoded explicitly.
function decodeFilename(value) {
  const name = String(value || '');
  if (!/[ÐÑ]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return !decoded.includes('\uFFFD') && /[\u0400-\u04FF]/.test(decoded) ? decoded : name;
}

async function list(scenarioId, addressId) {
  const addressFolder = path.dirname(folder(scenarioId, addressId, 1));
  const entries = await fs.readdir(addressFolder, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const applications = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[1-9]\d*$/.test(entry.name)) continue;
    const app = await get(scenarioId, addressId, entry.name);
    if (app) applications.push(app);
  }
  return applications.sort((a, b) => a.number - b.number);
}

async function get(scenarioId, addressId, number) {
  return getAt(folder(scenarioId, addressId, number), positiveId(number));
}

async function getAt(target, number = null) {
  const manifestPath = path.join(target, 'manifest.json');
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    let repaired = false;
    for (const file of manifest.files || []) {
      const decoded = decodeFilename(file.name);
      if (decoded !== file.name) { file.name = decoded; repaired = true; }
    }
    if (repaired) await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    return { ...(number === null ? {} : { number }), files: manifest.files || [] };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function save(scenarioId, addressId, number, files) {
  return saveAt(folder(scenarioId, addressId, number), files, positiveId(number));
}

async function saveAt(target, files, number = null) {
  if (!files?.length) throw new Error('Выберите папку с изображениями или PDF');
  if (files.length > 30) throw new Error('В одном приложении может быть не больше 30 файлов');
  if (files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) {
    throw new Error('Размер папки не должен превышать 100 МБ');
  }
  const items = files.map(file => {
    const name = path.basename(decodeFilename(file.originalname).replace(/\\/g, '/')).replace(/[\x00-\x1f]/g, '').trim();
    const extension = path.extname(name).toLowerCase();
    const type = detectType(file.buffer);
    if (!name || !TYPES[extension] || TYPES[extension] !== type) {
      throw new Error('Разрешены только изображения PNG, JPG, WEBP и PDF');
    }
    return { name, type, size: file.size, data: file.buffer, id: crypto.randomUUID() + extension };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  const staging = target + '.upload-' + crypto.randomUUID();
  const backup = target + '.backup-' + crypto.randomUUID();
  await fs.mkdir(staging, { recursive: true });
  try {
    for (const item of items) await fs.writeFile(path.join(staging, item.id), item.data);
    const manifest = { files: items.map(({ id, name, type, size }) => ({ id, name, type, size })) };
    await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    let hadPrevious = false;
    try { await fs.rename(target, backup); hadPrevious = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await fs.rename(staging, target); } catch (error) {
      if (hadPrevious) await fs.rename(backup, target);
      throw error;
    }
    if (hadPrevious) await fs.rm(backup, { recursive: true, force: true });
    return { ...(number === null ? {} : { number }), files: manifest.files };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function getFile(scenarioId, addressId, number, fileId) {
  const application = await get(scenarioId, addressId, number);
  const file = application?.files.find(item => item.id === fileId);
  return file ? { ...file, path: path.join(folder(scenarioId, addressId, number), file.id) } : null;
}

async function getBriefingFile(scenarioId, fileId) {
  const briefing = await getBriefing(scenarioId);
  const file = briefing?.files.find(item => item.id === fileId);
  return file ? { ...file, path: path.join(briefingFolder(scenarioId), file.id) } : null;
}

const getBriefing = scenarioId => getAt(briefingFolder(scenarioId));
const saveBriefing = (scenarioId, files) => saveAt(briefingFolder(scenarioId), files);
const removeBriefing = scenarioId => fs.rm(briefingFolder(scenarioId), { recursive: true, force: true });

async function remove(scenarioId, addressId, number) {
  await fs.rm(folder(scenarioId, addressId, number), { recursive: true, force: true });
}

async function removeAddress(scenarioId, addressId) {
  await fs.rm(path.dirname(folder(scenarioId, addressId, 1)), { recursive: true, force: true });
}

async function removeScenario(scenarioId) {
  await fs.rm(path.join(ROOT, String(positiveId(scenarioId))), { recursive: true, force: true });
}

async function copyScenario(sourceId, targetId, addressIdMap) {
  for (const [oldId, newId] of Object.entries(addressIdMap)) {
    const source = path.dirname(folder(sourceId, oldId, 1));
    const target = path.dirname(folder(targetId, newId, 1));
    try { await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try { await fs.cp(briefingFolder(sourceId), briefingFolder(targetId), { recursive: true, errorOnExist: true, force: false }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

module.exports = { list, get, save, getFile, remove, removeAddress, removeScenario, copyScenario, positiveId,
  getBriefing, saveBriefing, getBriefingFile, removeBriefing, detectType, decodeFilename };
