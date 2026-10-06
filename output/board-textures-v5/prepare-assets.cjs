const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const sharp = require(process.argv[2] || 'sharp');
const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/board-cork-frame-v5.json'), 'utf8'));
(async () => {
  fs.mkdirSync(path.join(__dirname, 'source'), { recursive: true });
  const audit = [];
  for (const asset of manifest.assets) {
    const source = path.join(root, asset.source);
    if (!fs.existsSync(source)) fs.copyFileSync(asset.generatedSource, source);
    const destination = path.join(root, asset.served);
    await sharp(source).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(destination);
    const metadata = await sharp(destination).metadata();
    const { width, height } = metadata;
    if (asset.transparent) {
      assert.ok(metadata.hasAlpha, 'Wooden frame must preserve alpha');
      const { data } = await sharp(destination).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (const y of [.25, .5, .75]) for (const x of [.25, .5, .75]) {
        assert.equal(data[(Math.floor(y * height) * width + Math.floor(x * width)) * 4 + 3], 0, 'Frame opening must be transparent');
      }
    } else {
      assert.equal(width, 1536); assert.equal(height, 1024);
    }
    audit.push({ file: asset.served, width, height, hasAlpha: metadata.hasAlpha, bytes: fs.statSync(destination).size });
  }
  const reusedNotes = manifest.reuseNotes.map(file => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') }));
  fs.writeFileSync(path.join(__dirname, 'asset-audit.json'), JSON.stringify({ assets: audit, reusedNotes }, null, 2));
  console.log(JSON.stringify(audit));
})().catch(error => { console.error(error); process.exitCode = 1; });
