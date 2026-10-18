const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const accessService = require('../backend/services/questionAccess');
const { questionAccess, parseQuestionDelay } = accessService;
const { roomSessionFixture } = require('./test-helpers/room-session-fixture.cjs');
const { browser } = require('./test-helpers/browser-runtime.cjs');

test('delay accepts whole minutes and rejects settings that cannot open during the game', () => {
  for (const value of [undefined, '', 0]) assert.equal(parseQuestionDelay(value, 7200), 0);
  assert.equal(parseQuestionDelay('15', 7200), 900);
  for (const value of [-1, 1.5, 'abc', true, 120, 121, Infinity]) {
    assert.throws(() => parseQuestionDelay(value, 7200), error => error.status === 400);
  }
});

test('15 minute gate starts with the game, freezes during pauses, and survives resume and extra time', () => {
  const now = Date.parse('2026-10-19T10:00:00Z');
  const room = { questions_delay_seconds: 900, duration_seconds: 7200, state: 'pending' };
  assert.equal(questionAccess(room, now).remaining_seconds, 900);
  Object.assign(room, { state: 'running', game_end_time: new Date(now + 6600 * 1000).toISOString() });
  assert.equal(questionAccess(room, now).remaining_seconds, 300);
  Object.assign(room, { state: 'paused', paused_at: new Date(now).toISOString() });
  assert.equal(questionAccess(room, now + 86400000).remaining_seconds, 300);
  Object.assign(room, { state: 'running', paused_at: null, game_end_time: new Date(now + 86400000 + 6600 * 1000).toISOString() });
  assert.equal(questionAccess(room, now + 86400000).remaining_seconds, 300);
  room.duration_seconds += 600;
  room.game_end_time = new Date(new Date(room.game_end_time).getTime() + 600000).toISOString();
  assert.equal(questionAccess(room, now + 86400000).remaining_seconds, 300);
  assert.equal(questionAccess(room, now + 86400000 + 299999).is_open, false);
  assert.equal(questionAccess(room, now + 86400000 + 300000).is_open, true);
  assert.equal(questionAccess({ ...room, is_test: true }, now).is_open, true);
  assert.equal(questionAccess({ state: 'pending' }, now).is_open, true);
});

function questionsController(f) {
  const module = { exports: {} }, stored = [];
  const dependencies = {
    '../services/questionAccess': accessService,
    '../services/roomTimer': { syncRoomTimer: f.Room.getById },
    '../models/question': { getByScenario: async () => [{ id: 7, question_text: 'Hidden question' }] },
    '../models/questionAnswer': { getByQuestionAndUser: async () => null, create: async value => { stored.push(value); return value; } }
  };
  vm.runInNewContext(fs.readFileSync('backend/controllers/questionController.js', 'utf8'), {
    module, console, require: name => dependencies[name]
  });
  return { ...module.exports, stored };
}

