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
  set innerHTML(value) { this.html = value; this.htmlWrites = (this.htmlWrites || 0) + 1; this.segments = null; }
  get innerHTML() { return this.html || ''; }
  querySelectorAll(selector) {
    if (selector !== '.board-thread-segment') return [];
    if (!this.segments) this.segments = [...this.innerHTML.matchAll(/data-link-id="(\d+)"/g)].map(match => {
      const segment = new Element('segment'); segment.dataset.linkId = match[1]; return segment;
    });
    return this.segments;
  }
  async emit(name, event) { for (const callback of this.events.get(name) || []) await callback(event); }
  closest(selector) { return selector === '.investigation-note' && this.dataset.id ? this : null; }
  getBoundingClientRect() { return { left: 20, top: 100 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  focus() {}
}

async function test() {
  const elements = new Map(), requests = [], frames = new Map(), windowEvents = new Map();
  let frameId = 0, failDelete = false;
  const paintFrame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  const element = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const sandbox = {
    document: { getElementById: element, addEventListener() {}, querySelector: () => null },
    window: { addEventListener(name, callback) { windowEvents.set(name, callback); } }, gameStorage: { getItem: () => 'test' },
    ResizeObserver: class { observe() {} }, setTimeout: () => 0, clearTimeout() {},
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id), alert: () => {},
    confirm: () => { throw new Error('Deleting a thread must not ask for confirmation'); },
    fetch: async (url, options) => {
      requests.push({ url, ...options, data: options.body && JSON.parse(options.body) });
      if (failDelete && options.method === 'DELETE') {
        failDelete = false;
        return { ok: false, status: 503, json: async () => ({ error: 'Temporary error' }) };
      }
      return { ok: true, json: async () => ({ link: { id: 1, note_a: 10, note_b: 11 } }) };
    }
  };
  sandbox.window.gameNetwork = { fetch: sandbox.fetch };
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
  assert.equal(board.state.links.length, 1);
  // Selecting an existing pair toggles the thread off, in either order.
  await tap(b); await tap(a);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.filter(r => r.method === 'DELETE').length, 1);
  assert.equal(requests.filter(r => r.url.endsWith('/links')).length, 1);
  assert.equal(board.state.links.length, 0);
  assert.equal(board.state.pendingLink, null);
  await tap(a); await tap(b);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(board.state.links.length, 1);
  failDelete = true;
  await tap(a); await tap(b);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(board.state.links.length, 1, 'failed deletion preserves the existing thread');
  assert.equal(board.state.pendingLink, null);
  assert.equal(board.state.connecting, false);
  assert.equal(element('boardStatus').textContent, 'Temporary error');
  const threadTarget = { closest: () => ({ dataset: { linkId: '1' } }) };
  await element('boardThreads').emit('click', { target: threadTarget });
  assert.equal(board.state.links.length, 0, 'direct thread click still deletes without confirmation');
  await tap(a); await tap(b);
  await new Promise(resolve => setImmediate(resolve));
  await tap(a); await tap(a);
  assert.equal(board.state.pendingLink, null);

  const threads = element('boardThreads'), threadWrites = threads.htmlWrites;
  const segments = threads.querySelectorAll('.board-thread-segment');
  await pointer('pointerdown', 1, 100, 200, a);
  await pointer('pointermove', 1, 130, 210, a);
  await pointer('pointermove', 1, 160, 230, a);
  assert.equal(frames.size, 1, 'multiple moves paint once in the next frame');
  assert.equal(a.style.left, undefined, 'dragging does not change layout position on each move');
  paintFrame();
  assert.equal(a.style.transform, 'translate3d(120px, 60px, 0) rotate(var(--note-tilt))');
  assert.equal(threads.htmlWrites, threadWrites, 'dragging preserves existing thread DOM');
  assert.equal(threads.querySelectorAll('.board-thread-segment')[0], segments[0]);
  assert.ok(segments[0].style.transform, 'the existing thread follows the moving note');
  // Flush the last move even if pointerup arrives before the next animation frame.
  await pointer('pointermove', 1, 170, 235, a);
  await pointer('pointerup', 1, 160, 230, a);
  assert.equal(board.state.notes[0].x, 1090);
  assert.equal(board.state.notes[0].y, 670);
  assert.equal(a.style.left, '1090px');
  assert.equal(a.style.top, '670px');
  assert.equal(a.style.transform, '');
  assert.equal(frames.size, 0);
  assert.equal(requests.filter(r => r.url.endsWith('/position')).length, 1);
  assert.equal(board.state.pendingLink, null);

  const original = { ...board.state.notes[0] };
  viewport.scrollLeft = 400; viewport.scrollTop = 300;
  await pointer('pointerdown', 1, 100, 200, a);
  await pointer('pointermove', 1, 120, 200, a);
  assert.notEqual(board.state.notes[0].x, original.x);
  await pointer('pointerdown', 2, 220, 200);
  assert.equal(board.state.notes[0].x, original.x);
  assert.equal(frames.size, 0, 'a second finger cancels the pending drag frame');
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

  // Removing scrollbars while zooming out must not expose an untextured viewport strip.
  viewport.offsetWidth = viewport.clientWidth + 16;
  viewport.offsetHeight = viewport.clientHeight + 16;
  await element('boardZoomOut').emit('click', {});
  for (let i = 0; i < 20; i++) await element('boardZoomOut').emit('click', {});
  assert.equal(board.state.zoom, .4);
  assert.ok(board.state.width * .4 >= viewport.offsetWidth);
  assert.ok(board.state.height * .4 >= viewport.offsetHeight);
  // Rotation keeps the board point at the center of a manually positioned view.
  viewport.scrollLeft = 350; viewport.scrollTop = 120;
  const centeredPoint = [(350 + viewport.offsetWidth / 2) / board.state.zoom,
    (120 + viewport.offsetHeight / 2) / board.state.zoom];
  viewport.clientWidth = 800; viewport.clientHeight = 300;
  viewport.offsetWidth = 816; viewport.offsetHeight = 316;
  windowEvents.get('resize')();
  assert.equal((viewport.scrollLeft + viewport.offsetWidth / 2) / board.state.zoom, centeredPoint[0]);
  assert.equal((viewport.scrollTop + viewport.offsetHeight / 2) / board.state.zoom, centeredPoint[1]);
  assert.equal(board.state.zoom, .4, 'rotation preserves a manually selected zoom');
  // In overview mode, rotation refits all papers instead of cutting the top/bottom notes off.
  await element('boardZoomReset').emit('click', {});
  viewport.clientWidth = 356; viewport.clientHeight = 620;
  viewport.offsetWidth = 372; viewport.offsetHeight = 636;
  windowEvents.get('resize')();
  paintFrame();
  for (const note of board.state.notes) {
    assert.ok(note.x * board.state.zoom - viewport.scrollLeft >= 0);
    assert.ok((note.x + 300) * board.state.zoom - viewport.scrollLeft <= viewport.clientWidth);
    assert.ok(note.y * board.state.zoom - viewport.scrollTop >= 0);
    assert.ok((note.y + 300) * board.state.zoom - viewport.scrollTop <= viewport.clientHeight);
  }
  // Resume the gesture checks at the same manually chosen scale.
  for (let i = 0; i < 4; i++) await element('boardZoomOut').emit('click', {});
  assert.equal(board.state.zoom, .4);
  // The pushpin overlay routes dragging and taps to its paper and follows the coalesced paint.
  const fastenerTarget = { closest: selector => selector === '.board-note-fastener' ? { dataset: { noteId: '10' } } : null };
  sandbox.document.querySelector = selector => selector === '#boardNotes .investigation-note[data-id="10"]' ? a : null;
  const fastenerStartX = board.state.notes[0].x, fastenerStartY = board.state.notes[0].y;
  await pointer('pointerdown', 1, 100, 200, fastenerTarget);
  await pointer('pointermove', 1, 120, 208, fastenerTarget);
  paintFrame();
  assert.equal(board.state.notes[0].x, fastenerStartX + 50);
  assert.equal(board.state.notes[0].y, fastenerStartY + 20);
  assert.equal(element('boardFastener10').style.left, `${board.state.notes[0].x}px`);
  assert.equal(element('boardFastener10').style.top, `${board.state.notes[0].y}px`);
  assert.ok(a.style.transform.includes('translate3d(50px, 20px, 0)'));
  await pointer('pointerup', 1, 120, 208, fastenerTarget);
  assert.equal(a.style.left, `${board.state.notes[0].x}px`);
  assert.equal(a.style.top, `${board.state.notes[0].y}px`);
  await tap(fastenerTarget);
  assert.equal(board.state.pendingLink, 10, 'a pushpin tap selects its note');
  await tap(fastenerTarget);
  assert.equal(board.state.pendingLink, null, 'a second pushpin tap cancels selection');
  board.state.notes[0].color = 'orange';
  board.state.notes[1].color = 'mint';
  board.hide();
  assert.match(element('boardNotes').innerHTML, /data-id="10" data-color="yellow"/);
  assert.match(element('boardNotes').innerHTML, /data-id="11" data-color="green"/);
  assert.equal(board.state.notes[0].color, 'orange', 'rendering preserves saved legacy notes');
  assert.equal(board.state.notes[1].color, 'mint');
  assert.match(element('boardFasteners').innerHTML, /class="board-note-fastener"/, 'the cropped pushpins render above threads');
  console.log('PASS: link toggling, deletion without confirmation, failure recovery, coalesced drag frames, thread reuse, drag/save, pushpin drag/tap, pinch anchor, rotation, overview refit and cancellation');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
