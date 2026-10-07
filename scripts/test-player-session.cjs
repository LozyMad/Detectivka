const test = require('node:test');
const assert = require('node:assert/strict');
const { browser, flush, deferred } = require('./test-helpers/browser-runtime.cjs');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const login = (id = 20) => ({ token: `room-${id}-token`, room: { id, scenario_id: 12 }, user: { id: id + 1, username: `Player ${id}` } });
function load(b) { b.load('frontend/js/game-session.js'); return b.window.gameSession; }
function loginPage(fetchImpl) {
  const b = browser(fetchImpl);
  b.window.location.pathname = '/game-login';
  const session = load(b);
  b.element('gameLoginForm').querySelector = () => b.element('submit');
  b.element('message').querySelector = () => null;
  b.load('frontend/js/game-auth.js');
  b.document.emit('DOMContentLoaded');
  return { b, session };
}

test('two room tabs keep their identities, including after reload, while notes remain persistent', () => {
  const a = browser(), first = load(a);
  first.saveLogin(login(20));
  first.storage.setItem('detectum-notes-room-20-player-21', 'Keep these notes');
  const b = browser();
  b.sandbox.localStorage = a.sandbox.localStorage;
  const second = load(b);
  second.saveLogin(login(30));
  assert.equal(first.storage.getItem('token'), 'room-20-token');
  assert.equal(second.storage.getItem('token'), 'room-30-token');
  a.load('frontend/js/game-session.js');
  assert.equal(a.window.gameSession.storage.getItem('token'), 'room-20-token');
  assert.equal(a.window.gameSession.storage.getItem('detectum-notes-room-20-player-21'), 'Keep these notes');
  first.clear();
  assert.equal(JSON.parse(a.sandbox.localStorage.getItem('detectum-player-session-v1')).token, 'room-30-token');
});

test('successful room login retains the admin login and clears a stale test-room flag', async () => {
  const b = browser(() => json(login()));
  b.window.location.pathname = '/game-login';
  b.sandbox.localStorage.setItem('token', 'admin-token');
  b.sandbox.localStorage.setItem('user', JSON.stringify({ id: 99, is_admin: true }));
  b.sandbox.localStorage.removeItem('roomUser');
  b.sandbox.sessionStorage.setItem('testRoomSession', '1');
  const session = load(b);
  b.element('gameLoginForm').querySelector = () => b.element('submit');
  b.element('message').querySelector = () => null;
  b.load('frontend/js/game-auth.js'); b.document.emit('DOMContentLoaded');
  b.element('roomId').value = '20'; b.element('roomUsername').value = 'Player 20'; b.element('roomPassword').value = 'fixture-password';
  await [...b.element('gameLoginForm').events.get('submit')][0]({ preventDefault() {} });
  assert.equal(session.storage.getItem('token'), 'room-20-token');
  assert.equal(b.sandbox.localStorage.getItem('token'), 'admin-token');
  assert.equal(JSON.parse(b.sandbox.localStorage.getItem('user')).id, 99);
  assert.equal(b.sandbox.sessionStorage.getItem('testRoomSession'), null);
  assert.equal(b.element('submit').disabled, false);
  await b.clock.advance(1000);
  assert.equal(b.window.location.href, '/game');
});

test('test-room tokens stay in their own tab and an old flag cannot select a test session at /game', () => {
  const b = browser();
  b.window.location.search = '?test-room=40';
  b.sandbox.sessionStorage.setItem('testRoomSession', '1');
  b.sandbox.sessionStorage.setItem('room', JSON.stringify({ id: 40, is_test: true }));
  b.sandbox.sessionStorage.setItem('roomUser', JSON.stringify({ id: 41, room_id: 40 }));
  b.sandbox.sessionStorage.setItem('token', 'test-token');
  const session = load(b);
  assert.equal(session.isTest, true);
  assert.equal(session.storage, b.sandbox.sessionStorage);
  session.invalidate();
  assert.equal(b.sandbox.localStorage.getItem('token'), 'fixture-token');
  b.window.location.search = '';
  b.load('frontend/js/game-session.js');
  assert.equal(b.window.gameSession.isTest, false);
  assert.equal(b.window.gameSession.storage.getItem('token'), 'fixture-token');
});

test('an old rejected response cannot invalidate a more recent successful login', async () => {
  const b = browser(), session = load(b);
  const old = session.storage.getItem('token');
  session.saveLogin(login());
  await session.checkResponse(json({ error: 'Invalid token' }, 403), { headers: { Authorization: `Bearer ${old}` } });
  assert.equal(session.storage.getItem('token'), 'room-20-token');
  assert.equal(session.expired, false);
});

test('permission errors and game pause do not expire a valid player session', async () => {
  const b = browser(), session = load(b);
  for (const error of ['Game is paused', 'Access denied', 'Game time is over']) {
    await session.checkResponse(json({ error }, 403), { headers: { Authorization: 'Bearer fixture-token' } });
  }
  assert.equal(session.storage.getItem('token'), 'fixture-token');
  assert.equal(session.expired, false);
});

test('login page verifies a saved token on the server before returning to the game', async () => {
  const waiting = deferred();
  const { b } = loginPage(() => waiting.promise);
  await flush();
  assert.equal(b.window.location.href, '');
  assert.equal(b.calls[0].url, '/api/auth/session');
  waiting.resolve(json({ room_user: { id: 15, room_id: 14 } }));
  await flush();
  assert.equal(b.window.location.href, '/game');
});

test('invalid saved credentials keep the login form open with the room and player filled in', async () => {
  const { b, session } = loginPage(() => json({ error: 'Invalid token', code: 'AUTH_TOKEN_INVALID' }, 403));
  await flush();
  assert.equal(b.window.location.href, '');
  assert.equal(session.storage.getItem('token'), null);
  assert.equal(b.element('roomId').value, 14);
  assert.equal(b.element('roomUsername').value, 'Fixture');
  assert.match(b.element('message').innerHTML, /Войдите в комнату снова/);
});

test('an expired saved token is rejected before requests, and the pending route survives re-login', () => {
  const b = browser();
  const payload = Buffer.from(JSON.stringify({ exp: 500 })).toString('base64url');
  b.sandbox.localStorage.setItem('token', `fixture.${payload}.signature`);
  b.window.location.pathname = '/game-login';
  const session = load(b);
  session.saveRoute({ district: 'Ц', house: '31', apartment: '4' });
  b.element('message').querySelector = () => null;
  b.load('frontend/js/game-auth.js'); b.document.emit('DOMContentLoaded');
  assert.equal(session.expired, true);
  assert.equal(b.calls.length, 0);
  session.saveLogin({ ...login(14), user: { id: 15, username: 'Fixture' } });
  assert.equal(session.expired, false);
  assert.deepEqual(JSON.parse(JSON.stringify(session.restoreRoute())), { district: 'Ц', house: '31', apartment: '4' });
});
