const test = require('node:test');
const assert = require('node:assert/strict');
const { browser, deferred, hanging, flush } = require('./test-helpers/browser-runtime.cjs');

const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const state = { state: 'running', remaining: 120, room: { id: 14, scenario_id: 12 }, scenario_name: 'Fixture' };
function game(fetchImpl) {
  const b = browser(fetchImpl);
  b.load('frontend/js/game-session.js');
  b.load('frontend/js/game.js');
  b.run('updateTripHistory = () => {};'); // Rendering is covered by the existing board tests.
  return b;
}
const healthy = call => json(call.url.endsWith('/state') ? state : call.url.endsWith('/attempts') ?
  { attempts: [], choices_included: true } : { addresses: [] });

test('desktop workspace is available without a theme flag, including an old saved light preference', () => {
  const b = game(healthy);
  let wide = true, tall = true, touch = false;
  b.window.matchMedia = query => ({ matches: query.includes('min-width: 1280px') ? wide && tall : touch });
  assert.equal(b.run('isDesktopWorkspace()'), true, 'new visitors get the desktop workspace');
  b.sandbox.localStorage.setItem('detectum-theme', 'light');
  assert.equal(b.run('isDesktopWorkspace()'), true, 'the old preference cannot disable the workspace');
  touch = true;
  assert.equal(b.run('isDesktopWorkspace()'), false, 'touch devices retain the tablet layout');
  touch = false;
  wide = false;
  assert.equal(b.run('isDesktopWorkspace()'), false, 'narrow windows retain responsive navigation');
  wide = true;
  tall = false;
  assert.equal(b.run('isDesktopWorkspace()'), false, 'short landscape windows retain responsive navigation');
});

test('selecting a directory address fills the route without recording a visit', () => {
  const b = game(healthy);
  let returnedToJournal = false;
  b.element('game-tab').click = () => { returnedToJournal = true; };
  b.run("tripCount = 3; choosePlayerDestination({district:'Ц',house_number:'7',apartment:'2',name:'Анна Белова'});");
  assert.equal(b.element('districtSelect').value, 'Ц');
  assert.equal(b.element('houseNumber').value, '7');
  assert.equal(b.element('apartmentNumber').value, '2');
  assert.equal(b.element('selectedDestination').textContent, 'Анна Белова');
  assert.equal(b.run('tripCount'), 3);
  assert.equal(b.calls.length, 0);
  assert.equal(returnedToJournal, true);
});

test('a late directory search cannot replace the results of the newer query', async () => {
  const first = deferred(), second = deferred();
  const b = game(call => call.url.includes('q=first') ? first.promise : second.promise);
  b.sandbox.URLSearchParams = URLSearchParams;
  b.run("playerAddressBookSectionsLoaded = true; playerAddressBookFilter.q = 'first';");
  const older = b.run('loadPlayerAddressBookEntries()');
  await flush();
  b.run("playerAddressBookFilter.q = 'second';");
  const newer = b.run('loadPlayerAddressBookEntries()');
  await flush();
  second.resolve(json({entries:[{district:'Ц',house_number:'7',name:'New result'}]}));
  await newer;
  first.resolve(json({entries:[{district:'Ю',house_number:'8',name:'Old result'}]}));
  await older;
  assert.match(b.element('playerAddressBookTableBody').innerHTML, /New result/);
  assert.doesNotMatch(b.element('playerAddressBookTableBody').innerHTML, /Old result/);
});

test('room refresh is single-flight even across 1000 callers and recovers after timeout', async () => {
  let broken = true;
  const b = game(call => broken ? hanging(call) : healthy(call));
  const requests = Array.from({ length: 1000 }, () => b.run('refreshRoomState()'));
  await flush();
  assert.equal(b.calls.length, 1);
  await b.clock.advance(15000);
  assert.ok((await Promise.all(requests)).every(value => value === false));
  assert.equal(b.run('roomStateRequest'), null);
  broken = false;
  assert.equal(await b.run('refreshRoomState()'), true);
  assert.equal(b.run('roomState.state'), 'running');
  assert.equal(b.calls.length, 2);
  assert.equal(b.clock.jobs.size, 0);
});

