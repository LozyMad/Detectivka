const test = require('node:test');
const assert = require('node:assert/strict');
const { briefingFixture } = require('./test-helpers/briefing-fixture.cjs');
const { browser } = require('./test-helpers/browser-runtime.cjs');

const pdf = Buffer.from('%PDF-1.4\nTest briefing\n%%EOF');
async function setup(t) {
  const fixture = briefingFixture();
  const server = fixture.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fixture.cleanup(); });
  const request = (url, token = fixture.adminToken, options = {}) => fetch(
    `http://127.0.0.1:${server.address().port}/api/applications${url}`,
    { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const upload = (data = pdf, name = 'Брифинг.pdf') => {
    const body = new FormData(); body.append('files', new Blob([data]), name);
    return request('/admin/scenarios/12/briefing', fixture.adminToken, { method: 'POST', body });
  };
  return { fixture, request, upload };
}

test('uploaded scenario briefing is available before any trips and can be opened immediately', async t => {
  const { fixture, request, upload } = await setup(t);
  assert.equal((await upload()).status, 201);
  const available = await (await request('/game/available', fixture.playerToken)).json();
  assert.equal(available.scenario_id, 12);
  assert.deepEqual(available.addresses, []);
  assert.equal(available.briefing.file_count, 1);
  const briefing = await (await request('/game/scenarios/12/briefing', fixture.playerToken)).json();
  assert.equal(briefing.application.files[0].name, 'Брифинг.pdf');
  const file = await request(`/game/scenarios/12/briefing/files/${briefing.application.files[0].id}`, fixture.playerToken);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), pdf);
  assert.equal(fixture.addressLookups, 0, 'briefing requires no address or successful trip');
  assert.equal((await request('/game/scenarios/12/addresses/50/1', fixture.playerToken)).status, 403,
    'regular applications still require a trip');
});

test('briefing access is limited to the scenario admin and players of that scenario', async t => {
  const { fixture, request, upload } = await setup(t);
  await upload();
  const adminListing = await (await request('/admin/scenarios/12/briefing')).json();
  const fileId = adminListing.briefing.files[0].id;
  assert.equal((await request('/admin/scenarios/13/briefing')).status, 403);
  assert.equal((await request('/admin/scenarios/13/briefing', fixture.adminToken, { method: 'POST', body: new FormData() })).status, 403);
  assert.equal((await request('/admin/scenarios/12/briefing', fixture.playerToken, { method: 'DELETE' })).status, 403);
  assert.equal((await request('/admin/scenarios/12/briefing', fixture.playerToken)).status, 403);
  assert.equal((await request('/game/scenarios/12/briefing', fixture.otherPlayerToken)).status, 403);
  assert.equal((await request(`/game/scenarios/12/briefing/files/${fileId}`, fixture.otherPlayerToken)).status, 403);
  assert.equal((await request('/game/scenarios/12/briefing', fixture.adminToken)).status, 403);
  assert.equal((await request('/game/scenarios/12/briefing', '')).status, 401);
  assert.equal((await request('/admin/scenarios/0/briefing')).status, 400);
  assert.equal((await request('/game/scenarios/12/briefing/files/not-a-file', fixture.playerToken)).status, 404);
  assert.equal((await (await request('/game/available', fixture.otherPlayerToken)).json()).briefing, null);
});

