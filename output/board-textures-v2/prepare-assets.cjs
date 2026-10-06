const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');
const root = path.resolve(__dirname, '../..');
const assets = [{"key":"metal-surface-v2-final","file":"metal-surface-v2","generatedPath":"C:\\Users\\Lozy\\.codex\\generated_images\\01a1109b-2c69-7832-a7b7-3bb53fd3cc64\\exec-4b35d3ed-e159-4036-a370-fd3009c4a843.png"},{"key":"metal-frame-v2","file":"metal-frame-v2","generatedPath":"C:\\Users\\Lozy\\.codex\\generated_images\\01a1109b-2c69-7832-a7b7-3bb53fd3cc64\\exec-e0921d72-366c-4643-b60c-0d55f986d330.png"},{"key":"note-yellow-magnet-v2","file":"note-yellow-magnet-v2","generatedPath":"C:\\Users\\Lozy\\.codex\\generated_images\\01a1109b-2c69-7832-a7b7-3bb53fd3cc64\\exec-a7221c50-57d8-4aef-ac8b-5545e18d1c05.png"},{"key":"note-pink-magnet-v2","file":"note-pink-magnet-v2","generatedPath":"C:\\Users\\Lozy\\.codex\\generated_images\\01a1109b-2c69-7832-a7b7-3bb53fd3cc64\\exec-87b4834a-7652-43d9-8f23-cb31f252c668.png"},{"key":"note-blue-magnet-v2","file":"note-blue-magnet-v2","generatedPath":"C:\\Users\\Lozy\\.codex\\generated_images\\01a1109b-2c69-7832-a7b7-3bb53fd3cc64\\exec-2e5d8c70-463b-4b06-81b0-af2856299b56.png"},{"key":"note-green-magnet-v2","file":"note-green-magnet-v2","generatedPath":"C:\\Users\\Lozy\\.codex\\generated_images\\01a1109b-2c69-7832-a7b7-3bb53fd3cc64\\exec-c60c4810-9c4e-46df-89e1-1573ea2432d7.png"},{"key":"note-purple-magnet-v2","file":"note-purple-magnet-v2","generatedPath":"C:\\Users\\Lozy\\.codex\\generated_images\\01a1109b-2c69-7832-a7b7-3bb53fd3cc64\\exec-324d20cc-07b6-4ad7-a30b-541180e5ffdc.png"}];
(async () => {
  fs.mkdirSync(path.join(__dirname, 'source'), { recursive: true });
  const measurements = [];
  for (const asset of assets) {
    const source = path.join(__dirname, 'source', `${asset.file}.png`);
    if (!fs.existsSync(source)) fs.copyFileSync(asset.generatedPath, source);
    const destination = path.join(root, 'frontend/assets/board', `${asset.file}.webp`);
    const surface = asset.file === 'metal-surface-v2';
    await sharp(source).resize(surface ? 1536 : 768, surface ? 1024 : 768, { fit: 'fill' })
      .webp({ quality: surface ? 84 : 88, alphaQuality: 100, effort: 6 }).toFile(destination);
    const metadata = await sharp(destination).metadata();
    if (!surface && !metadata.hasAlpha) throw new Error(`Missing transparency: ${asset.file}`);
    if (!surface) {
      const { data, info } = await sharp(destination).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (asset.file.startsWith('note-') && data[3] > 4) throw new Error(`Opaque outer corner: ${asset.file}`);
      if (asset.file === 'metal-frame-v2' && data[((384 * info.width + 384) * 4) + 3] !== 0)
        throw new Error('Metal frame center must be transparent');
    }
    measurements.push({ file: asset.file, width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha,
      sourceBytes: fs.statSync(source).size, servedBytes: fs.statSync(destination).size });
  }
  fs.writeFileSync(path.join(__dirname, 'asset-audit.json'), JSON.stringify(measurements, null, 2) + '\n');
  console.log(JSON.stringify({ measurements, totalBytes: measurements.reduce((sum, a) => sum + a.servedBytes, 0) }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
