const test=require('node:test'),assert=require('node:assert/strict');
const {browser,flush,deferred}=require('./test-helpers/browser-runtime.cjs');

async function sharedPage(fail=false){
 const b=browser(call=>{
  if(call.url.endsWith('/state'))return new Response(JSON.stringify({room:{id:14,state:'running'},questions_access:{is_open:true},questions:[{id:7,question_text:'Вопрос',answer_text:'Ответ игрока',revision:2}],notes:'',notes_revision:0,answers_submitted:false}));
  if(call.url.endsWith('/answers'))return new Response(JSON.stringify(fail?{error:'Бланк изменён другим участником'}:{submitted:true,finished:true}),{status:fail?409:200});
  throw Error('Unexpected request '+call.url);
 });
 b.values.set('room',JSON.stringify({id:14,scenario_id:12,shared:true}));b.window.location.replace=value=>{b.window.location.href=value;};b.sandbox.location=b.window.location;
 b.load('frontend/js/game-session.js');b.window.displayQuestions=()=>{};b.load('frontend/js/shared-game.js');
 await b.window.loadSharedQuestions();await flush();return b;
}

test('the shared answer button sends and finishes once, keeps only result access and opens the fee screen',async()=>{
 const b=await sharedPage();await b.window.submitAllAnswers();
 const sent=b.calls.find(c=>c.url.endsWith('/answers'));const body=JSON.parse(sent.options.body);
 assert.equal(body.finish,true);assert.equal(body.answers.length,1);assert.equal(body.answers[0].text,'Ответ игрока');assert.equal(body.answers[0].revision,2);
 assert.equal(b.window.location.href,'/room-result');assert.equal(b.window.gameSession.storage.getItem('token'),null);
 const result=JSON.parse(b.sandbox.sessionStorage.getItem('detectum-room-result'));assert.equal(result.token,'fixture-token');assert.equal(result.room_id,14);
});

test('a conflicting submission leaves the player in the game and keeps their answer and session',async()=>{
 const b=await sharedPage(true);await b.window.submitAllAnswers();
 assert.equal(b.window.location.href,'');assert.equal(b.window.gameSession.storage.getItem('token'),'fixture-token');
 assert.equal(b.element('answer_7').value,'Ответ игрока');assert.match(b.element('answers_global_status').textContent,/другим участником/);
 assert.equal(b.sandbox.sessionStorage.getItem('detectum-room-result'),null);
});

test('cancelled submission makes no write and an old pending result cannot overwrite a replacement',async()=>{
 const b=await sharedPage();b.sandbox.confirm=()=>false;await b.window.submitAllAnswers();assert.equal(b.calls.filter(c=>c.url.endsWith('/answers')).length,0);
 b.load('frontend/js/player-results.js');const wait=deferred();let rendered=false;
 const stop=b.window.detektumResults.watch({load:()=>wait.promise,onResult:()=>{rendered=true;},onError:()=>{}});
 stop();wait.resolve({scoring:{fee:1000}});await flush();assert.equal(rendered,false);
});
