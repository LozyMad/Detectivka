const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const servicePath = path.resolve(__dirname, '../backend/services/imagePreview.js');
const serviceRequire = createRequire(servicePath);
const source = fs.readFileSync(servicePath, 'utf8');

function loadService(loadSharp) {
  const warnings = [];
  const context = {
    __dirname: path.dirname(servicePath), module: { exports: {} },
    require: name => name === 'sharp' ? loadSharp() : serviceRequire(name),
    console: { warn: (...args) => warnings.push(args) },
  };
  vm.runInNewContext(source, context, { filename: servicePath });
  return { service: context.module.exports, warnings };
}

async function test() {
  // Missing packages and incompatible native binaries must not prevent startup.
  for (const message of ["Cannot find module 'sharp'", 'Could not load sharp using the linux-x64 runtime']) {
    let attempts = 0;
    const { service, warnings } = loadService(() => { attempts++; throw new Error(message); });
    assert.equal(attempts, 0, 'optimizer is not required during server startup');
    const file = '/example/banner.png';
    for (let i = 0; i < 2; i++) {
      const result = await service.imagePreview(file, 960);
      assert.equal(result.path, file);
      assert.equal(result.type, 'image/png');
    }
    assert.equal(attempts, 1, 'a missing library is checked once per process');
    assert.equal(warnings.length, 1, 'one warning avoids flooding server logs');
  }

  const { service, warnings } = loadService(() => serviceRequire('sharp'));
  const file = path.resolve(__dirname, '../frontend/assets/board/cork.png');
  const original = fs.readFileSync(file);
  const [first, second] = await Promise.all([service.imagePreview(file, 640), service.imagePreview(file, 640)]);
  assert.equal(first.path, second.path);
  assert.equal(first.type, 'image/webp');
  const preview = await serviceRequire('sharp')(first.path).metadata();
  assert.equal(preview.width, 640);
  assert.ok(fs.statSync(first.path).size < original.length);
  assert.deepEqual(fs.readFileSync(file), original, 'the original image remains intact');
  assert.equal(warnings.length, 0);
  assert.equal(service.previewWidth('invalid', 2400), 2400);
  console.log('PASS: startup without sharp, native-load failure, original fallback, concurrent WebP preview');
}

test().catch(error => { console.error(error); process.exitCode = 1; });
