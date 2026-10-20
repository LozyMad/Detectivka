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
  b.load('frontend/js/player.js'); await flush();
  const click = async () => {
    const button = {dataset:{action:'result',id:'run'},disabled:false};
    b.document.emit('click',{target:{closest:selector=>selector==='[data-action]'?button:null}});
    await flush();
  };
  return {...b, click, setResult: value => {result = value;}};
}

test('queued AI result offers refresh and then shows the published score and escaped comment', async () => {
  const b = await page({run:{score:null},scoring:{fee:null,points:null,max_points:35,trips:2,ai_review:{status:'processing'}},ranked:false});
  await b.click();
  assert.match(b.element('player-dialog').innerHTML,/Ответы проверяются автоматически/);
  assert.match(b.element('player-dialog').innerHTML,/Обновить результат/);
  b.setResult({run:{score:2000},scoring:{fee:2000,max_fee:2000,points:35,max_points:35,trips:2,ai_review:{status:'completed'},grades:[{question_text:'Вопрос',grade:5,comment:'<script>bad</script>'}]},ranked:false,rating_rule:'Демо не меняет рейтинг.'});
  await b.click();
  assert.match(b.element('player-dialog').innerHTML,/35 \/ 35/);
  assert.ok(!b.element('player-dialog').innerHTML.includes('Обновить результат'));
  assert.match(b.element('player-dialog').innerHTML,/&lt;script&gt;/);
});

test('manual review does not promise automatic processing', async () => {
  const b = await page({run:{score:null},scoring:{fee:null,points:null,max_points:35,trips:2,ai_review:{status:'needs_review'}},ranked:false});
  await b.click();
  assert.match(b.element('player-dialog').innerHTML,/Организатор проверяет ответы/);
  assert.ok(!b.element('player-dialog').innerHTML.includes('Обновить результат'));
});
