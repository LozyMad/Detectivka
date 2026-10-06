const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const hashes = {
  'frontend/assets/board/red-thread.opt.webp': '1cce154ff70d5836bb780a69e091c4084302a2d8b87f78f53528af99b235eba5'
};
for (const [file, expected] of Object.entries(hashes)) {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), expected, file);
}
const current = fs.readFileSync('frontend/css/investigation-board.css', 'utf8');
const original = execFileSync('git', ['show', 'HEAD:frontend/css/investigation-board.css'], { encoding: 'utf8' });
const thread = source => source.slice(source.indexOf('.board-thread-segment {'), source.indexOf('.board-note-overlay {')).replace(/\r\n/g, '\n');
assert.equal(thread(current), thread(original));
let count = 0;
for (const file of ['frontend/css/investigation-board.css', 'frontend/css/landing-product.css']) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/url\(['"]([^'"]+)['"]\)/g)) {
    const target = path.resolve(path.dirname(file), match[1].split('?')[0]);
    assert.ok(fs.existsSync(target), `Missing image: ${target}`);
    count++;
  }
}
console.log(`PASS: thread artwork and appearance unchanged; ${count} stylesheet image references exist.`);