test('timer ticks locally, paused/test rooms stay correct, and does not send requests', async () => {
  const b = game(healthy);
  await b.run('refreshRoomState()');
  b.run('initRoomTimer(); initRoomTimer();');
  const count = b.calls.length;
  await b.clock.advance(4000);
  assert.equal(b.element('timerDisplay').textContent, '1:56');
  assert.equal(b.calls.length, count);
  b.run("roomState.state = 'paused'; roomState.remaining = 120; renderTimer();");
  await b.clock.advance(10000);
  assert.equal(b.element('timerDisplay').textContent, 'Пауза 2:00');
  b.run("roomState.state = 'running'; roomState.remaining = 1; roomStateUpdatedAt = performance.now();");
  await b.clock.advance(3000);
  assert.equal(b.element('timerDisplay').textContent, '0:00');
  b.run('roomState.room.is_test = true; renderTimer();');
  assert.equal(b.element('timerDisplay').textContent, '∞ Без ограничений');
  b.run('updateBackgroundState();');
  assert.equal(b.clock.jobs.size, 0);
});

test('system clock corrections do not jump the game countdown', async () => {
  const b = game(healthy);
  await b.run('refreshRoomState()');
  b.run('initRoomTimer(); Date.now = () => 9999999999999;');
  await b.clock.advance(4000);
  assert.equal(b.element('timerDisplay').textContent, '1:56');
  b.run('updateBackgroundState();');
  assert.equal(b.clock.jobs.size, 0);
});

test('history and counter share a snapshot; 100 locations need only two HTTP requests', async () => {
  const attempts = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, found: true, address_id: i + 1,
    visited_location_id: i + 1, has_choices: true, address_description: 'Before', choice_response: `Choice ${i}`, location_names: [] }));
  const b = game(call => json(call.url.endsWith('/attempts') ? { attempts, choices_included: true } : { addresses: [] }));
  const promises = Array.from({ length: 1000 }, (_, i) => b.run(i % 2 ? 'loadTripCount()' : 'loadTripHistory()'));
  await Promise.all(promises);
  assert.equal(b.calls.length, 2);
  assert.equal(b.calls.filter(call => call.url.includes('/choice')).length, 0);
  assert.equal(b.run('tripCount'), 100);
  assert.equal(b.run('tripHistory[99].description'), 'Choice 99');
  assert.equal(b.run('tripHistoryRequest'), null);
  assert.equal(b.clock.jobs.size, 0);
});

test('history retains the last data on timeout and rejects late snapshots after an edit', async () => {
  const b = game(hanging);
  b.run("tripHistory = [{ id: 777, description: 'Keep' }]; tripCount = 1;");
  const request = b.run('loadTripHistory()');
  await flush();
  await b.clock.advance(15000);
  assert.equal(await request, false);
  assert.equal(b.run('tripCount'), 1);
  assert.equal(b.run('tripHistory[0].description'), 'Keep');

  const waiting = deferred();
  const c = game(() => waiting.promise);
  const stale = c.run('loadTripHistory()');
  await flush();
  c.run("tripHistory = [{ id: 999, description: 'New' }]; tripHistoryVersion++;");
  waiting.resolve(json({ attempts: [], choices_included: true }));
  await stale;
  assert.equal(c.run('tripHistory[0].description'), 'New');
});

test('older servers use two lookup workers, preserve result order and never overflow the queue', async () => {
  let activeChoices = 0, peak = 0;
  const attempts = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, found: true, address_id: i + 1,
    visited_location_id: i + 1, has_choices: true, address_description: 'Before' }));
  const b = game((call, clock) => {
    if (call.url.endsWith('/attempts')) return json({ attempts });
    if (!call.url.endsWith('/choice')) return json({ addresses: [] });
    activeChoices++; peak = Math.max(peak, activeChoices);
    const address = Number(call.url.match(/addresses\/(\d+)/)[1]);
    return new Promise(resolve => clock.set(() => { activeChoices--; resolve(json({ choice: { response_text: `Choice ${address}` } })); }, 10));
  });
  b.run('roomState = { room: { scenario_id: 12 } };');
  const request = b.run('loadTripHistory()');
  await flush();
  await b.clock.advance(1000);
  assert.equal(await request, true);
  assert.equal(peak, 2);
  assert.equal(b.calls.length, 102);
  assert.equal(b.run('tripHistory[0].description'), 'Choice 1');
  assert.equal(b.run('tripHistory[99].description'), 'Choice 100');
  assert.equal(b.api.stats().queued, 0);
  assert.equal(b.clock.jobs.size, 0);
});

test('closing a file preview aborts its download and frees the network slot', async () => {
  const b = game(hanging);
  const file = { id: 'fixture.pdf', type: 'application/pdf', name: 'Fixture' };
  b.sandbox.fileFixture = file;
  const opening = b.run('openApplicationFile("/files", fileFixture, 0, "fixture-token")');
  await flush();
  assert.equal(b.api.stats().active, 1);
  b.run('closeApplicationFolder();');
  await opening;
  assert.equal(b.calls[0].options.signal.aborted, true);
  assert.equal(b.api.stats().active, 0);
  assert.equal(b.clock.jobs.size, 0);
});

