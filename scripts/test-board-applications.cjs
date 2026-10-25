const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sqlite3 = require('../backend/node_modules/sqlite3');
const express = require('../backend/node_modules/express');
const schema = require('../backend/services/investigationBoardSchema');
const { browser, deferred, flush } = require('./test-helpers/browser-runtime.cjs');

function load(file, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, console, process: { env: { DB_TYPE: 'sqlite' } },
    require(name) { if (!(name in dependencies)) throw Error(`Unexpected dependency: ${name}`); return dependencies[name]; } });
  return module.exports;
}

async function fixture(t) {
  const db = new sqlite3.Database(':memory:');
  const run = (sql, values = []) => new Promise((resolve, reject) => db.run(sql, values, error => error ? reject(error) : resolve()));
  const query = (sql, values = []) => new Promise((resolve, reject) => db.all(sql, values, (error, rows) => error ? reject(error) : resolve({ rows })));
  await run(`CREATE TABLE investigation_notes (id INTEGER PRIMARY KEY, room_id INTEGER, scenario_id INTEGER,
    address_id INTEGER, title TEXT, address_label TEXT, comment TEXT, color TEXT, x REAL, y REAL,
    created_at TEXT, updated_at TEXT, UNIQUE(room_id, scenario_id, address_id))`);
  await run('CREATE TABLE investigation_links (id INTEGER PRIMARY KEY, room_id INTEGER, scenario_id INTEGER, note_a INTEGER, note_b INTEGER)');
  await run('CREATE TABLE room_users (id INTEGER, room_id INTEGER)');
  await run('CREATE TABLE visit_attempts (user_id INTEGER, room_id INTEGER, scenario_id INTEGER, address_id INTEGER, found INTEGER)');
  await run('INSERT INTO room_users VALUES (15,14),(16,14),(17,18)');
  await run('INSERT INTO visit_attempts VALUES (15,14,12,50,1),(16,14,12,50,1),(17,18,13,50,1)');
  const database = { db, query };
  const Board = load('backend/models/investigationBoard.js', { '../config/database': database });
  await run("INSERT INTO investigation_notes (room_id,scenario_id,address_id,title,address_label,comment,color,x,y) VALUES (14,12,50,'Ломбард','Ц · Дом 50','','yellow',950,600)");
  await schema.init({ ...database, postgres: false });
  await schema.init({ ...database, postgres: false });
  const rooms = new Map([[14, { id: 14, scenario_id: 12, state: 'running' }], [18, { id: 18, scenario_id: 13, state: 'running' }]]);
  const applications = { getBriefing: async scenario => scenario === 12 ? { files: [{ id: 'briefing.pdf', name: 'Брифинг.pdf', type: 'application/pdf' }] } : null,
    get: async (scenario, address, number) => scenario === 12 && address === 50 && [4, 5].includes(number) ? { files: [
      { id: 'file.pdf', name: 'Залоговая квитанция.pdf', type: 'application/pdf' },
      { id: 'photo.jpg', name: 'Фотография.jpg', type: 'image/jpeg' }] } : null };
  const router = load('backend/routes/investigationBoard.js', { express, '../models/room': { getById: async id => rooms.get(id) },
    '../models/address': { getById: async (scenario, address) => scenario === 12 && address === 50 ? { district: 'Ц', house_number: '50' } : null },
    '../models/addressBook': { ensureSeeded: async () => {}, findNamesByAddress: async () => ['Ломбард «Серебро-Инвест»'] },
    '../models/investigationBoard': Board, '../services/scenarioApplications': applications, '../config/database': database });
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { const id = Number(req.headers['x-player'] || 15); req.roomUser = { id, room_id: id === 17 ? 18 : 14 }; next(); });
  app.use('/board', router);
  app.use((error, req, res, next) => { console.error(error); res.status(500).json({ error: error.message }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await new Promise(resolve => db.close(resolve)); });
  const request = (path = '', body, method = body ? 'POST' : 'GET', player = 15) => fetch(`http://127.0.0.1:${server.address().port}/board${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Player': String(player) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { request, Board, rooms, run, query };
}
const source = { address_id: 50, number: 4, comment: '', color: 'blue' };

test('migration preserves old notes; application cards coexist with location and free notes, retain source and cannot be duplicated', async t => {
  const { request, Board } = await fixture(t);
  const created = await request('/notes/application', source);
  assert.equal(created.status, 201);
  const { note } = await created.json();
  assert.equal(note.title, 'Приложение 4');
  assert.equal(note.address_label, 'Ломбард «Серебро-Инвест»');
  assert.equal(note.application_address_id, 50); assert.equal(note.application_number, 4);
  assert.ok(note.address_id < 0);
  assert.equal((await request('/notes/application', source)).status, 409);
  assert.equal((await request('/notes/application', source, 'POST', 16)).status, 409, 'shared room deduplicates across players');
  assert.equal((await request('/notes/application', { ...source, number: 5 })).status, 201);
  assert.equal((await request('/notes/free', { title: 'Версия', comment: 'Текст', color: 'pink' })).status, 201);
  const data = await (await request()).json();
  assert.equal(data.notes.length, 4);
  assert.equal(data.notes[0].title, 'Ломбард');
  assert.equal(new Set(data.notes.map(item => item.address_id)).size, 4);
  const result = await request(`/notes/${note.id}`, { comment: 'Сверить даты', color: 'green', title: 'Подмена', application_number: 999 }, 'PATCH');
  assert.equal(result.status, 200);
  const edited = (await result.json()).note;
  assert.equal(edited.title, 'Приложение 4'); assert.equal(edited.application_number, 4);
  assert.equal(edited.comment, 'Сверить даты');
  assert.equal((await request(`/notes/${note.id}/position`, { x: 400, y: 800 }, 'PATCH')).status, 200);
  assert.equal((await request('/links', { first_id: 1, second_id: note.id })).status, 201);
  assert.equal((await Board.list(14, 12)).links.length, 1);
  assert.equal((await request(`/notes/${note.id}`, null, 'DELETE')).status, 200);
  assert.equal((await Board.list(14, 12)).links.length, 0);
  assert.equal((await request('/notes/application', source)).status, 201, 'removed application can be reattached');
});

test('application cards enforce visits, room membership, scenario and document existence', async t => {
  const { request, run } = await fixture(t);
  for (const body of [{ ...source, number: 0 }, { ...source, number: -1 }, { ...source, number: '4/../../x' },
    { ...source, address_id: null }, { ...source, color: 'invalid' }]) {
    assert.equal((await request('/notes/application', body)).status, 400);
  }
  assert.equal((await request('/notes/application', { ...source, number: 6 })).status, 404);
  assert.equal((await request('/notes/application', { ...source, address_id: 51 })).status, 403);
  assert.equal((await request('/notes/application', source, 'POST', 17)).status, 404, 'another scenario cannot pin the document');
  assert.equal((await request('/notes/application', source, 'POST', 19)).status, 403, 'nonmember rejected');
  await request('/notes/application', source);
  const foreign = await (await request('', null, 'GET', 17)).json();
  assert.equal(foreign.notes.length, 0);
  await run('DELETE FROM visit_attempts WHERE user_id = 16');
  assert.equal((await request('/notes/application', source, 'POST', 16)).status, 403, 'existing card does not bypass visit requirement');
});

test('briefing is a separate card, pending rooms lock attachments, test and paused rooms allow them', async t => {
  const { request, rooms } = await fixture(t);
  rooms.get(14).state = 'pending';
  assert.equal((await request('/notes/application', source)).status, 409);
  assert.equal((await request('/notes/application', { briefing: true, color: 'blue', comment: '' })).status, 409);
  rooms.get(14).is_test = true;
  const response = await request('/notes/application', { briefing: true, color: 'blue', comment: '' });
  assert.equal(response.status, 201);
  const { note } = await response.json();
  assert.equal(note.application_number, 0); assert.equal(note.application_address_id, 0);
  assert.equal(note.title, 'Брифинг дела');
  rooms.get(14).is_test = false; rooms.get(14).state = 'paused';
  assert.equal((await request('/notes/application', source)).status, 201);
});

test('concurrent attachments create one shared card', async t => {
  const { request } = await fixture(t);
  const replies = await Promise.all(Array.from({ length: 8 }, () => request('/notes/application', source)));
  assert.equal(replies.filter(reply => reply.status === 201).length, 1);
  assert.equal(replies.filter(reply => reply.status === 409).length, 7);
  assert.equal((await (await request()).json()).notes.filter(note => note.application_number === 4).length, 1);
});

test('individual files coexist with their folder, deduplicate by file and retain trusted metadata', async t => {
  const { request } = await fixture(t);
  const attached = [];
  for (const file_id of ['', 'file.pdf', 'photo.jpg']) {
    const reply = await request('/notes/application', { ...source, file_id, title: 'Подмена', application_file_type: 'text/html' });
    assert.equal(reply.status, 201);
    attached.push((await reply.json()).note);
  }
  assert.equal(attached[1].title, 'Залоговая квитанция');
  assert.equal(attached[1].application_file_type, 'application/pdf');
  assert.equal(attached[2].title, 'Фотография');
  assert.equal(attached[2].application_file_type, 'image/jpeg');
  assert.match(attached[2].address_label, /Приложение 4 · Ломбард/);
  assert.equal((await request('/notes/application', { ...source, file_id: 'file.pdf' })).status, 409);
  assert.equal((await request('/notes/application', { ...source, file_id: 'missing.jpg' })).status, 404);
  for (const file_id of ['../../photo.jpg', '\\photo.jpg', { id: 'photo.jpg' }]) {
    assert.equal((await request('/notes/application', { ...source, file_id })).status, 400);
  }
  assert.equal((await request('/notes/application', { briefing: true, file_id: 'briefing.pdf', color: 'blue', comment: '' })).status, 201);
});

test('new cards avoid overlapping the full height of attached PDF pages', async t => {
  const { Board } = await fixture(t);
  const doc = await Board.createFreeNote({ room_id: 14, scenario_id: 12, title: 'PDF', address_label: '', comment: '', color: 'blue',
    application_address_id: 50, application_number: 4, application_file_id: 'file.pdf', application_file_type: 'application/pdf' });
  const created = [doc];
  for (let i = 0; i < 12; i++) created.push(await Board.createFreeNote({ room_id: 14, scenario_id: 12,
    title: 'Заметка', comment: '', color: 'yellow' }));
  for (const note of created.slice(1)) {
    assert.ok(note.x + 300 <= doc.x || doc.x + 300 <= note.x || note.y + 300 <= doc.y || doc.y + 440 <= note.y);
  }
});

function boardBrowser(fetcher) {
  const b = browser(fetcher);
  b.load('frontend/js/game-session.js'); b.load('frontend/js/game.js');
  const code = fs.readFileSync('frontend/js/investigation-board.js', 'utf8').replace(
    'window.investigationBoard = { show, openFromTrip, hide: clearSelection };',
    'window.investigationBoard = { show, openFromTrip, hide: clearSelection, state, init, activateNote, selectNote, openDialog, threadPoints };');
  vm.runInContext(code, b.context);
  b.board = b.window.investigationBoard; b.board.init();
  b.element('board-tab').click = () => {};
  return b;
}
const json = data => new Response(JSON.stringify(data));

test('player pins once, finds existing card, opens documents and can begin threads from application', async () => {
  let notes = [];
  const b = boardBrowser(call => {
    if (call.url.endsWith('/notes/application')) {
      notes = [{ id: 2, address_id: -1, application_address_id: 50, application_number: 4, title: 'Приложение 4', address_label: '<Ломбард>', x: 950, y: 600 }];
      return json({ note: notes[0] });
    }
    if (call.url === '/api/game/board') return json({ notes, links: [] });
    return json({ application: { files: [] } });
  });
  await b.board.openFromApplication(source);
  await b.board.openFromApplication(source);
  assert.equal(b.calls.filter(call => call.options.method === 'POST').length, 1);
  assert.match(b.element('boardNotes').innerHTML, /board-application/);
  assert.match(b.element('boardNotes').innerHTML, /&lt;Ломбард&gt;/);
  b.run('applicationScenarioId = 12');
  b.board.activateNote(2); await flush();
  assert.ok(b.calls.some(call => call.url.endsWith('/scenarios/12/addresses/50/4')));
  assert.equal(b.board.state.pendingLink, null);
  b.board.selectNote(2); assert.equal(b.board.state.pendingLink, 2);
  b.board.openDialog({ note: notes[0] });
  assert.equal(b.element('boardNoteTitleInputWrap').hidden, true);
});

test('a concurrent attachment response focuses the existing card; failed pin leaves viewer open', async () => {
  const note = { id: 7, application_address_id: 50, application_number: 4, title: 'Приложение 4', x: 950, y: 600 };
  let mode = 'conflict', created = false;
  const b = boardBrowser(call => {
    if (call.url.endsWith('/notes/application')) {
      created = true;
      return new Response(JSON.stringify(mode === 'conflict' ? { note } : { error: 'Ошибка сохранения' }), { status: mode === 'conflict' ? 409 : 503 });
    }
    return json({ notes: created && mode === 'conflict' ? [note] : [], links: [] });
  });
  await b.board.openFromApplication(source);
  assert.equal(b.board.state.notes[0].id, 7);
  mode = 'error'; b.element('applicationOverlay').classList.add('is-open');
  await assert.rejects(b.board.openFromApplication(source), /Ошибка сохранения/);
  assert.equal(b.element('applicationOverlay').classList.contains('is-open'), true);
});

test('viewer action follows the current application when a previous board lookup arrives late', async () => {
  const pending = deferred();
  const b = browser(() => json({ application: { files: [] } }));
  b.load('frontend/js/game-session.js'); b.load('frontend/js/game.js');
  b.run('applicationScenarioId = 12');
  b.window.investigationBoard = { findApplication: source => source.number === 4 ? pending.promise : Promise.resolve(null) };
  await b.run('openApplicationFolder(50, 4)');
  await b.run('openApplicationFolder(50, 5)');
  pending.resolve({ id: 1 }); await flush();
  assert.equal(b.element('applicationBoardBtn').textContent, 'На доску');
  assert.equal(b.run('applicationBoardSource.number'), 5);
  b.run('closeApplicationFolder()');
  assert.equal(b.element('applicationBoardBtn').hidden, true);
});

test('file card opens its exact file and viewer pin action returns to folder when going back', async () => {
  const photo = { id: 'photo.jpg', name: 'Фотография.jpg', type: 'image/jpeg' };
  const b = boardBrowser(call => {
    if (call.url.includes('/files/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
    if (call.url === '/api/game/board') return json({ notes: b.board.state.notes, links: [] });
    return json({ application: { files: [photo] } });
  });
  b.document.createElement = () => ({ tagName: 'IMG', addEventListener() {} });
  b.element('applicationPreview').append = () => {};
  b.run('applicationScenarioId = 12');
  b.board.state.notes = [{ id: 7, application_address_id: 50, application_number: 4, application_file_id: photo.id, title: photo.name }];
  b.board.activateNote(7); await flush();
  assert.ok(b.calls.some(call => call.url.endsWith('/addresses/50/4/files/photo.jpg?preview=1')));
  assert.equal(b.run('applicationBoardSource.file_id'), 'photo.jpg');
  assert.equal(b.element('applicationBoardBtn').textContent, 'Найти на доске');
  b.run('showApplicationFiles()');
  await flush();
  assert.equal(b.run('applicationBoardSource.file_id'), undefined);
  assert.equal(b.element('applicationBoardBtn').textContent, 'На доску');
  b.run('closeApplicationFolder()');
});

test('preview downloads are bounded, authenticated and canceled on leaving the board', async () => {
  const waiting = [];
  const b = browser(call => { const value = deferred(); waiting.push({ call, ...value });
    call.options.signal.addEventListener('abort', () => value.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
    return value.promise; });
  b.run('const gameStorage = localStorage');
  const hosts = new Map();
  b.element('board').classList.add('active');
  b.document.querySelectorAll = selector => { const id = Number(selector.match(/"(\d+)"/)[1]); return [hosts.get(id)]; };
  b.document.createElement = () => ({});
  let observed;
  b.sandbox.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observed = this; this.targets = []; }
    observe(target) { this.targets.push(target); }
    disconnect() { this.targets = []; }
  };
  b.load('frontend/js/board-application-previews.js');
  const notes = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, scenario_id: 12, title: 'Фото', application_address_id: 50,
    application_number: 4, application_file_id: `photo${i}.jpg`, application_file_type: 'image/jpeg' }));
  for (const note of notes) hosts.set(note.id, { dataset: { boardPreviewId: String(note.id), fileId: note.application_file_id }, replaceChildren(image) { this.image = image; } });
  const previews = b.window.boardApplicationPreviews;
  previews.render(notes);
  assert.equal(b.calls.length, 0, 'offscreen files do not download');
  observed.callback(observed.targets.map(target => ({ target, isIntersecting: true })));
  await flush();
  assert.equal(b.calls.length, 2);
  assert.equal(new Headers(b.calls[0].options.headers).get('Authorization'), 'Bearer fixture-token');
  assert.match(b.calls[0].url, /preview=board/);
  waiting[0].resolve(new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/jpeg' } }));
  await flush();
  assert.equal(b.calls.length, 3);
  assert.ok(hosts.get(1).image.src.startsWith('blob:'));
  previews.clear(); await flush();
  assert.ok(waiting.slice(1).every(item => item.call.options.signal.aborted));
  assert.equal(b.api.stats().active, 0);
});

test('list buttons attach the selected briefing file without opening it and block duplicate taps', async () => {
  const files = [{ id: 'first.pdf', name: 'Брифинг.pdf', type: 'application/pdf' }, { id: 'second.pdf', name: 'Городское время.pdf', type: 'application/pdf' }];
  const b = browser(() => json({ application: { files } }));
  b.load('frontend/js/game-session.js'); b.load('frontend/js/game.js');
  const buttons = files.map((file, index) => { const button = b.element('file-pin-' + index); button.dataset.fileIndex = String(index); button.hidden = false; return button; });
  b.element('applicationFiles').querySelectorAll = selector => selector === '.application-file-pin' ? buttons : [];
  const waiting = deferred(), pinned = [];
  b.window.investigationBoard = {
    findApplication: source => Promise.resolve(source.file_id === files[1].id ? { id: 8 } : null),
    openFromApplication: source => { pinned.push(source); return waiting.promise; }
  };
  b.run('applicationScenarioId = 12');
  await b.run("openApplicationFolder(null, null, '', true)"); await flush();
  assert.match(b.element('applicationFiles').innerHTML, /application-file-pin/);
  assert.equal(buttons[0].textContent, 'На доску');
  assert.equal(buttons[1].textContent, 'Найти на доске');
  buttons[0].emit('click'); buttons[0].emit('click'); await flush();
  assert.equal(pinned.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(pinned[0])), { briefing: true, file_id: files[0].id });
  assert.equal(b.calls.length, 1, 'pinning from the list never downloads or opens the file');
  waiting.reject(new Error('Сбой сохранения')); await flush();
  assert.equal(buttons[0].disabled, false);
  assert.match(b.alerts[0], /Сбой сохранения/);
});

test('file surfaces follow their image proportions while threads keep meeting the pin', async () => {
  const b = boardBrowser(call => json({ notes: b.board.state.notes, links: [] }));
  const note = { id: 5, address_id: -1, application_address_id: 50, application_number: 4, application_file_id: 'portrait.jpg',
    application_file_type: 'image/jpeg', title: 'Квитанция', address_label: 'Ломбард', x: 950, y: 600 };
  b.board.state.notes = [note];
  b.board.filePreviewReady(5, .75);
  assert.match(b.element('boardNotes').innerHTML, /--file-width:calc\(207px/);
  assert.match(b.element('boardNotes').innerHTML, /board-file-caption/);
  assert.match(b.element('boardFasteners').innerHTML, /board-file-fastener/);
  const pin = b.board.threadPoints(note, { id: 6, x: 1400, y: 600 })[0];
  const angle = -1.35 * Math.PI / 180;
  assert.ok(Math.abs(pin.x - (950 + 207 / 2 + 104 * Math.sin(angle))) < 1e-8);
  const htmlBeforeLoad = b.element('boardNotes').innerHTML;
  const card = b.element('file-card');
  b.document.querySelector = selector => selector.includes('data-id="5"') ? card : null;
  b.board.filePreviewReady(5, 2);
  assert.equal(b.element('boardNotes').innerHTML, htmlBeforeLoad, 'loading a preview preserves the focused or dragged card DOM');
  assert.equal(card.style['--file-width'], 'calc(300px * var(--board-zoom, 1))');
  assert.equal(card.style['--file-media-height'], 'calc(150px * var(--board-zoom, 1))');
});
