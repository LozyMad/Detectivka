const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Clock } = require('./test-helpers/browser-runtime.cjs');

function sse() {
  const clock = new Clock(), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('backend/sse/roomEvents.js', 'utf8'), { module,
    Date: { now: () => clock.now }, setTimeout: (fn, delay) => clock.set(fn, delay), clearTimeout: id => clock.jobs.delete(id),
    setInterval: (fn, delay) => clock.set(fn, delay, delay), clearInterval: id => clock.jobs.delete(id) });
  return { clock, ...module.exports };
}
class Client extends EventEmitter {
  constructor() { super(); this.messages = []; this.destroyed = false; this.writableEnded = false; }
  write(value) {
    if (this.failure) throw new Error('Disconnected');
    this.messages.push(value);
    return !this.blocked;
  }
  destroy() { this.destroyed = true; this.emit('close'); }
  end() { this.writableEnded = true; this.emit('finish'); }
}

test('all rooms share one heartbeat, receive pings, and clean up the final timer', async () => {
  const stream = sse(), a = new Client(), b = new Client();
  stream.subscribe(14, a); stream.subscribe(15, b);
  assert.equal(stream.clock.jobs.size, 1);
  await stream.clock.advance(25000);
  assert.match(a.messages[1], /event: ping/);
  assert.match(b.messages[1], /event: ping/);
  stream.broadcastNewTrip(14);
  assert.match(a.messages[2], /new_trip/);
  assert.equal(b.messages.length, 2);
  a.emit('close'); assert.equal(stream.clock.jobs.size, 1);
  b.emit('finish'); assert.equal(stream.clock.jobs.size, 0);
  assert.equal(a.listenerCount('close'), 0);
  assert.equal(b.listenerCount('error'), 0);
});

test('slow, errored and disconnected clients do not retain buffers or subscriptions', async () => {
  for (const mode of ['blocked', 'failure', 'destroyed', 'writableEnded']) {
    const stream = sse(), client = new Client();
    stream.subscribe(14, client);
    client[mode] = true;
    stream.broadcastNewTrip(14);
    assert.equal(stream.clock.jobs.size, 0);
    const count = client.messages.length;
    await stream.clock.advance(60000);
    assert.equal(client.messages.length, count);
    assert.equal(client.listenerCount('close'), 0);
  }
  const stream = sse(), client = new Client();
  stream.subscribe(14, client); client.emit('error', new Error('Socket failure'));
  assert.equal(stream.clock.jobs.size, 0);
});

test('5000 connect/disconnect cycles and two idle hours leave no SSE timers', async () => {
  const stream = sse();
  for (let i = 0; i < 5000; i++) {
    const client = new Client();
    stream.subscribe(14, client); stream.subscribe(14, client);
    assert.equal(stream.clock.jobs.size, 1);
    assert.equal(client.listenerCount('close'), 1);
    client.emit('close');
    assert.equal(stream.clock.jobs.size, 0);
  }
  const client = new Client(); stream.subscribe(14, client);
  await stream.clock.advance(2 * 60 * 60 * 1000);
  assert.equal(client.messages.filter(message => message.includes('event: ping')).length, 288);
  client.destroy(); assert.equal(stream.clock.jobs.size, 0);
});

test('SSE closes at token expiry and early disconnect clears the expiry timer', async () => {
  const stream = sse(), client = new Client();
  stream.subscribe(14, client, stream.clock.now + 30000);
  assert.equal(stream.clock.jobs.size, 2);
  await stream.clock.advance(30000);
  assert.equal(client.writableEnded, true);
  assert.equal(stream.clock.jobs.size, 0);
  const expired = new Client();
  stream.subscribe(14, expired, stream.clock.now - 1);
  assert.equal(expired.writableEnded, true);
  assert.equal(stream.clock.jobs.size, 0);
  const early = new Client();
  stream.subscribe(14, early, stream.clock.now + 100000);
  early.destroy();
  assert.equal(stream.clock.jobs.size, 0);
});

function stats({ type = 'postgresql', failed = false, room = true } = {}) {
  const queries = [], module = { exports: {} }, scenarioCalls = [];
  const attempts = [
    { id: 1, found: true, address_id: 8, district: '1', house_number: '2' },
    { id: 2, found: false, address_id: 8, district: '1', house_number: '3' },
    { id: 3, found: true, address_id: 9, district: '1', house_number: '4' }
  ];
  const mocks = {
    '../models/visitAttempt': { getByUserAndScenario: async (...args) => { assert.deepEqual(args, [15, 12, room ? 14 : null]); return attempts; } },
    '../models/scenario': { getActive: async () => { scenarioCalls.push(1); return { id: 12 }; } },
    '../models/room': { getById: async id => { assert.equal(id, 14); return { id: 14, scenario_id: 12 }; } },
    '../models/address': { hasChoices: async () => true, getById: async () => ({ is_internet_cafe: false }) },
    '../models/addressBook': { ensureSeeded: async () => {}, findNamesByAddress: async () => [] },
    '../config/database': { query: async (sql, params) => {
      queries.push({ sql, params: [...params] });
      if (failed) throw new Error('Temporary database issue');
      return { rows: [{ address_id: 8, response_text: 'Latest' }, { address_id: 8, response_text: 'Old' }] };
    } }
  };
  vm.runInNewContext(fs.readFileSync('backend/controllers/statsController.js', 'utf8'), {
    module, process: { env: { DB_TYPE: type } }, console: { error() {} },
    require: path => { if (!mocks[path]) throw new Error(`Unexpected module ${path}`); return mocks[path]; }
  });
  const req = room ? { roomUser: { id: 15, room_id: 14 }, params: { user_id: 999 } } : { user: { id: 15 } };
  let result;
  const res = { json(value) { result = value; }, status(code) { assert.equal(code, 200); return this; } };
  return { run: async () => { await module.exports.getUserAttempts(req, res); return result; }, queries, scenarioCalls };
}

test('choices are batched for the authenticated player/current scenario and not revealed for failed visits', async () => {
  const fixture = stats();
  const result = await fixture.run();
  assert.equal(result.choices_included, true);
  assert.equal(result.attempts[0].choice_response, 'Latest');
  assert.equal(result.attempts[1].choice_response, null);
  assert.equal(result.attempts[2].choice_response, null);
  assert.equal(fixture.queries.length, 1);
  assert.deepEqual(fixture.queries[0].params, [15, 12]);
  assert.match(fixture.queries[0].sql, /room_user_id = \$1 AND scenario_id = \$2/);
  assert.equal(fixture.scenarioCalls.length, 0);
});

test('choice query failure preserves attempts and explicitly enables the bounded legacy fallback', async () => {
  const fixture = stats({ failed: true });
  const result = await fixture.run();
  assert.equal(result.choices_included, false);
  assert.equal(result.attempts.length, 3);
});

test('SQLite compatibility and ordinary user history do not run PostgreSQL choice queries', async () => {
  const sqlite = stats({ type: 'sqlite' });
  assert.equal((await sqlite.run()).choices_included, false);
  assert.equal(sqlite.queries.length, 0);
  const user = stats({ room: false });
  assert.equal((await user.run()).choices_included, true);
  assert.equal(user.queries.length, 0);
  assert.equal(user.scenarioCalls.length, 1);
});
