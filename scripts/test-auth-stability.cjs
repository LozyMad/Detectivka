const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

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
