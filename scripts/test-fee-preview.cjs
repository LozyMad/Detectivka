const test=require('node:test'),assert=require('node:assert/strict');
const {browser,flush}=require('./test-helpers/browser-runtime.cjs');

test('organizer preview and formula text follow each room version without publishing',async()=>{
 for(const [formula_version,expected] of [[1,1280],[2,1600]]){
  const room={room:{id:1,name:'Проверка',title:'Дело'},formula_version,review_status:'pending_review',max_fee:2000,max_points:35,standard_trips:20,trips:20,revision:0,questions:[]};
  const b=browser(call=>new Response(JSON.stringify(call.url.includes('/reviews/1')?room:{items:[]})));
  b.sandbox.location={search:'?room=1'};b.sandbox.innerWidth=1200;
  const form={querySelectorAll:()=>Array.from({length:7},()=>({value:'4'})),querySelector:selector=>b.element(selector)};
  b.element('review-detail').querySelector=()=>form;
  b.load('frontend/js/player-reviews.js');await flush();
  assert.equal(b.element('[data-preview]').textContent,'Предварительный гонорар: '+expected.toLocaleString('ru-RU'));
  assert.equal(b.element('review-detail').innerHTML.includes('(баллы / 35)²'),formula_version===1);
  assert.ok(b.calls.every(call=>call.options.method==='GET'));
 }
});
