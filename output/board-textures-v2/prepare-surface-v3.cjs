const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');
const root = path.resolve(__dirname, '../..');
const generated = "C:\\Users\\Lozy\\.codex\\generated_images\\01a1109b-2c69-7832-a7b7-3bb53fd3cc64\\exec-82aae8b9-5df0-486c-b43d-d900cc7d3630.png";
(async () => {
  const source = path.join(__dirname, 'source/metal-surface-v3.png');
  if (!fs.existsSync(source)) fs.copyFileSync(generated, source);
  const destination = path.join(root, 'frontend/assets/board/metal-surface-v3.webp');
  await sharp(source).webp({ quality: 96, effort: 6 }).toFile(destination);
  const { width, height } = await sharp(destination).metadata();
  const data = fs.readFileSync(destination).toString('base64');
  // Reflect adjoining edges so the repeat is continuous without upscaling the raster.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width * 2}" height="${height * 2}" viewBox="0 0 ${width * 2} ${height * 2}"><defs><image id="steel" width="${width}" height="${height}" xlink:href="data:image/webp;base64,${data}"/></defs><use xlink:href="#steel"/><use xlink:href="#steel" transform="translate(${width * 2} 0) scale(-1 1)"/><use xlink:href="#steel" transform="translate(0 ${height * 2}) scale(1 -1)"/><use xlink:href="#steel" transform="translate(${width * 2} ${height * 2}) scale(-1 -1)"/></svg>`;
  const tile = path.join(root, 'frontend/assets/board/metal-surface-repeat-v3.svg');
  fs.writeFileSync(tile, svg);
  console.log(JSON.stringify({ width, height, tileWidth: width * 2, tileHeight: height * 2, webpBytes: fs.statSync(destination).size, tileBytes: fs.statSync(tile).size }));
})().catch(error => { console.error(error); process.exitCode = 1; });