test('invalid uploads retain the previous briefing; replacement, copying and deletion follow the scenario', async t => {
  const { fixture, request, upload } = await setup(t);
  await upload();
  assert.equal((await upload(Buffer.from('not a PDF'), 'fake.pdf')).status, 400);
  const excess = new FormData();
  for (let index = 0; index < 31; index++) excess.append('files', new Blob([pdf]), `${index}.pdf`);
  assert.equal((await request('/admin/scenarios/12/briefing', fixture.adminToken, { method: 'POST', body: excess })).status, 400);
  const empty = new FormData();
  assert.equal((await request('/admin/scenarios/12/briefing', fixture.adminToken, { method: 'POST', body: empty })).status, 400);
  assert.equal((await fixture.applications.getBriefing(12)).files[0].name, 'Брифинг.pdf');
  const previous = (await fixture.applications.getBriefing(12)).files[0].id;
  await upload(pdf, 'Новый брифинг.pdf');
  assert.equal((await fixture.applications.getBriefing(12)).files[0].name, 'Новый брифинг.pdf');
  assert.equal((await request(`/game/scenarios/12/briefing/files/${previous}`, fixture.playerToken)).status, 404);
  await fixture.applications.copyScenario(12, 13, {});
  assert.equal((await fixture.applications.getBriefing(13)).files[0].name, 'Новый брифинг.pdf');
  assert.equal((await request('/admin/scenarios/12/briefing', fixture.adminToken, { method: 'DELETE' })).status, 200);
  assert.equal((await (await request('/game/available', fixture.playerToken)).json()).briefing, null);
  assert.equal((await request('/game/scenarios/12/briefing', fixture.playerToken)).status, 404);
  assert.ok(await fixture.applications.getBriefing(13), 'deletion leaves the copied scenario intact');
  await fixture.applications.removeScenario(13);
  assert.equal(await fixture.applications.getBriefing(13), null);
});

test('briefing and regular address applications coexist without changing visit restrictions', async t => {
  const { fixture, request, upload } = await setup(t);
  await upload();
  await fixture.applications.save(12, 50, 1, [{ originalname: 'Улика.pdf', buffer: pdf, size: pdf.length }]);
  fixture.visits.push(50);
  const available = await (await request('/game/available', fixture.playerToken)).json();
  assert.equal(available.briefing.file_count, 1);
  assert.equal(available.addresses[0].applications[0].number, 1);
  assert.equal((await request('/game/scenarios/12/addresses/50/1', fixture.playerToken)).status, 200);
});

test('player sidebar shows the briefing first with no trips and opens the shared viewer', async () => {
  const b = browser(call => new Response(JSON.stringify(call.url.endsWith('/available') ?
    { scenario_id: 12, addresses: [], briefing: { file_count: 1 } } : { application: { files: [{ id: 'briefing.pdf', name: 'Брифинг.pdf', type: 'application/pdf' }] } })));
  b.load('frontend/js/game-session.js'); b.load('frontend/js/game.js');
  b.run('roomState = null; tripHistory = [];');
  await b.run('refreshAvailableApplications()');
  assert.equal(b.element('materialsCount').textContent, '1');
  assert.match(b.element('receivedApplicationsList').innerHTML, /Брифинг дела/);
  assert.doesNotMatch(b.element('receivedApplicationsList').innerHTML, /Приложение undefined/);
  await b.run("openApplicationFolder(null, null, '', true)");
  assert.equal(b.calls.at(-1).url, '/api/applications/game/scenarios/12/briefing');
  assert.equal(b.element('applicationTitle').textContent, 'Брифинг дела');
  assert.match(b.element('applicationFiles').innerHTML, /Брифинг/);
  b.run('scenarioBriefing = null; updateReceivedApplications();');
  assert.equal(b.element('materialsCount').textContent, '0');
  assert.equal(b.element('receivedApplicationsList').textContent, 'Пока нет приложений');
});

test('PDF files expose a download action that is cleared when leaving the preview', async () => {
  const b = browser(() => new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } }));
  b.load('frontend/js/game-session.js'); b.load('frontend/js/game.js');
  let viewer;
  b.document.createElement = tag => ({ tagName: tag.toUpperCase() });
  b.element('applicationPreview').append = element => { viewer = element; };
  await b.run("openApplicationFile('/api/applications/game/scenarios/12/briefing', {id:'file.pdf', name:'Брифинг.pdf', type:'application/pdf'}, 0, 'fixture-token')");
  assert.equal(viewer.tagName, 'IFRAME');
  assert.equal(b.element('applicationDownloadBtn').hidden, false);
  assert.equal(b.element('applicationDownloadBtn').dataset.filename, 'Брифинг.pdf');
  assert.equal(b.element('applicationDownloadBtn').href, viewer.src);
  assert.equal(b.element('applicationDownloadBtn').download, 'Брифинг.pdf');
  assert.match(viewer.src, /^blob:/);
  b.run('showApplicationFiles()');
  assert.equal(b.element('applicationDownloadBtn').hidden, true);
  assert.equal(b.element('applicationDownloadBtn').dataset.filename, undefined);
  assert.equal(b.run('applicationObjectUrl'), null);
});
