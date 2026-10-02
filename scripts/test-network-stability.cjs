const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { browser, deferred, hanging, flush } = require('./test-helpers/browser-runtime.cjs');

test('identical reads share one transfer; every caller gets a readable body', async () => {
  const waiting = deferred();
  const b = browser(() => waiting.promise);
  const promises = Array.from({ length: 1000 }, () => b.api.fetch('/state').then(response => response.json()));
  await flush();
  assert.equal(b.calls.length, 1);
  waiting.resolve(new Response('{"value":42}'));
  const results = await Promise.all(promises);
  assert.ok(results.every(value => value.value === 42));
  assert.deepEqual({ ...b.api.stats() }, { active: 0, queued: 0, reads: 0 });
  assert.equal(b.clock.jobs.size, 0);
});

test('authorization isolates coalesced reads and mutations are never coalesced', async () => {
  const b = browser(hanging);
  const requests = [
    b.api.fetch('/same', { headers: { Authorization: 'A' } }),
    b.api.fetch('/same', { headers: { Authorization: 'B' } }),
    b.api.fetch('/same', { method: 'POST', body: '{}' }),
    b.api.fetch('/same', { method: 'POST', body: '{}' })
  ].map(promise => promise.catch(error => error.name));
  await flush();
  assert.equal(b.calls.length, 3);
  assert.equal(b.api.stats().queued, 1);
  await b.clock.advance(15000);
  assert.ok((await Promise.all(requests)).every(name => name === 'TimeoutError'));
  assert.equal(b.calls.length, 3, 'queued mutation expired and was not sent or retried');
  assert.equal(b.clock.jobs.size, 0);
});

test('concurrency, queue size and queue lifetime stay bounded during an outage', async () => {
  const b = browser(hanging);
  const promises = Array.from({ length: 1000 }, (_, i) => b.api.fetch(`/request/${i}`).catch(error => error.name));
  await flush();
  assert.equal(b.api.stats().active, 3);
  assert.equal(b.api.stats().queued, 64);
  assert.equal(b.calls.length, 3);
  await b.clock.advance(15000);
  await Promise.all(promises);
  assert.equal(b.api.stats().active, 0);
  assert.equal(b.api.stats().queued, 0);
  assert.equal(b.api.stats().reads, 0);
  assert.equal(b.clock.jobs.size, 0);
  assert.ok(b.calls.every(call => call.options.signal.aborted));
});

test('deadline includes body download, not just response headers', async () => {
  let stream;
  const b = browser(call => {
    const body = new ReadableStream({ start(controller) { stream = controller; controller.enqueue(new TextEncoder().encode('{')); } });
    call.options.signal.addEventListener('abort', () => stream.error(new Error('Aborted')));
    return new Response(body);
  });
  const request = b.api.fetch('/body', { timeoutMs: 100 }).catch(error => error.name);
  await flush();
  assert.equal(b.api.stats().active, 1);
  await b.clock.advance(100);
  assert.equal(await request, 'TimeoutError');
  assert.equal(b.api.stats().active, 0);
  assert.equal(b.clock.jobs.size, 0);
});

test('hidden tabs cancel reads but allow an already submitted save to finish', async () => {
  const writes = deferred();
  const b = browser(call => call.options.method === 'PATCH' ? writes.promise : hanging(call));
  const read = b.api.fetch('/read').catch(error => error.name);
  const write = b.api.fetch('/note', { method: 'PATCH', body: '{}' });
  await flush();
  b.document.hidden = true;
  b.document.emit('visibilitychange');
  assert.equal(await read, 'AbortError');
  assert.equal(b.api.stats().active, 1);
  assert.equal(b.calls[1].options.signal.aborted, false);
  writes.resolve(new Response('{"saved":true}'));
  assert.deepEqual(await (await write).json(), { saved: true });
  assert.equal(b.clock.jobs.size, 0);
});

test('navigation cancels all work; BFCache restore accepts fresh requests', async () => {
  const b = browser(hanging);
  const old = b.api.fetch('/save', { method: 'POST' }).catch(error => error.name);
  await flush();
  b.window.emit('pagehide');
  assert.equal(await old, 'AbortError');
  assert.equal(await b.api.fetch('/new').catch(error => error.name), 'AbortError');
  assert.equal(b.api.stats().active, 0);
  b.window.emit('pageshow');
  const next = b.api.fetch('/new', { timeoutMs: 10 }).catch(error => error.name);
  await flush();
  assert.equal(b.calls.length, 2);
  await b.clock.advance(10);
  assert.equal(await next, 'TimeoutError');
});

test('poller never overlaps a slow task and old generations cannot restart it', async () => {
  const pending = deferred();
  const b = browser();
  let count = 0;
  const poll = b.api.poll(() => { count++; return pending.promise; }, 1000);
  poll.start(); poll.start();
  await b.clock.advance(120000);
  assert.equal(count, 1);
  poll.stop();
  pending.resolve(true);
  await flush();
  await b.clock.advance(120000);
  assert.equal(count, 1);
  assert.equal(b.clock.jobs.size, 0);
});

test('failed polls back off and a successful poll resets the delay', async () => {
  const b = browser(); let calls = 0;
  const poll = b.api.poll(async () => ++calls >= 3, 5000);
  poll.start();
  await b.clock.advance(0); assert.equal(calls, 1);
  await b.clock.advance(9999); assert.equal(calls, 1);
  await b.clock.advance(1); assert.equal(calls, 2);
  await b.clock.advance(20000); assert.equal(calls, 3);
  await b.clock.advance(5000); assert.equal(calls, 4);
  poll.stop(); assert.equal(b.clock.jobs.size, 0);
});

test('real HTTP transfer: JSON, 204, binary body and stalled body', async () => {
  let stalled = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/stall') { stalled = true; res.writeHead(200); res.write('partial'); return; }
    if (req.url === '/empty') { res.writeHead(204); res.end(); return; }
    if (req.url === '/binary') { res.end(Buffer.from([0, 255, 123, 44])); return; }
    res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const b = browser(call => fetch(call.url, call.options));
  try {
    assert.deepEqual(await (await b.api.fetch(base)).json(), { ok: true });
    assert.equal((await b.api.fetch(`${base}/empty`)).status, 204);
    assert.deepEqual([...new Uint8Array(await (await b.api.fetch(`${base}/binary`)).arrayBuffer())], [0, 255, 123, 44]);
    const slow = b.api.fetch(`${base}/stall`, { timeoutMs: 100 }).catch(error => error.name);
    const deadline = Date.now() + 3000;
    while (!stalled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(stalled, true);
    await flush();
    await b.clock.advance(100);
    assert.equal(await slow, 'TimeoutError');
    assert.equal(b.api.stats().active, 0);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