test('hidden, offline and navigation stop polls/SSE; repeated resume creates one connection', async () => {
  const b = game(healthy);
  b.run('backgroundReady = true; updateBackgroundState();');
  await b.clock.advance(0);
  assert.equal(b.sources.length, 1);
  b.sources[0].emit('open');
  b.document.hidden = true;
  b.document.emit('visibilitychange');
  await flush();
  const count = b.calls.length;
  assert.equal(b.sources[0].closed, true);
  await b.clock.advance(120000);
  assert.equal(b.calls.length, count);
  assert.equal(b.clock.jobs.size, 0);
  b.document.hidden = false;
  b.document.emit('visibilitychange');
  b.window.emit('online'); b.window.emit('pageshow');
  await b.clock.advance(0);
  assert.equal(b.sources.length, 2);
  b.sandbox.navigator.onLine = false;
  b.window.emit('offline');
  await flush();
  assert.equal(b.sources[1].closed, true);
  assert.equal(b.clock.jobs.size, 0);
  b.sandbox.navigator.onLine = true;
  b.window.emit('online');
  await b.clock.advance(0);
  b.window.emit('pagehide');
  await flush();
  assert.equal(b.clock.jobs.size, 0);
  b.window.emit('pageshow');
  await b.clock.advance(0);
  assert.equal(b.sources.filter(source => !source.closed).length, 1);
  b.window.emit('pagehide');
  await flush();
  assert.equal(b.clock.jobs.size, 0);
});

test('SSE has one reconnect timer, stale callbacks are harmless, watchdog recovers stalls', async () => {
  const b = game(healthy);
  b.run('backgroundReady = true; connectRoomSSE(14, "fixture-token");');
  const old = b.sources[0], callback = old.onerror;
  callback(); callback(); callback();
  assert.equal(old.closed, true);
  await b.clock.advance(5000);
  assert.equal(b.sources.length, 2);
  const current = b.sources[1];
  callback();
  assert.equal(current.closed, false);
  await b.clock.advance(15000);
  assert.equal(current.closed, true, 'stalled connection is closed by watchdog');
  await b.clock.advance(10000);
  assert.equal(b.sources.length, 3);
  const live = b.sources[2]; live.emit('open');
  for (let i = 0; i < 20; i++) { await b.clock.advance(25000); live.emit('ping'); }
  assert.equal(live.closed, false);
  assert.equal(b.sources.length, 3);
  b.run('stopRoomSSE();');
  assert.equal(b.clock.jobs.size, 0);
});

test('two-hour outage simulation does not accumulate requests or timers and then recovers', async () => {
  let broken = true, peak = 0;
  const b = game(call => broken ? hanging(call) : healthy(call));
  // Exercise the actual room poll; no API calls are fabricated by the test.
  b.run('roomStatePoll.start();');
  for (let minute = 0; minute < 120; minute++) {
    await b.clock.advance(60000);
    peak = Math.max(peak, b.api.stats().active);
    assert.ok(b.api.stats().active <= 1);
    assert.equal(b.api.stats().queued, 0);
    assert.ok(b.clock.jobs.size <= 2);
  }
  assert.ok(peak <= 1);
  assert.ok(b.calls.length < 150, 'backoff avoids the former 7200+ calls in two hours');
  broken = false;
  await b.clock.advance(90000);
  assert.equal(b.run('roomState.state'), 'running');
  b.run('roomStatePoll.stop();');
  await b.clock.advance(15000);
  assert.equal(b.api.stats().active, 0);
  assert.equal(b.clock.jobs.size, 0);
});

test('room polling rate is reduced while the timer keeps ticking', async () => {
  const b = game(healthy);
  b.run('initRoomTimer(); roomStatePoll.start();');
  await b.clock.advance(60000);
  assert.equal(b.calls.length, 13);
  b.run('roomStatePoll.stop(); clearInterval(roomTimerInterval); roomTimerInterval = null;');
  assert.equal(b.clock.jobs.size, 0);
});

test('failed trip submission preserves input and does not invent a trip or retry POST', async () => {
  const b = game(call => call.options.method === 'POST' ? hanging(call) : healthy(call));
  b.element('districtSelect').value = '1';
  b.element('houseNumber').value = '23';
  b.run("roomState = { state: 'running' }; tripCount = 7; tripHistory = [{ id: 1 }]; loadTripHistory = async () => false;");
  const first = b.run('visitLocation()');
  const duplicate = b.run('visitLocation()');
  await flush();
  assert.equal(b.calls.length, 1);
  await b.clock.advance(15000);
  await Promise.all([first, duplicate]);
  assert.equal(b.element('houseNumber').value, '23');
  assert.equal(b.run('tripCount'), 7);
  assert.equal(b.run('tripHistory.length'), 1);
  assert.equal(b.element('goBtn').disabled, false);
  assert.equal(b.alerts.length, 1);
  assert.equal(b.calls.length, 1);
});

