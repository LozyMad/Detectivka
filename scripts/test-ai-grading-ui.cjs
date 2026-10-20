const test = require('node:test');
const assert = require('node:assert/strict');
const {browser, flush} = require('./test-helpers/browser-runtime.cjs');

async function page(initial) {
  let result = initial;
  const b = browser(call => {
    if (call.url.endsWith('/session')) return new Response(JSON.stringify({account:{id:'account',username:'Детектив'}}));
    if (call.url.endsWith('/catalog')) return new Response(JSON.stringify({products:[],bundles:[],local_mode:false}));
    if (call.url.endsWith('/games/run/result')) return new Response(JSON.stringify(result));
    throw new Error('Unexpected request '+call.url);
  });
  b.window.location.pathname = '/catalog'; b.sandbox.location = b.window.location;
  b.element('player-dialog').showModal = function () {this.open = true;};
  b.load('frontend/js/player-results.js');b.load('frontend/js/player.js'); await flush();
  const click = async () => {
    const button = {dataset:{action:'result',id:'run'},disabled:false};
    b.document.emit('click',{target:{closest:selector=>selector==='[data-action]'?button:null}});
    await flush();
  };
  return {...b, click, setResult: value => {result = value;}};
}

test('queued AI result automatically shows the published fee and side-by-side escaped answer review', async () => {
  const b = await page({run:{score:null},scoring:{fee:null,points:null,max_points:35,trips:2,ai_review:{status:'processing'}},ranked:false});
  await b.click();
  assert.match(b.element('player-dialog').innerHTML,/Ответы проверяются автоматически/);
  assert.match(b.element('player-dialog').innerHTML,/Обновить результат/);
  b.setResult({run:{score:2000},scoring:{fee:2000,max_fee:2000,points:35,max_points:35,trips:2,ai_review:{status:'completed'},grades:[{question_text:'Вопрос',grade:5,answer_text:'<img src=x onerror=bad()>',correct_answer:'Правильный ответ <script>test</script>',comment:'<script>bad</script>'}]},ranked:false,rating_rule:'Демо не меняет рейтинг.'});
  await b.clock.advance(2000);
  assert.match(b.element('player-dialog').innerHTML,/35 \/ 35/);
  assert.ok(!b.element('player-dialog').innerHTML.includes('Обновить результат'));
  assert.match(b.element('player-dialog').innerHTML,/&lt;script&gt;/);
  assert.match(b.element('player-dialog').innerHTML,/answer-comparison/);
  assert.match(b.element('player-dialog').innerHTML,/Ваш ответ/);assert.match(b.element('player-dialog').innerHTML,/Правильный ответ/);
  assert.doesNotMatch(b.element('player-dialog').innerHTML,/Комментарий к оценке|answer-feedback|&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(b.element('player-dialog').innerHTML,/&lt;img/);assert.doesNotMatch(b.element('player-dialog').innerHTML,/<script>|<img/);
  const requests=b.calls.filter(c=>c.url.endsWith('/games/run/result')).length;
  await b.clock.advance(10000);assert.equal(b.calls.filter(c=>c.url.endsWith('/games/run/result')).length,requests);
});

test('manual review does not promise automatic processing', async () => {
  const b = await page({run:{score:null},scoring:{fee:null,points:null,max_points:35,trips:2,ai_review:{status:'needs_review'}},ranked:false});
  await b.click();
  assert.match(b.element('player-dialog').innerHTML,/организатору на проверку/);
  const count=b.calls.length;await b.clock.advance(10000);assert.equal(b.calls.length,count);
});

test('closing a pending result stops polling and discards a later response',async()=>{
 const b=await page({run:{score:null},scoring:{fee:null,ai_review:{status:'processing'}}});await b.click();
 const count=b.calls.length;b.element('player-dialog').open=false;b.element('player-dialog').emit('close');
 await b.clock.advance(10000);assert.equal(b.calls.length,count);
});

test('closing an account dialog does not stop automatic grading updates on the dedicated fee page',async()=>{
 let requests=0;
 const b=browser(call=>{
  if(call.url.endsWith('/session'))return new Response(JSON.stringify({account:null}));
  if(call.url==='/api/game/shared/result'){requests++;return new Response(JSON.stringify({scoring:{fee:requests===1?null:1280,ai_review:{status:requests===1?'processing':'completed'}}}));}
  throw Error('Unexpected request');
 });
 b.window.location.pathname='/room-result';b.sandbox.location=b.window.location;
 b.sandbox.sessionStorage.setItem('detectum-room-result',JSON.stringify({token:'fixture-result-token'}));
 b.load('frontend/js/player-results.js');b.load('frontend/js/player.js');await flush();
 b.element('player-dialog').emit('close');await b.clock.advance(2000);
 assert.equal(requests,2);assert.match(b.element('room-result-content').innerHTML,/1\s*280/);
});
