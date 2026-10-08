const fs = require('fs');
const path = require('path');

const directory = path.join(__dirname, '..', 'uploads', 'scenario-banners');
const extensions = ['jpg', 'png', 'webp'];

function validId(id) {
  return Number.isSafeInteger(Number(id)) && Number(id) > 0;
}

function getBannerFile(id) {
  if (!validId(id)) return null;
  for (const extension of extensions) {
    const file = path.join(directory, `scenario-${Number(id)}.${extension}`);
    if (fs.existsSync(file)) return { file, extension };
  }
  return null;
}

function detectExtension(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer.subarray(0, 3).toString('hex') === 'ffd8ff') return 'jpg';
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

async function saveBanner(id, buffer) {
  if (!validId(id)) throw new Error('Invalid scenario ID');
  const extension = detectExtension(buffer);
  if (!extension) throw new Error('Supported image formats: JPG, PNG, WEBP');
  await fs.promises.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `scenario-${Number(id)}-${Date.now()}.upload`);
  const destination = path.join(directory, `scenario-${Number(id)}.${extension}`);
  try {
    await fs.promises.writeFile(temporary, buffer);
    await fs.promises.rename(temporary, destination);
    for (const other of extensions.filter(value => value !== extension)) {
      await fs.promises.rm(path.join(directory, `scenario-${Number(id)}.${other}`), { force: true });
    }
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
  }
  return destination;
}

async function deleteBanner(id) {
  if (!validId(id)) return;
  for (const extension of extensions) {
    await fs.promises.rm(path.join(directory, `scenario-${Number(id)}.${extension}`), { force: true });
  }
}

module.exports = { getBannerFile, saveBanner, deleteBanner, detectExtension };