test('HTTP errors do not invent trips, while a recorded missing address still counts', async () => {
  for (const status of [400, 401, 403, 500, 502]) {
    const b = game(() => new Response(JSON.stringify({ error: 'Fixture error' }), { status }));
    b.element('districtSelect').value = 'С';
    b.element('houseNumber').value = '23';
    b.run("roomState = { state: 'running' }; tripCount = 7; tripHistory = [{ id: 1 }]; loadTripHistory = async () => false;");
    await b.run('visitLocation()');
    assert.equal(b.run('tripCount'), 7);
    assert.equal(b.run('tripHistory.length'), 1);
    assert.equal(b.element('houseNumber').value, '23');
    assert.equal(b.element('goBtn').disabled, false);
    assert.equal(b.calls.length, 1);
  }
  const b = game(() => new Response(JSON.stringify({ error: 'Location not found', attempt_id: 18 }), { status: 404 }));
  b.element('districtSelect').value = 'С';
  b.element('houseNumber').value = '23';
  b.run("roomState = { state: 'running' }; tripCount = 7; tripHistory = []; ");
  await b.run('visitLocation()');
  assert.equal(b.run('tripCount'), 8);
  assert.equal(b.run('tripHistory[0].id'), 18);
  assert.equal(b.run('tripHistory[0].success'), false);
  assert.equal(b.element('houseNumber').value, '');
});

test('an admin login in another tab cannot replace the player token used for a trip', async () => {
  const b = game(() => json({ success: true, attempt_id: 19, location: { apartment: '4' } }));
  b.sandbox.localStorage.setItem('token', 'other-tab-admin-token');
  b.sandbox.localStorage.setItem('user', JSON.stringify({ id: 99, is_admin: true }));
  b.sandbox.localStorage.removeItem('roomUser');
  b.element('districtSelect').value = 'Ц';
  b.element('houseNumber').value = '31';
  b.element('apartmentNumber').value = '4';
  b.run("roomState = { state: 'running' }; refreshAvailableApplications = () => {}; ");
  await b.run('visitLocation()');
  assert.equal(b.calls[0].options.headers.Authorization, 'Bearer fixture-token');
  assert.equal(b.run("JSON.parse(gameStorage.getItem('roomUser')).id"), 15);
  assert.equal(b.run('tripCount'), 1);
  assert.equal(b.sandbox.localStorage.getItem('token'), 'other-tab-admin-token');
});

test('a rejected player token stops the session, preserves the route and never repeats the trip', async () => {
  const b = game(call => call.options.method === 'POST'
    ? new Response(JSON.stringify({ error: 'Invalid token' }), { status: 403 }) : healthy(call));
  b.element('districtSelect').value = 'Ц';
  b.element('houseNumber').value = '31';
  b.element('apartmentNumber').value = '4';
  b.run("roomState = { state: 'running' }; tripCount = 7; tripHistory = [{ id: 1 }]; backgroundReady = true; updateBackgroundState();");
  await b.clock.advance(0);
  b.run('tripCount = 7; tripHistory = [{ id: 1 }];');
  await b.run('visitLocation()');
  await b.clock.advance(120000);
  assert.equal(b.run("gameStorage.getItem('token')"), null);
  assert.equal(b.window.location.href, '/game-login?session=expired');
  assert.equal(b.run('tripCount'), 7);
  assert.equal(b.run('tripHistory[0].id'), 1);
  assert.equal(b.element('houseNumber').value, '31');
  assert.equal(b.element('apartmentNumber').value, '4');
  assert.equal(b.calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(b.sources.filter(source => !source.closed).length, 0);
  assert.equal(b.clock.jobs.size, 0);
  assert.equal(b.alerts.length, 0, 'the login page explains the problem instead of a raw alert');
});

test('an authentication rejection during history loading cannot leave a seemingly working session', async () => {
  const b = game(() => new Response(JSON.stringify({ error: 'Invalid token', code: 'AUTH_TOKEN_EXPIRED' }), { status: 403 }));
  assert.equal(await b.run('loadTripHistory()'), false);
  assert.equal(b.window.location.href, '/game-login?session=expired');
  assert.equal(b.run("gameStorage.getItem('token')"), null);
  assert.equal(b.run('backgroundAllowed()'), false);
});
