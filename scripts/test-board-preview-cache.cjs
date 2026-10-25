const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { browser, flush } = require('./test-helpers/browser-runtime.cjs');

function storage() {
  const values = new Map();
  const url = key => typeof key === 'string' ? key : key.url;
  return { values, open: async () => ({
    match: async key => values.get(url(key))?.clone(),
    put: async (key, response) => { values.set(url(key), response.clone()); },
    delete: async key => values.delete(url(key)),
    keys: async () => [...values.keys()].map(key => new Request(key))
  }) };
}

function cacheBrowser(shared = storage(), token = 'fixture-token') {
  const b = browser();
  b.values.set('token', token);
  b.run('const gameStorage = localStorage');
  b.window.caches = shared; b.window.crypto = webcrypto;
  b.window.location.origin = 'https://fixture.test'; b.sandbox.TextEncoder = TextEncoder;
  b.load('frontend/js/board-preview-cache.js');
  return { ...b, shared, cache: b.window.boardPreviewCache };
}
const thumbnail = () => new Blob(['rendered thumbnail'], { type: 'image/webp' });

test('rendered thumbnails survive reload, stay scoped to credentials and never put tokens in cache URLs', async () => {
  const first = cacheBrowser();
  await first.cache.put('12:50:4:photo.webp', thumbnail());
  const reloaded = cacheBrowser(first.shared);
  assert.equal(await (await reloaded.cache.get('12:50:4:photo.webp')).text(), 'rendered thumbnail');
  assert.ok([...first.shared.values.keys()].every(url => !url.includes('fixture-token')));
  reloaded.values.set('token', 'another-player-token');
  assert.equal(await reloaded.cache.get('12:50:4:photo.webp'), null);
  reloaded.values.set('token', 'fixture-token');
  reloaded.values.set('roomUser', JSON.stringify({ id: 17, room_id: 18 }));
  assert.equal(await reloaded.cache.get('12:50:4:photo.webp'), null);
});

test('thumbnail storage expires with the token, evicts old entries and degrades safely without storage', async () => {
  const jwt = 'header.' + Buffer.from(JSON.stringify({ exp: 1002 })).toString('base64url') + '.signature';
  const b = cacheBrowser(undefined, jwt);
  await b.cache.put('file', thumbnail());
  assert.ok(await b.cache.get('file'));
  await b.clock.advance(3000);
  assert.equal(await b.cache.get('file'), null);
  const many = cacheBrowser();
  for (let i = 0; i < 61; i++) await many.cache.put('file-' + i, thumbnail());
  assert.equal(many.shared.values.size, 60);
  assert.equal(await many.cache.get('file-0'), null);
  delete many.window.caches;
  assert.equal(await many.cache.get('file-60'), null);
  await many.cache.put('file', thumbnail());
});

test('clearing a session removes only its own thumbnails and cancels queued writes', async () => {
  const shared = storage(), a = cacheBrowser(shared, 'player-a'), b = cacheBrowser(shared, 'player-b');
  await a.cache.put('a', thumbnail()); await b.cache.put('b', thumbnail());
  const pending = a.cache.put('late', thumbnail());
  await a.cache.clearSession(); await pending;
  assert.equal(await a.cache.get('a'), null); assert.equal(await a.cache.get('late'), null);
  assert.ok(await b.cache.get('b'));
});

test('stalled browser storage gives way to network loading after half a second', async () => {
  const b = cacheBrowser();
  b.window.caches = { open: () => new Promise(() => {}) };
  const reading = b.cache.get('file');
  await b.clock.advance(500);
  assert.equal(await reading, null);
  assert.equal(b.clock.jobs.size, 0);
});

test('logout clears thumbnails before removing the player credentials', () => {
  const b = browser(), cleared = [];
  b.load('frontend/js/game-session.js');
  b.window.boardApplicationPreviews = { clear: () => cleared.push('memory') };
  b.window.boardPreviewCache = { clearSession: () => cleared.push(b.window.gameSession.storage.getItem('token')) };
  b.window.gameSession.clear();
  assert.deepEqual(cleared, ['memory', 'fixture-token']);
  assert.equal(b.window.gameSession.storage.getItem('token'), null);
});

function previewBrowser(persistent = new Map()) {
  let pdfRenders = 0, observer;
  const b = browser(call => new Response(['file'], { headers: { 'Content-Type': call.url.includes('pdf') ? 'application/pdf' : 'image/jpeg' } }));
  b.run('const gameStorage = localStorage');
  b.element('board').classList.add('active');
  const hosts = new Map();
  b.document.querySelectorAll = selector => [hosts.get(Number(selector.match(/"(\d+)"/)[1]))];
  b.document.createElement = () => ({ tagName: 'IMG' });
  b.sandbox.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observer = this; this.targets = []; }
    observe(target) { this.targets.push(target); } disconnect() { this.targets = []; }
  };
  b.window.boardPreviewCache = { get: async key => persistent.get(key), put: async (key, blob) => persistent.set(key, blob) };
  b.window.gamePdfViewer = { thumbnail: async () => { pdfRenders++; return thumbnail(); } };
  b.load('frontend/js/board-application-previews.js');
  const notes = ['photo.jpg', 'receipt.pdf'].map((file, index) => ({ id: index + 1, scenario_id: 12, application_address_id: 50,
    application_number: 4, application_file_id: file, application_file_type: file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' }));
  for (const note of notes) hosts.set(note.id, { dataset: { boardPreviewId: String(note.id), fileId: note.application_file_id },
    replaceChildren(image) { this.firstElementChild = image; } });
  return { ...b, notes, hosts, persistent, pdfRenders: () => pdfRenders,
    show() { b.window.boardApplicationPreviews.render(notes); observer.callback(observer.targets.map(target => ({ target, isIntersecting: true }))); } };
}

test('navigation and backgrounding reuse decoded images; page reload restores PDFs without downloading or rendering them', async () => {
  const first = previewBrowser(); first.show(); await flush();
  assert.equal(first.calls.length, 2); assert.equal(first.pdfRenders(), 1);
  const image = first.hosts.get(1).firstElementChild;
  first.window.boardApplicationPreviews.pause(); first.show(); await flush();
  assert.equal(first.calls.length, 2); assert.equal(first.hosts.get(1).firstElementChild, image);
  first.document.hidden = true; first.document.emit('visibilitychange');
  first.document.hidden = false; first.document.emit('visibilitychange'); await flush();
  assert.equal(first.calls.length, 2);
  first.window.boardApplicationPreviews.clear();
  const reloaded = previewBrowser(first.persistent); reloaded.show(); await flush();
  assert.equal(reloaded.calls.length, 0); assert.equal(reloaded.pdfRenders(), 0);
  assert.ok(reloaded.hosts.get(2).firstElementChild.src.startsWith('blob:'));
  reloaded.window.boardApplicationPreviews.clear();
});
