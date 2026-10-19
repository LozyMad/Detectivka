const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {browser,flush}=require('./test-helpers/browser-runtime.cjs');
const account={id:'qa-player',username:'Детектив'};
const demo={id:'borrowed-time',title:'Время взаймы',description:'Демо-дело',cover:'/assets/landing/borrowed-time-case-cover-v1.webp',price:0,duration_seconds:5400,difficulty:2,max_attempts:3,attempts_left:3,owned:true};

test('production publishes only the approved existing demo and keeps its actual scenario and content',async()=>{
 const calls=[],module={exports:{}};
 const query=async(sql,values=[])=>{calls.push({sql,values});return {rows:sql.startsWith('SELECT id,name')?[{id:9,name:'Время Взаймы',created_by:1},{id:6,name:'Ставка на молчание',created_by:1},{id:22,name:'Другой черновик',created_by:1}]:[]};};
 vm.runInNewContext(fs.readFileSync('backend/services/playerCatalogSeed.js','utf8'),{module,process:{env:{NODE_ENV:'production',PLAYER_LOCAL_MODE:'1'}},require:name=>{if(name==='../config/database')return {query};const throwIfUsed=()=>{throw Error('Scenario content must stay unchanged');};return {create:throwIfUsed,getByScenario:throwIfUsed};}});
 await module.exports.seedCatalog();
 const inserts=calls.filter(c=>c.sql.startsWith('INSERT'));
 assert.equal(inserts.length,2);
 const item=inserts.find(c=>c.values[0]==='borrowed-time');
 assert.equal(item.values[1],9);
 assert.equal(item.values[2],'Время взаймы');
 assert.equal(item.values[5],0);
 assert.equal(item.values[6],5400);
 assert.equal(item.values[4],demo.cover);
 assert.match(item.sql,/ON CONFLICT\(id\) DO NOTHING/);
});

function playerPage(route,loggedIn=false){
 const profile={account,products:[demo],bundles:[],games:[],orders:[],local_mode:false,stats:{rank:0,total_players:1,played:0,purchased:0,rating:0}};
 const b=browser(call=>{
  if(call.url.endsWith('/session'))return new Response(JSON.stringify(loggedIn?{account}:{error:'Войдите'}),{status:loggedIn?200:401});
  if(call.url.endsWith('/profile'))return new Response(JSON.stringify(profile));
  if(call.url.endsWith('/register')||call.url.endsWith('/login'))return new Response(JSON.stringify({account}));
  throw Error('Unexpected request '+call.url);
 });
 Object.assign(b.window.location,{pathname:route,search:'?demo=borrowed-time',hash:'',replace(value){this.href=value;}});
 b.sandbox.location=b.window.location;
 b.sandbox.FormData=class{constructor(form){return new Map(Object.entries(form.values));}};
 b.load('frontend/js/player.js');
 return b;
}

test('guest sees free demo registration and can switch to login without losing the chosen case',async()=>{
 const b=playerPage('/register');await flush();
 const html=b.element('content').innerHTML;
 assert.match(html,/Играть в «Время взаймы» бесплатно/);
 assert.match(html,/После регистрации.*в вашей библиотеке бесплатно/);
 assert.match(html,/\/account-login\?demo=borrowed-time/);
 assert.equal(b.window.location.href,'');
});

test('logged in player goes straight from the demo CTA to the library',async()=>{
 for(const route of ['/register','/account-login']){
  const b=playerPage(route,true);await flush();
  assert.equal(b.window.location.href,'/profile?demo=borrowed-time#my-library');
  assert.equal(b.calls.filter(c=>c.url.endsWith('/register')||c.url.endsWith('/login')).length,0);
 }
});

test('successful registration and login both land in the demo library without creating a game',async()=>{
 for(const kind of ['register','login']){
  const b=playerPage(kind==='register'?'/register':'/account-login');await flush();
  const submit={disabled:false},message={innerHTML:''};
  const form={dataset:{form:kind},values:{username:'Детектив',email:'qa@example.test',password:'qa-password',confirm_password:'qa-password'},elements:{accept_terms:{checked:true}},querySelector:selector=>selector==='[type=submit]'?submit:message};
  b.document.emit('submit',{target:form,preventDefault(){}});await flush();
  assert.equal(b.window.location.href,'/profile?demo=borrowed-time#my-library');
  assert.equal(b.calls.filter(c=>c.url.includes('/games')).length,0);
 }
});

test('profile shows the free demo inside a distinct library with a play action',async()=>{
 const b=playerPage('/profile',true);await flush();
 const html=b.element('content').innerHTML;
 assert.match(html,/id="my-library"/);
 assert.match(html,/Моя библиотека/);
 assert.match(html,/Демо «Время взаймы» уже в вашей библиотеке/);
 assert.match(html,/Играть бесплатно/);
 assert.match(html,/90 мин/);
});
