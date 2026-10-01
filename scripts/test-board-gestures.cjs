const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise the actual board event handlers without browser-specific synthetic input.
class Element {
  constructor(id) {
    this.id = id; this.style = { setProperty(name, value) { this[name] = value; } }; this.dataset = {}; this.hidden = true;
    this.clientWidth = 356; this.clientHeight = 620; this.clientLeft = 0; this.clientTop = 0;
    this.scrollLeft = 400; this.scrollTop = 300;
    this.events = new Map(); this.captures = new Set(); this.classes = new Set();
    this.classList = { add: c => this.classes.add(c), remove: c => this.classes.delete(c), contains: c => this.classes.has(c) };
  }
  addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
  async emit(name, event) { for (const callback of this.events.get(name) || []) await callback(event); }
  closest(selector) { return selector === '.investigation-note' && this.dataset.id ? this : null; }
  getBoundingClientRect() { return { left: 20, top: 100 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  focus() {}
}

async function test() {
  const elements = new Map(), requests = [];
  const element = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const sandbox = {
    document: { getElementById: element, addEventListener() {}, querySelector: () => null },
    window: { addEventListener() {} }, gameStorage: { getItem: () => 'test' },
    ResizeObserver: class { observe() {} }, setTimeout: () => 0, clearTimeout() {},
    requestAnimationFrame: callback => callback(), alert: () => {}, confirm: () => true,
    fetch: async (url, options) => {
      requests.push({ url, ...options, data: options.body && JSON.parse(options.body) });
      return { ok: true, json: async () => ({ link: { id: 1, note_a: 10, note_b: 11 } }) };
    }
  };
  const source = fs.readFileSync('frontend/js/investigation-board.js', 'utf8')
    .replace('window.investigationBoard = { show, openFromTrip, hide: clearSelection };', 'window.investigationBoard = { show, openFromTrip, hide: clearSelection, init, state };');
  vm.runInNewContext(source, sandbox);
  const board = sandbox.window.investigationBoard;
  board.init();
  assert.equal((element('boardColorOptions').innerHTML.match(/type="radio"/g) || []).length, 5);
  board.state.notes = [{ id: 10, x: 950, y: 600, title: 'A' }, { id: 11, x: 1280, y: 600, title: 'B' }];
  board.state.zoom = .5;
  const viewport = element('boardViewport');
  const a = new Element('a'); a.dataset.id = '10';
  const b = new Element('b'); b.dataset.id = '11';
  async function pointer(type, id, x, y, target = viewport) {
    await viewport.emit(type, { type, pointerId: id, pointerType: 'touch', button: 0,
      clientX: x, clientY: y, target, preventDefault() {} });
  }
  const tap = async target => { await pointer('pointerdown', 1, 100, 200, target); await pointer('pointerup', 1, 100, 200, target); };
  await tap(a);
  assert.equal(board.state.pendingLink, 10);
  assert.equal(element('boardNoteOverlay').hidden, true);
  await tap(b);
  // selectNote initiates the async request from the pointer handler.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.filter(r => r.url.endsWith('/links')).length, 1);
  assert.equal(board.state.pendingLink, null);
  await tap(a); await tap(a);
  assert.equal(board.state.pendingLink, null);

  await pointer('pointerdown', 1, 100, 200, a);
  await pointer('pointermove', 1, 160, 230, a);
  await pointer('pointerup', 1, 160, 230, a);
  assert.equal(board.state.notes[0].x, 1070);
  assert.equal(board.state.notes[0].y, 660);
  assert.equal(requests.filter(r => r.url.endsWith('/position')).length, 1);
  assert.equal(board.state.pendingLink, null);

  const original = { ...board.state.notes[0] };
  viewport.scrollLeft = 400; viewport.scrollTop = 300;
  await pointer('pointerdown', 1, 100, 200, a);
  await pointer('pointermove', 1, 120, 200, a);
  assert.notEqual(board.state.notes[0].x, original.x);
  await pointer('pointerdown', 2, 220, 200);
  assert.equal(board.state.notes[0].x, original.x);
  // Pinch anchor is the board point under the initial midpoint (170, 200).
  const anchorX = (400 + 170 - 20) / .5;
  const anchorY = (300 + 200 - 100) / .5;
  await pointer('pointermove', 1, 70, 200);
  await pointer('pointermove', 2, 270, 200);
  assert.equal(board.state.zoom, 1);
  assert.equal((viewport.scrollLeft + 170 - 20) / board.state.zoom, anchorX);
  assert.equal((viewport.scrollTop + 200 - 100) / board.state.zoom, anchorY);
  await pointer('pointerup', 2, 270, 200);
  await pointer('pointerup', 1, 70, 200);
  assert.equal(requests.filter(r => r.url.endsWith('/position')).length, 1);
  assert.equal(board.state.pendingLink, null);

  await pointer('pointerdown', 1, 100, 200);
  await pointer('pointerdown', 2, 200, 200);
  await pointer('pointermove', 2, 110, 200);
  assert.equal(board.state.zoom, .4);
  await pointer('pointermove', 2, 500, 200);
  assert.equal(board.state.zoom, 2.5);
  await pointer('pointercancel', 1, 100, 200);
  await pointer('pointercancel', 2, 500, 200);
  assert.equal(viewport.captures.size, 0);
  assert.equal(viewport.classList.contains('is-panning'), false);

  // The board texture always covers the viewport at the minimum zoom.
  await element('boardZoomOut').emit('click', {});
  for (let i = 0; i < 20; i++) await element('boardZoomOut').emit('click', {});
  assert.equal(board.state.zoom, .4);
  assert.ok(board.state.width * .4 >= viewport.clientWidth);
  assert.ok(board.state.height * .4 >= viewport.clientHeight);
  board.state.notes[0].color = 'orange';
  board.state.notes[1].color = 'mint';
  board.hide();
  assert.match(element('boardNotes').innerHTML, /data-id="10" data-color="yellow"/);
  assert.match(element('boardNotes').innerHTML, /data-id="11" data-color="green"/);
  assert.equal(board.state.notes[0].color, 'orange', 'rendering preserves saved legacy notes');
  assert.equal(board.state.notes[1].color, 'mint');
  assert.ok(!elements.has('boardPins'), 'the artwork already includes pins');
  console.log('PASS: tap linking, deselection, drag/save, pinch anchor, interrupted drag, limits and cancellation');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
