const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { roomSessionFixture } = require('./test-helpers/room-session-fixture.cjs');

function fixture(findById) {
  const module = { exports: {} };
  let verifyCallback;
  vm.runInNewContext(fs.readFileSync('backend/middleware/auth.js', 'utf8'), {
    module, process: { env: { JWT_SECRET: 'test-only' } },
    require(name) {
      if (name === 'jsonwebtoken') return { verify(token, secret, callback) { verifyCallback = callback; } };
      if (name === '../models/user') return { findById };
      if (name === '../models/room') return {};
      throw new Error(`Unexpected dependency: ${name}`);
    }
  });
  return { middleware: module.exports, callback: () => verifyCallback };
}

test('real HTTP: room creation, room login and test-room login produce tokens accepted by trips', async t => {
  const f = roomSessionFixture();
  const server = await new Promise(resolve => { const listening = f.app.listen(0, '127.0.0.1', () => resolve(listening)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, token) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const staff = await (await post('/api/auth/login', { username: f.admin.username, password: 'fixture-password' })).json();
  for (const is_test of [false, true]) {
    const creation = await post('/api/rooms', { name: 'New fixture room', scenario_id: 12, duration_seconds: 7200, is_test }, staff.token);
    assert.equal(creation.status, 201);
    const { room } = await creation.json();
    const response = is_test ? await post(`/api/rooms/${room.id}/test-login`, {}, staff.token)
      : await post('/api/auth/room-login', { room_id: room.id, username: 'Шляпники', password: 'fixture-password' });
    assert.equal(response.status, 200);
    const data = await response.json();
    const session = await fetch(base + '/api/auth/session', { headers: { Authorization: `Bearer ${data.token}` } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).room_user.room_id, room.id);
    assert.equal(session.headers.get('Cache-Control'), 'no-store');
    const trip = await post('/api/game/visit', { district: 'Ц', house_number: '31', apartment: '4' }, data.token);
    assert.equal(trip.status, 200);
    assert.equal((await trip.json()).success, true);
    assert.equal(f.attempts.at(-1).room_id, room.id);
    assert.equal(f.attempts.at(-1).user_id, room.id + 1);
  }
  assert.equal(f.attempts.length, 2);
  const payload = { room_user_id: 15, room_id: 14, username: 'Шляпники', scenario_id: 12 };
  const rejected = [
    [f.jwt.sign(payload, f.secret, { expiresIn: -1 }), 'AUTH_TOKEN_EXPIRED'],
    [f.jwt.sign(payload, 'different-test-secret', { expiresIn: '24h' }), 'AUTH_TOKEN_INVALID'],
    ['malformed-fixture-token', 'AUTH_TOKEN_INVALID']
  ];
  for (const [token, code] of rejected) {
    const trip = await post('/api/game/visit', { district: 'Ц', house_number: '31', apartment: '4' }, token);
    assert.equal(trip.status, 403);
    assert.equal((await trip.json()).code, code);
  }
  assert.equal(f.attempts.length, 2, 'rejected tokens never record or consume a trip');
});

for (const name of ['authenticateToken', 'authenticateTokenQuery']) {
  function start(findById) {
    const f = fixture(findById);
    const req = { headers: { authorization: 'Bearer test-token' }, query: { token: 'test-token' } };
    const forwarded = [];
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    f.middleware[name](req, res, error => forwarded.push(error));
    return { ...f, req, res, forwarded };
  }

  test(`${name}: database rejection is forwarded instead of escaping the JWT callback`, async () => {
    const outage = new Error('Database connection lost');
    const f = start(async () => { throw outage; });
    await assert.doesNotReject(async () => f.callback()(null, { id: 1 }));
    assert.equal(f.forwarded.length, 1);
    assert.equal(f.forwarded[0], outage);
    assert.equal(f.res.body, undefined, 'central Express error handler owns the response');
    assert.equal(f.req.user, undefined, 'failed lookup never grants access');
  });

  test(`${name}: valid staff is loaded and a later request survives a database failure`, async () => {
    let broken = true;
    const user = { id: 1, is_admin: true };
    const f = start(async () => { if (broken) throw new Error('Temporary outage'); return user; });
    await f.callback()(null, { id: 1 });
    assert.equal(f.forwarded.length, 1);
    assert.ok(f.forwarded[0] instanceof Error);
    broken = false;
    const nextReq = { headers: { authorization: 'Bearer test-token' }, query: { token: 'test-token' } };
    const nextCalls = [];
    f.middleware[name](nextReq, f.res, error => nextCalls.push(error));
    await f.callback()(null, { id: 1 });
    assert.equal(nextReq.user, user);
    assert.equal(f.forwarded.length, 1, 'the failed request is not resumed');
    assert.equal(nextCalls.length, 1);
    assert.equal(nextCalls[0], undefined);
  });

  test(`${name}: invalid tokens and deleted users are still denied`, async () => {
    let lookups = 0;
    const f = start(async () => { lookups++; return null; });
    await f.callback()(new Error('Expired JWT'));
    assert.equal(f.res.statusCode, 403);
    assert.equal(lookups, 0);
    assert.equal(f.forwarded.length, 0);
    await f.callback()(null, { id: 1 });
    assert.equal(f.res.statusCode, 403);
    assert.equal(f.res.body.error, 'User not found');
    assert.equal(lookups, 1);
    assert.equal(f.forwarded.length, 0);
  });

  test(`${name}: room tokens bypass staff lookup and SSE retains expiry`, async () => {
    const f = start(async () => { throw new Error('Room token must not query staff'); });
    await f.callback()(null, { room_user_id: 15, room_id: 14, scenario_id: 12, username: 'Player', exp: 2000000000 });
    assert.equal(f.req.roomUser.id, 15);
    assert.equal(f.req.roomUser.room_id, 14);
    assert.equal(f.forwarded.length, 1);
    assert.equal(f.forwarded[0], undefined);
    if (name === 'authenticateTokenQuery') assert.equal(f.req.tokenExpiresAt, 2000000000000);
  });
}
