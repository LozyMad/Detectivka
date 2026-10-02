const test = require('node:test');
const assert = require('node:assert/strict');
const { browser, deferred, hanging, flush } = require('./test-helpers/browser-runtime.cjs');

const rooms = [{ id: 14, name: 'Fixture', is_test: true }];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
function admin(fetchImpl = () => json({ rooms })) {
  const b = browser(fetchImpl);
  b.window.location = { href: '/admin' };
  b.element('rooms-tab').style.display = 'block';
  b.load('frontend/js/admin.js');
  b.run(`displayRooms = value => { window.renderedRooms = value; };
    populateRoomsForUsers = () => {};
    showMessage = text => { window.lastMessage = text; };`);
  return b;
}

test('1000 admin refreshes share one request; timeout preserves rooms and permits recovery', async () => {
  let broken = true;
  const b = admin(call => broken ? hanging(call) : json({ rooms }));
  b.run("roomsCache = [{ id: 777 }]; roomsCacheTime = 0;");
  const requests = Array.from({ length: 1000 }, () => b.run('loadRooms(true)'));
  await flush();
  assert.equal(b.calls.length, 1);
  await b.clock.advance(15000);
  assert.ok((await Promise.all(requests)).every(value => value === false));
  assert.equal(b.run('roomsCache[0].id'), 777);
  assert.equal(b.window.renderedRooms[0].id, 777);
  assert.equal(b.run('roomsRequest'), null);
  broken = false;
  assert.equal(await b.run('loadRooms(true)'), true);
  assert.equal(b.run('roomsCache[0].id'), 14);
  assert.equal(b.calls.length, 2);
  await b.run('loadRooms()');
  assert.equal(b.calls.length, 2, 'fresh cache prevents another request');
  assert.equal(b.clock.jobs.size, 0);
});

test('malformed admin room responses preserve the last confirmed list', async () => {
  for (const value of [{}, { rooms: null }, { rooms: 'invalid' }]) {
    const b = admin(() => json(value));
    b.run('roomsCache = [{ id: 777 }];');
    assert.equal(await b.run('loadRooms(true)'), false);
    assert.equal(b.run('roomsCache[0].id'), 777);
    assert.equal(b.window.renderedRooms[0].id, 777);
  }
});

test('admin polling stops outside the rooms tab, while hidden, offline and during navigation', async () => {
  const b = admin();
  b.run('adminPageReady = true; updateAdminPolling(); updateAdminPolling();');
  await b.clock.advance(0);
  assert.equal(b.calls.length, 1);
  await b.clock.advance(15000);
  assert.equal(b.calls.length, 4);
  b.element('rooms-tab').style.display = 'none';
  b.run('updateAdminPolling();');
  await b.clock.advance(60000);
  assert.equal(b.calls.length, 4);
  assert.equal(b.clock.jobs.size, 0);
  b.element('rooms-tab').style.display = 'block';
  b.run('updateAdminPolling();');
  await b.clock.advance(0);
  b.document.hidden = true;
  b.document.emit('visibilitychange');
  await flush();
  assert.equal(b.clock.jobs.size, 0);
  b.document.hidden = false;
  b.document.emit('visibilitychange');
  b.window.emit('pageshow'); b.window.emit('online');
  await b.clock.advance(0);
  const count = b.calls.length;
  b.sandbox.navigator.onLine = false;
  b.window.emit('offline');
  await b.clock.advance(60000);
  assert.equal(b.calls.length, count);
  assert.equal(b.clock.jobs.size, 0);
  b.sandbox.navigator.onLine = true;
  b.window.emit('online');
  await b.clock.advance(0);
  b.window.emit('pagehide');
  await flush();
  assert.equal(b.clock.jobs.size, 0);
  b.window.emit('pageshow'); b.window.emit('pageshow');
  await b.clock.advance(0);
  assert.equal(b.calls.length, count + 2);
  b.run('logout();');
  await flush();
  assert.equal(b.window.location.href, '/enter');
  assert.equal(b.clock.jobs.size, 0);
});

test('two admin pages during a simulated two-hour outage have no pending request buildup', async () => {
  let broken = true;
  const pages = [admin(call => broken ? hanging(call) : json({ rooms })),
    admin(call => broken ? hanging(call) : json({ rooms }))];
  for (const b of pages) b.run('adminPageReady = true; updateAdminPolling();');
  for (let minute = 0; minute < 120; minute++) {
    for (const b of pages) {
      await b.clock.advance(60000);
      assert.ok(b.api.stats().active <= 1);
      assert.equal(b.api.stats().queued, 0);
      assert.ok(b.clock.jobs.size <= 2);
    }
  }
  broken = false;
  for (const b of pages) {
    assert.ok(b.calls.length < 150);
    await b.clock.advance(90000);
    assert.equal(b.run('roomsCache[0].id'), 14);
    b.window.emit('pagehide');
    await flush();
    assert.equal(b.api.stats().active, 0);
    assert.equal(b.clock.jobs.size, 0);
  }
});

test('session expiry stops admin polling and redirects without sending more requests', async () => {
  const b = admin(() => json({ error: 'Expired' }, 401));
  b.values.set('user', JSON.stringify({ id: 1, is_admin: true }));
  b.run('adminPageReady = true; updateAdminPolling();');
  await b.clock.advance(0);
  assert.equal(b.window.location.href, '/admin-login?session=expired');
  assert.equal(b.values.has('token'), false);
  assert.equal(b.values.has('user'), false);
  await b.clock.advance(120000);
  assert.equal(b.calls.length, 1);
  assert.equal(b.clock.jobs.size, 0);
});

test('unauthenticated admin initialization redirects before loading APIs or starting a timer', async () => {
  const b = admin();
  b.values.delete('token');
  b.document.emit('DOMContentLoaded');
  await flush();
  assert.equal(b.window.location.href, '/enter');
  assert.equal(b.calls.length, 0);
  assert.equal(b.clock.jobs.size, 0);
});

test('a slow admin folder upload gets its longer deadline and is never retried', async () => {
  const transfer = deferred();
  const b = admin(() => transfer.promise);
  b.sandbox.FormData = FormData;
  b.element('editAddressScenarioId').value = '12';
  b.element('editAddressId').value = '100';
  b.element('applicationNumber').value = '1';
  b.element('applicationFolder').files = [Object.assign(new Blob(['Fixture']), { name: 'fixture.pdf' })];
  b.run('loadAddressApplications = async () => {};');
  const upload = b.run('uploadAddressApplication()');
  await flush();
  await b.clock.advance(60000);
  assert.equal(b.api.stats().active, 1, 'upload remains active beyond the normal API deadline');
  assert.equal(b.element('uploadApplicationBtn').disabled, true);
  assert.equal(b.calls.length, 1);
  transfer.resolve(json({}));
  await upload;
  assert.equal(b.element('uploadApplicationBtn').disabled, false);
  assert.equal(b.api.stats().active, 0);
  assert.equal(b.clock.jobs.size, 0);
  assert.equal(b.calls.length, 1);
});
