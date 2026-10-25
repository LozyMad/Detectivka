const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
let sharp;
let sharpLoadAttempted = false;

function getImageOptimizer() {
  if (!sharpLoadAttempted) {
    sharpLoadAttempted = true;
    try { sharp = require('sharp'); }
    catch (error) {
      console.warn('Image optimizer unavailable; serving original images:', error.message);
    }
  }
  return sharp;
}

const directory = path.join(__dirname, '..', 'uploads', 'image-cache');
const pending = new Map();
const widths = [640, 960, 1920, 2400];

// Fixed sizes prevent arbitrary query strings from creating unlimited variants.
function previewWidth(value, fallback = 1920) {
  return widths.includes(Number(value)) ? Number(value) : fallback;
}

async function imagePreview(file, width = 1920, quality = 90) {
  width = previewWidth(width);
  quality = quality === 85 ? 85 : 90;
  const original = { path: file, type: `image/${path.extname(file).slice(1).replace('jpg', 'jpeg')}` };
  const optimizer = getImageOptimizer();
  if (!optimizer) return original;
  try {
    const stat = await fs.stat(file);
    const key = crypto.createHash('sha256')
      .update(`${quality === 85 ? 'board-v1' : 'v1'}:${file}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${width}`)
      .digest('hex');
    const destination = path.join(directory, `${key}.webp`);
    try {
      const cached = await fs.stat(destination);
      return quality === 85 || cached.size < stat.size ? { path: destination, type: 'image/webp' } : original;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!pending.has(key)) {
      const build = (async () => {
        const image = optimizer(file, { limitInputPixels: 40_000_000 });
        const metadata = await image.metadata();
        if (metadata.pages > 1) return original;
        const buffer = await image.rotate().resize({ width, withoutEnlargement: true })
          .webp({ quality, alphaQuality: 100, effort: 4 }).toBuffer();
        await fs.mkdir(directory, { recursive: true });
        const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporary, buffer);
          await fs.rename(temporary, destination);
        } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
        return quality === 85 || buffer.length < stat.size ? { path: destination, type: 'image/webp' } : original;
      })();
      pending.set(key, build);
    }
    try { return await pending.get(key); }
    finally { pending.delete(key); }
  } catch (error) {
    console.warn('Image preview unavailable; serving original:', error.message);
    return original;
  }
}

module.exports = { imagePreview, previewWidth };
