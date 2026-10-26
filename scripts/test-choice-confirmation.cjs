const test=require('node:test');
const assert=require('node:assert/strict');
const {browser,deferred,flush}=require('./test-helpers/browser-runtime.cjs');
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
function fixture(fetch=()=>json({response:'Последствия выбора'})){
  const b=browser(fetch);let buttons=[];
  b.document.createElement=()=>b.element('option-'+Math.random());
  Object.defineProperty(b.element('choiceButtons'),'innerHTML',{set(){buttons=[];}});
  b.element('choiceButtons').appendChild=button=>buttons.push(button);
  b.document.querySelectorAll=selector=>selector==='#choiceButtons button'?buttons:[];
  const dialog=b.element('choiceConfirmDialog');dialog.open=false;
  dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  b.sandbox.bootstrap={Modal:class{show(){}}};
  b.load('frontend/js/game-session.js');b.load('frontend/js/game.js');
  b.run(`currentScenarioId=12;currentAddressId=50;currentVisitedLocationId=51;
    showInteractiveChoiceModal([{id:1,choice_text:'Следовать за человеком'},{id:2,choice_text:'Осмотреть здание'}],'Перед вами два пути.');`);
  return {...b,buttons:()=>buttons,dialog};
}
test('choosing an option opens confirmation without posting; cancel and Escape preserve both options',()=>{
  const b=fixture();b.buttons()[0].emit('click');
  assert.equal(b.dialog.open,true);assert.equal(b.calls.length,0);
  assert.equal(b.element('choiceIntroTitle').textContent,'Перед вами развилка');
  assert.equal(b.element('choiceConfirmSelection').textContent,'Следовать за человеком');
  b.element('choiceConfirmCancel').emit('click');assert.equal(b.dialog.open,false);
  b.buttons()[1].emit('click');assert.equal(b.element('choiceConfirmSelection').textContent,'Осмотреть здание');
  b.dialog.emit('cancel',{preventDefault(){}});assert.equal(b.dialog.open,false);assert.equal(b.calls.length,0);
});
test('only explicit confirmation sends the chosen option, once while the request is pending',async()=>{
  const pending=deferred(),b=fixture(()=>pending.promise);
  b.buttons()[1].emit('click');const request=b.run('confirmPlayerChoice()');
  await flush();await b.run('confirmPlayerChoice()');b.buttons()[0].emit('click');
  assert.equal(b.calls.length,1);assert.ok(b.buttons().every(button=>button.disabled));
  assert.deepEqual(JSON.parse(b.calls[0].options.body),{room_user_id:15,scenario_id:12,address_id:50,choice_id:2,visited_location_id:51});
  pending.resolve(json({response:'Вы осматриваете здание.'}));await request;
  assert.equal(b.element('choiceOptions').style.display,'none');
  assert.equal(b.element('choiceIntroTitle').textContent,'Выбор сделан');
  assert.match(b.element('responseText').innerHTML,/осматриваете/);
});
test('closing a branch invalidates its pending confirmation and late result cannot overwrite a new branch',async()=>{
  const pending=deferred(),b=fixture(()=>pending.promise);
  b.buttons()[0].emit('click');b.element('choiceModal').emit('hidden.bs.modal');
  await b.run('confirmPlayerChoice()');assert.equal(b.calls.length,0);assert.equal(b.dialog.open,false);
  b.run("currentScenarioId=12;currentAddressId=50;showInteractiveChoiceModal([{id:1,choice_text:'Первый'}],'Старая развилка');makePlayerChoice(1)");
  const request=b.run('confirmPlayerChoice()');await flush();
  b.run("currentAddressId=60;showInteractiveChoiceModal([{id:3,choice_text:'Другой'}],'Новая развилка');");
  pending.resolve(json({response:'Старый результат'}));await request;
  assert.equal(b.element('choiceOptions').style.display,'block');
  assert.equal(b.element('choiceResponse').style.display,'none');assert.equal(b.element('choiceIntroTitle').textContent,'Перед вами развилка');
});
test('a failed mutation is never retried automatically and a cancelled option never submits',async()=>{
  const b=fixture(()=>json({error:'Недоступно'},500));
  b.buttons()[0].emit('click');await b.run('confirmPlayerChoice()');
  await b.clock.advance(60000);assert.equal(b.calls.length,1);assert.equal(b.run('choiceSubmitInFlight'),false);
  b.run("showInteractiveChoiceModal([{id:2,choice_text:'Новый вариант'}],'Развилка');makePlayerChoice(2);cancelPlayerChoice()");
  await b.run('confirmPlayerChoice()');assert.equal(b.calls.length,1);
});