test('server withholds questions and rejects early answers even through direct HTTP requests', async t => {
  const f = roomSessionFixture(), controller = questionsController(f);
  f.app.get('/questions/:scenario_id', f.auth.authenticateToken, controller.getQuestionsByScenario);
  f.app.post('/answers', f.auth.authenticateToken, controller.createAnswer);
  const room = { id: 14, scenario_id: 12, state: 'running', duration_seconds: 7200,
    questions_delay_seconds: 900, game_end_time: new Date(Date.now() + 7200000).toISOString() };
  f.rooms.set(14, room);
  const server = await new Promise(resolve => { const s = f.app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = f.jwt.sign({ room_user_id: 15, room_id: 14 }, f.secret);
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/questions/12')).status, 401);
  let response = await fetch(base + '/questions/12', { headers });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  let data = await response.json();
  assert.deepEqual(data.questions, []);
  assert.equal(data.questions_access.remaining_seconds, 900);
  assert.equal((await fetch(base + '/questions/13', { headers })).status, 403);
  assert.equal((await fetch(base + '/answers', { method: 'POST', headers, body: JSON.stringify({ question_id: 7, answer_text: 'Early' }) })).status, 403);
  assert.equal(controller.stored.length, 0);
  room.game_end_time = new Date(Date.now() + 6200000).toISOString();
  data = await (await fetch(base + '/questions/12', { headers })).json();
  assert.equal(data.questions[0].question_text, 'Hidden question');
  assert.equal((await fetch(base + '/answers', { method: 'POST', headers, body: JSON.stringify({ question_id: 7 }) })).status, 201);
});

test('admin room creation stores the delay and rejects a delay equal to game duration', async t => {
  const f = roomSessionFixture();
  const server = await new Promise(resolve => { const s = f.app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const headers = { Authorization: 'Bearer ' + f.jwt.sign({ id: 99 }, f.secret), 'Content-Type': 'application/json' };
  const create = body => fetch(`http://127.0.0.1:${server.address().port}/api/rooms`, { method: 'POST', headers, body: JSON.stringify({ name: 'Delay', scenario_id: 12, duration_seconds: 7200, ...body }) });
  let response = await create({ questions_delay_minutes: 15 });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).room.questions_delay_seconds, 900);
  assert.equal((await create({ questions_delay_minutes: 120 })).status, 400);
  response = await create({ is_test: true, questions_delay_minutes: 15 });
  assert.equal((await response.json()).room.questions_delay_seconds, 0);
});

test('player countdown ticks without requests, freezes on pause and opens automatically at zero', async () => {
  let opened = false;
  const b = browser(call => new Response(JSON.stringify(call.url.endsWith('/state') ? {
    state: 'running', room: { id: 14, scenario_id: 12 },
    questions_access: { is_open: true, remaining_seconds: 0 }
  } : { questions: [{ id: 7, question_text: 'Opened question' }] })));
  b.load('frontend/js/game-session.js');
  b.load('frontend/js/game.js');
  b.element('questions').classList.add('active');
  b.sandbox.markOpened = () => { opened = true; b.element('questionsList').dataset.questionsLocked = 'false'; };
  b.run('displayQuestions = markOpened;');
  b.run("setQuestionsAccess({is_open:false,remaining_seconds:15},'running');showQuestionsLock();initRoomTimer();");
  await b.clock.advance(4000);
  assert.equal(b.element('questionsUnlockCountdown').textContent, '0:11');
  assert.equal(b.calls.length, 0);
  b.run("setQuestionsAccess({is_open:false,remaining_seconds:11},'paused');");
  await b.clock.advance(10000);
  assert.equal(b.element('questionsUnlockCountdown').textContent, '0:11');
  assert.match(b.element('questionsUnlockHint').textContent, /паузе/);
  b.run("setQuestionsAccess({is_open:false,remaining_seconds:1},'running');");
  await b.clock.advance(1000);
  assert.equal(opened, true);
  assert.equal(b.calls.length, 2);
});

test('shared room countdown opens the actual shared form automatically without a page reload', async () => {
  let locked = true;
  const b = browser(() => new Response(JSON.stringify({
    room: { id: 14, state: 'running' }, notes: '', notes_revision: 0, answers_submitted: false,
    questions_access: { is_open: !locked, remaining_seconds: locked ? 1 : 0 },
    questions: locked ? [] : [{ id: 7, question_text: 'Shared question opened', answer_text: '', revision: 0 }]
  })));
  b.values.set('room', JSON.stringify({ id: 14, scenario_id: 12, shared: true }));
  b.load('frontend/js/game-session.js');
  b.load('frontend/js/game.js');
  for (const name of ['displayQuestions', 'setQuestionsAccess', 'showQuestionsLock']) b.window[name] = b.run(name);
  b.load('frontend/js/shared-game.js');
  b.element('questions').classList.add('active');
  b.run('initRoomTimer();');
  await b.run('loadQuestions()');
  assert.match(b.element('questionsList').innerHTML, /questions-locked/);
  assert.doesNotMatch(b.element('questionsList').innerHTML, /Shared question opened/);
  locked = false;
  await b.clock.advance(1000);
  assert.match(b.element('questionsList').innerHTML, /Shared question opened/);
  assert.equal(b.element('questionsList').dataset.questionsLocked, 'false');
  assert.equal(b.calls.length, 2);
});
