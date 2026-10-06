const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');
const root = path.resolve(__dirname, '../..');
const generated = 'C:/Users/Lozy/.codex/generated_images/01a1109b-2c69-7832-a7b7-3bb53fd3cc64/exec-a4bc7eb4-5df0-4028-92b0-529688ec14b8.png';
(async () => {
  const source = path.join(__dirname, 'source/metal-surface-v4.png');
  if (!fs.existsSync(source)) fs.copyFileSync(generated, source);
  const destination = path.join(root, 'frontend/assets/board/metal-surface-v4.webp');
  await sharp(source).webp({ quality: 96, effort: 6 }).toFile(destination);
  const { width, height } = await sharp(destination).metadata();
  const data = fs.readFileSync(destination).toString('base64');
  // Matched edge pixels prevent seams, while the uniform material avoids a visible mirrored motif.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width * 2}" height="${height * 2}" viewBox="0 0 ${width * 2} ${height * 2}"><defs><image id="steel" width="${width}" height="${height}" xlink:href="data:image/webp;base64,${data}"/></defs><use xlink:href="#steel"/><use xlink:href="#steel" transform="translate(${width * 2} 0) scale(-1 1)"/><use xlink:href="#steel" transform="translate(0 ${height * 2}) scale(1 -1)"/><use xlink:href="#steel" transform="translate(${width * 2} ${height * 2}) scale(-1 -1)"/></svg>`;
  fs.writeFileSync(path.join(root, 'frontend/assets/board/metal-surface-repeat-v4.svg'), svg);
  console.log(JSON.stringify({ width, height, webpBytes: fs.statSync(destination).size }));
})().catch(error => { console.error(error); process.exitCode = 1; });
