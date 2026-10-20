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

test('uploaded scenario briefing is available after game start without requiring any trips', async t => {
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

test('pending rooms cannot list or fetch briefing and application files; start unlocks them and pause keeps access',async t=>{
  const {fixture,request,upload}=await setup(t);
  await upload();
  await fixture.applications.save(12,50,1,[{originalname:'Улика.pdf',buffer:pdf,size:pdf.length}]);
  fixture.visits.push(50);
  const briefing=(await fixture.applications.getBriefing(12)).files[0];
  const application=(await fixture.applications.get(12,50,1)).files[0];
  const urls=['/game/scenarios/12/briefing',`/game/scenarios/12/briefing/files/${briefing.id}`,`/game/scenarios/12/briefing/files/${briefing.id}?preview=1`,
    '/game/scenarios/12/addresses/50/1',`/game/scenarios/12/addresses/50/1/files/${application.id}`];
  fixture.rooms.get(14).state='pending';
  for(const url of urls){
    const response=await request(url,fixture.playerToken);assert.equal(response.status,409);
    assert.equal((await response.json()).code,'GAME_NOT_STARTED');assert.equal(response.headers.get('cache-control'),'no-store');
  }
  const available=await(await request('/game/available',fixture.playerToken)).json();
  assert.equal(available.briefing.file_count,1,'the locked briefing remains discoverable in the interface');
  assert.equal((await request('/admin/scenarios/12/briefing')).status,200,'organizer editing is unaffected');
  for(const state of ['running','paused']){
    fixture.rooms.get(14).state=state;
    for(const url of urls){const response=await request(url,fixture.playerToken);assert.equal(response.status,200);await response.arrayBuffer();}
  }
  fixture.rooms.get(14).state='pending';fixture.rooms.get(14).is_test=true;
  assert.equal((await request('/game/scenarios/12/briefing',fixture.playerToken)).status,200,'scenario testing needs no timer');
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
  let rendered, closed = 0;
  b.window.gamePdfViewer = { async open(blob, host) { rendered = { blob, host }; }, close() { closed++; } };
  await b.run("openApplicationFile('/api/applications/game/scenarios/12/briefing', {id:'file.pdf', name:'Брифинг.pdf', type:'application/pdf'}, 0, 'fixture-token')");
  assert.equal(rendered.host, b.element('applicationPreview'));
  assert.equal(rendered.blob.type, 'application/pdf');
  assert.deepEqual(Buffer.from(await rendered.blob.arrayBuffer()), pdf);
  assert.equal(b.element('applicationDownloadBtn').hidden, false);
  assert.equal(b.element('applicationDownloadBtn').dataset.filename, 'Брифинг.pdf');
  assert.equal(b.element('applicationDownloadBtn').download, 'Брифинг.pdf');
  assert.match(b.element('applicationDownloadBtn').href, /^blob:/);
  const closes = closed;
  b.run('showApplicationFiles()');
  assert.equal(b.element('applicationDownloadBtn').hidden, true);
  assert.equal(b.element('applicationDownloadBtn').dataset.filename, undefined);
  assert.equal(b.run('applicationObjectUrl'), null);
  assert.ok(closed > closes, 'leaving the preview releases the PDF worker/render task');
});

test('a blocked document request shows the start-game popup instead of files without expiring the session',async()=>{
  for(const fileRequest of [false,true]){
    const b=browser(()=>new Response(JSON.stringify({code:'GAME_NOT_STARTED',error:'Сначала запустите таймер'}),{status:409,headers:{'Content-Type':'application/json'}}));
    b.load('frontend/js/game-session.js');b.load('frontend/js/game.js');
    b.run('applicationScenarioId=12;');
    b.sandbox.window.bootstrap=null;
    if(fileRequest)await b.run("openApplicationFile('/api/applications/game/scenarios/12/briefing',{id:'briefing.pdf',name:'Брифинг.pdf',type:'application/pdf'},0,'fixture-token')");
    else await b.run("openApplicationFolder(null,null,'',true)");
    assert.match(b.alerts.at(-1),/Пока таймер не запущен, посмотреть документы не получится/);
    assert.equal(b.element('applicationOverlay').classList.contains('is-open'),false);
    assert.equal(b.run('applicationObjectUrl'),null);
    assert.equal(b.window.gameSession.expired,false);
    assert.equal(b.calls.filter(c=>c.url.includes('/files/')).length,fileRequest?1:0);
    assert.equal(b.calls[0].options.cache,'no-store');
  }
});
