const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { browser, deferred, hanging, flush } = require('./test-helpers/browser-runtime.cjs');
const json = value => new Response(JSON.stringify(value));

function board(fetchImpl) {
  const b = browser(fetchImpl);
  b.run("const gameStorage = localStorage;");
  const source = fs.readFileSync('frontend/js/investigation-board.js', 'utf8').replace(
    'window.investigationBoard = { show, openFromTrip, hide: clearSelection };',
    'window.investigationBoard = { show, openFromTrip, hide: clearSelection, state, init, load, savePosition, saveDialog, deleteCurrentNote };');
  vm.runInContext(source, b.context);
  b.board = b.window.investigationBoard;
  b.board.init();
  return b;
}

test('1000 drags coalesce into the current and final positions without stale rollback', async () => {
  const waiting = [];
  const b = board(call => { const value = deferred(); waiting.push({ call, ...value }); return value.promise; });
  const note = { id: 10, x: 100, y: 200, title: 'Fixture' };
  b.board.state.notes = [note];
  const saves = [b.board.savePosition(note)];
  await flush();
  for (let i = 1; i <= 1000; i++) { note.x = 100 + i; saves.push(b.board.savePosition(note)); }
  assert.equal(b.calls.length, 1);
  waiting[0].reject(new Error('Interrupted old save'));
  await flush();
  assert.equal(b.calls.length, 2);
  assert.deepEqual(JSON.parse(waiting[1].call.options.body), { x: 1100, y: 200 });
  assert.equal(note.x, 1100);
  assert.equal(b.element('boardStatus').textContent, '', 'failure of an old position does not claim the latest one failed');
  waiting[1].resolve(json({ note: { id: 10, x: 1100, y: 200 } }));
  await Promise.all(saves);
  assert.equal(note.x, 1100);
  assert.equal(b.api.stats().active, 0);
  assert.equal(b.clock.jobs.size, 0);
});

test('different notes save sequentially and keep only the newest queued coordinates', async () => {
  const waiting = [];
  const b = board(call => { const value = deferred(); waiting.push({ call, ...value }); return value.promise; });
  const a = { id: 1, x: 10, y: 20 }, c = { id: 2, x: 30, y: 40 };
  b.board.state.notes = [a, c];
  const saves = [b.board.savePosition(a), b.board.savePosition(c)];
  c.x = 300; saves.push(b.board.savePosition(c));
  await flush();
  assert.equal(waiting.length, 1);
  waiting[0].resolve(json({ note: a }));
  await flush();
  assert.equal(waiting.length, 2);
  assert.deepEqual(JSON.parse(waiting[1].call.options.body), { x: 300, y: 40 });
  waiting[1].resolve(json({ note: c }));
  await Promise.all(saves);
  assert.equal(b.calls.length, 2);
});

test('loads wait for pending saves, coalesce, and cannot overwrite a newer drag', async () => {
  const save = deferred(), read = deferred();
  const b = board(call => call.options.method === 'PATCH' ? save.promise : read.promise);
  const note = { id: 1, title: 'Local', x: 100, y: 200 };
  b.board.state.notes = [note];
  const saving = b.board.savePosition(note);
  const loads = Array.from({ length: 100 }, () => b.board.load());
  await flush();
  assert.equal(b.calls.length, 1);
  save.resolve(json({ note }));
  await saving; await flush();
  assert.equal(b.calls.length, 2);
  note.x = 999; b.board.state.revision++;
  read.resolve(json({ notes: [{ id: 1, title: 'Stale', x: 100, y: 200 }], links: [] }));
  await Promise.all(loads);
  assert.equal(b.board.state.notes[0], note);
  assert.equal(note.x, 999);
  assert.equal(note.title, 'Local');
});

test('timeout reports an uncertain save, retains coordinates, and does not retry it', async () => {
  const b = board(hanging);
  const note = { id: 1, x: 999, y: 888 };
  b.board.state.notes = [note];
  const save = b.board.savePosition(note);
  await flush();
  await b.clock.advance(15000);
  await save;
  assert.equal(b.calls.length, 1);
  assert.equal(note.x, 999);
  assert.match(b.element('boardStatus').textContent, /могло сохраниться/);
  assert.equal(b.clock.jobs.size, 0);
});

test('invalid JSON or a malformed board does not erase existing notes', async () => {
  let mode = 'json';
  const b = board(() => mode === 'json' ? new Response('<html>error</html>') : json({ notes: null, links: [] }));
  const notes = [{ id: 1, x: 100, y: 200 }]; b.board.state.notes = notes;
  await assert.rejects(b.board.load());
  assert.equal(b.board.state.notes, notes);
  mode = 'shape';
  await assert.rejects(b.board.load(), /прочитать доску/);
  assert.equal(b.board.state.notes, notes);
  assert.equal(b.api.stats().active, 0);
  assert.equal(b.clock.jobs.size, 0);
});

test('double form submission sends one PATCH and preserves a newer position', async () => {
  const waiting = deferred();
  const b = board(() => waiting.promise);
  const note = { id: 1, title: 'Fixture', comment: 'Before', x: 950, y: 600 };
  b.board.state.notes = [note]; b.board.state.editing = note;
  b.element('boardNoteComment').value = 'After';
  const first = b.board.saveDialog({ preventDefault() {} });
  const second = b.board.saveDialog({ preventDefault() {} });
  await flush();
  assert.equal(b.calls.length, 1);
  note.x = 1200;
  waiting.resolve(json({ note: { ...note, x: 950, comment: 'After' } }));
  await Promise.all([first, second]);
  assert.equal(b.board.state.notes[0].x, 1200);
  assert.equal(b.board.state.notes[0].comment, 'After');
  assert.equal(b.element('boardNoteSave').disabled, false);
});

test('uncertain edit unlocks the form and leaves its original data available', async () => {
  const b = board(hanging);
  const note = { id: 1, title: 'Fixture', comment: 'Before', x: 950, y: 600 };
  b.board.state.notes = [note]; b.board.state.editing = note;
  b.element('boardNoteComment').value = 'After';
  const save = b.board.saveDialog({ preventDefault() {} });
  await flush(); await b.clock.advance(15000); await save;
  assert.equal(b.board.state.notes[0].comment, 'Before');
  assert.equal(b.element('boardNoteComment').value, 'After');
  assert.equal(b.element('boardNoteSave').disabled, false);
  assert.match(b.alerts[0], /могло сохраниться/);
  assert.equal(b.calls.length, 1);
});
