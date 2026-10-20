const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const sqlite=require('../backend/node_modules/sqlite3');
const {roomSessionFixture}=require('./test-helpers/room-session-fixture.cjs');
const {browser}=require('./test-helpers/browser-runtime.cjs');
const {questionAccess}=require('../backend/services/questionAccess');

test('only an explicit administrator option creates an ordinary untimed room with immediately available questions',async t=>{
 const f=roomSessionFixture();
 const server=await new Promise(resolve=>{const s=f.app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const headers={Authorization:'Bearer '+f.jwt.sign({id:99},f.secret),'Content-Type':'application/json'};
 const create=body=>fetch('http://127.0.0.1:'+server.address().port+'/api/rooms',{method:'POST',headers,body:JSON.stringify({name:'Без времени',scenario_id:12,...body})});
 let response=await create({timer_disabled:true,duration_seconds:7200});
 assert.equal(response.status,201);
 const room=(await response.json()).room;
 assert.equal(room.duration_seconds,0);assert.equal(room.is_test,false);assert.equal(room.questions_delay_seconds,0);
 assert.equal(questionAccess(room).is_open,true);
 response=await create({duration_seconds:0});assert.equal(response.status,400);
 response=await create({timer_disabled:'true',duration_seconds:0});assert.equal(response.status,400);
 response=await create({is_test:true,timer_disabled:true});assert.equal((await response.json()).room.is_test,true);
});

test('an untimed SQLite room survives start, pause and resume without acquiring a deadline and finishes manually',async t=>{
 const db=new sqlite.Database(':memory:');
 const run=sql=>new Promise((resolve,reject)=>db.run(sql,e=>e?reject(e):resolve()));
 await run('CREATE TABLE scenarios (id INTEGER PRIMARY KEY,name TEXT)');
 await run("INSERT INTO scenarios VALUES (12,'Демо')");
 await run('CREATE TABLE rooms (id INTEGER PRIMARY KEY,name TEXT,scenario_id INTEGER,created_by INTEGER,duration_seconds INTEGER,is_test INTEGER,state TEXT,game_start_time TEXT,game_end_time TEXT,paused_at TEXT,halfway_paused INTEGER DEFAULT 0,questions_delay_seconds INTEGER)');
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync('backend/models/room.js','utf8'),{module,process:{env:{}},console,require:name=>{assert.equal(name,'../config/database');return{db};}});
 const Room=module.exports;
 t.after(()=>new Promise(resolve=>db.close(resolve)));
 const record=await Room.create({name:'Бесконечная',scenario_id:12,created_by:99,duration_seconds:0});
 assert.equal((await Room.getById(record.id)).state,'pending');
 await Room.startGame(record.id);
 let room=await Room.getById(record.id);
 assert.equal(room.state,'running');assert.equal(room.game_end_time,null);
 const timerModule={exports:{}};
 vm.runInNewContext(fs.readFileSync('backend/services/roomTimer.js','utf8'),{module:timerModule,require:name=>{assert.equal(name,'../models/room');return Room;}});
 assert.equal(timerModule.exports.remainingSeconds(room,new Date('2999-01-01')),null);
 assert.equal((await timerModule.exports.syncRoomTimer(record.id)).state,'running');
 assert.equal(await Room.finishIfRunning(record.id,'2999-01-01'),false);
 await Room.pauseGame(record.id);assert.equal((await Room.getById(record.id)).state,'paused');
 await Room.resumeGame(record.id);room=await Room.getById(record.id);
 assert.equal(room.state,'running');assert.equal(room.game_end_time,null);
 await Room.stopGame(record.id);assert.equal((await Room.getById(record.id)).state,'finished');
 const timed=await Room.create({name:'С таймером',scenario_id:12,created_by:99,duration_seconds:7200});
 await Room.startGame(timed.id);assert.ok((await Room.getById(timed.id)).game_end_time);
});

test('PostgreSQL start and resume also preserve a null deadline for untimed rooms',async()=>{
 let room={id:14,state:'pending',duration_seconds:0,game_end_time:null};
 const module={exports:{}};
 const query=async(sql,params)=>{
  if(sql.includes('LEFT JOIN scenarios'))return{rows:[room]};
  if(sql.includes("state = 'pending'")){assert.equal(params[1],null);room={...room,state:'running',game_end_time:params[1]};}
  else if(sql.includes("state = 'paused'")){assert.equal(params[1],null);room={...room,state:'running',game_end_time:params[1]};}
  return{rows:[room]};
 };
 vm.runInNewContext(fs.readFileSync('backend/models/roomPostgreSQL.js','utf8'),{module,console,require:()=>({query})});
 await module.exports.startGame(14);room.state='paused';await module.exports.resumeGame(14);
 assert.equal(room.game_end_time,null);
});

test('administrator form submits an untimed shared room and hides irrelevant duration controls',async()=>{
 const b=browser(call=>new Response(JSON.stringify(call.options?.method==='POST'?{room:{id:14}}:{rooms:[]})));
 b.window.location={href:'/admin'};b.load('frontend/js/admin.js');
 b.element('roomName').value='Бессрочная';b.element('roomScenario').value='12';b.element('roomDuration').value='120';
 b.element('roomIsTest').checked=false;b.element('roomWithoutTimer').checked=true;b.element('roomShared').checked=true;
 b.run('toggleTestRoomDuration()');assert.equal(b.element('roomDuration').disabled,true);assert.equal(b.element('roomDurationField').hidden,true);
 b.sandbox.event={preventDefault(){},target:{reset(){}}};
 b.run('showMessage=()=>{};loadRooms=async()=>{};');
 await b.run('handleCreateRoom(event)');
 const body=JSON.parse(b.calls.find(c=>c.options.method==='POST').options.body);
 assert.equal(body.timer_disabled,true);assert.equal(body.duration_seconds,0);assert.equal(body.is_test,false);assert.equal(body.shared_room,true);
 b.element('roomIsTest').checked=true;b.run('toggleTestRoomDuration()');assert.equal(b.element('roomWithoutTimer').disabled,true);
 b.run("scenarios=[];displayRooms([{id:14,name:'Бессрочная',duration_seconds:0,state:'running'}]);");
 assert.match(b.element('roomsTable').innerHTML,/Без таймера/);assert.doesNotMatch(b.element('roomsTable').innerHTML,/openRoomTimeDialog/);
});

test('player sees an untimed status, pause and manual completion instead of a zero countdown',()=>{
 const b=browser();b.load('frontend/js/game-session.js');b.load('frontend/js/game.js');
 b.run("roomState={state:'running',room:{id:14,duration_seconds:0},remaining:null};renderTimer();");
 assert.equal(b.element('timerDisplay').textContent,'∞ Без ограничений');assert.equal(b.element('answerDeadlineNotice').hidden,true);
 b.run("roomState.state='paused';renderTimer();");assert.equal(b.element('timerDisplay').textContent,'Пауза · без таймера');
 b.run("roomState.state='finished';renderTimer();");assert.equal(b.element('timerDisplay').textContent,'Завершено');
 b.run("roomState.state='pending';renderTimer();");assert.equal(b.element('timerDisplay').textContent,'Ожидание');
});
