const test=require('node:test');
const assert=require('node:assert/strict');
const sqlite3=require('../backend/node_modules/sqlite3');
const {randomUUID}=require('node:crypto');
const {createPlayerCabinet}=require('../backend/services/playerCabinet');
const {remainingSeconds}=require('../backend/services/roomTimer');

async function fixture(t,options={}){
  const db=new sqlite3.Database(':memory:');
  const query=(sql,values=[])=>new Promise((resolve,reject)=>db.all(sql,values,(error,rows)=>error?reject(error):resolve({rows})));
  let pending=Promise.resolve();
  const transaction=work=>{const result=pending.then(async()=>{await query('BEGIN IMMEDIATE');try{const value=await work(query);await query('COMMIT');return value;}catch(error){await query('ROLLBACK');throw error;}});pending=result.catch(()=>{});return result;};
  for(const sql of [
    'PRAGMA foreign_keys=ON',
    'CREATE TABLE scenarios (id INTEGER PRIMARY KEY,name TEXT,created_by INTEGER)',
    'CREATE TABLE admin_scenario_permissions (id INTEGER PRIMARY KEY,admin_id INTEGER,scenario_id INTEGER)',
    `CREATE TABLE rooms (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,scenario_id INTEGER,created_by INTEGER,duration_seconds INTEGER,is_test BOOLEAN,state TEXT,game_start_time TEXT,game_end_time TEXT,halfway_paused BOOLEAN,paused_at TEXT)`,
    'CREATE TABLE room_users (id INTEGER PRIMARY KEY AUTOINCREMENT,room_id INTEGER,username TEXT,password TEXT,UNIQUE(room_id,username))',
    'CREATE TABLE visit_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,room_id INTEGER,scenario_id INTEGER,found BOOLEAN)',
    'CREATE TABLE questions (id INTEGER PRIMARY KEY,scenario_id INTEGER,question_text TEXT,question_order INTEGER,is_active BOOLEAN)',
    'CREATE TABLE question_answers (id INTEGER PRIMARY KEY AUTOINCREMENT,question_id INTEGER,room_user_id INTEGER,answer_text TEXT)',
    "INSERT INTO scenarios VALUES (1,'Дело',1),(2,'Чужое дело',2)",
    "INSERT INTO questions VALUES (1,1,'Кто?',1,TRUE),(2,2,'Почему?',1,TRUE)"
  ])await query(sql);
  let store;
  const roomSync=async id=>await store?.houses.syncRoom(id)|| (await query('SELECT * FROM rooms WHERE id=$1',[id])).rows[0];
  store=createPlayerCabinet({query,transaction,remainingSeconds,roomSync,findTeams:async()=>[],aiGrader:options.aiGrader});
  await store.init();
  await query(`INSERT INTO player_products (id,scenario_id,title,description,cover,price,duration_seconds,difficulty,max_attempts,rubric,solution) VALUES ('demo',1,'Дело','','',0,7200,1,3,$1,'Секретный разбор')`,[JSON.stringify([{question_id:1,answers:['Анна']}])]);
  const admin={id:1,username:'Организатор',is_admin:true,admin_level:'admin'},chief={...admin,admin_level:'super_admin'},other={...admin,id:2};
  const body=extra=>({request_key:randomUUID(),...extra});
  const revision=async id=>Number((await query('SELECT revision FROM game_houses WHERE id=$1',[id])).rows[0].revision);
  const create=async(extra={})=>(await store.houses.create(admin,body({name:'Дом',scenario_id:1,duration_seconds:7200,...extra}))).id;
  const add=async(id,name='Агентство',extra={})=>store.houses.addTeam(admin,id,body({revision:await revision(id),name,password:'секрет123',participants:'4–6',...extra}));
  const control=async(id,action,extra={})=>store.houses.control(admin,id,body({revision:await revision(id),action,...extra}));
  const detail=id=>store.houses.detail(admin,id);
  const user=async roomId=>({id:(await query('SELECT room_user_id FROM shared_rooms WHERE room_id=$1',[roomId])).rows[0].room_user_id,room_id:roomId});
  t.after(async()=>{store.scoring.aiReviews.stop();await pending;await new Promise(resolve=>db.close(resolve));});
  return {query,transaction,store,admin,chief,other,body,revision,create,add,control,detail,roomSync,user};
}
const rejected=(promise,status)=>assert.rejects(promise,error=>error.status===status);

test('organizer can disable only the question delay while retaining a common timed investigation',async t=>{
  const f=await fixture(t),id=await f.create({questions_immediate:true}),a=await f.add(id);
  let data=await f.detail(id);assert.equal(data.house.duration_seconds,7200);assert.equal(data.house.questions_delay_seconds,0);
  await f.store.houses.update(f.admin,id,f.body({revision:await f.revision(id),name:'Дом',scenario_id:1,duration_seconds:7200,questions_immediate:false}));
  assert.equal((await f.roomSync(a.room_id)).questions_delay_seconds,900);
  await f.store.houses.update(f.admin,id,f.body({revision:await f.revision(id),name:'Дом',scenario_id:1,duration_seconds:7200,questions_immediate:true}));
  await f.control(id,'start');
  const identity=await f.user(a.room_id),state=await f.store.shared.snapshot(identity);
  assert.equal(state.questions_access.is_open,true);assert.equal(state.questions.length,1);assert.ok((await f.roomSync(a.room_id)).game_end_time);
  await f.store.shared.submitAnswers(identity,{finish:true,answers:[{question_id:1,text:'Анна',revision:0}]});
  assert.equal((await f.roomSync(a.room_id)).state,'finished');
});

test('six agencies in two timed houses automatically enqueue AI reviews and publish independent results',async t=>{
  let calls=0;
  const grader={config:{enabled:true,modelUri:'gpt://house-fixture/model'},grade:async({questions})=>{
    calls++;return {grades:questions.map(q=>({question_id:q.id,matched:q.ai_rule.items.map(item=>item.id),grade:5,comment:'Верно.',needs_review:false,review_reason:''})),usage:{input_tokens:100,output_tokens:100},model:'house-fixture'};
  }};
  const f=await fixture(t,{aiGrader:grader});
  const {rules}=require('../backend/services/borrowedTimeGrading');
  await f.query('DELETE FROM questions');await f.query('DELETE FROM player_products');
  for(let i=0;i<rules.length;i++)await f.query('INSERT INTO questions VALUES ($1,1,$2,$3,TRUE)',[i+1,rules[i].aliases[0],i+1]);
  await f.query("INSERT INTO player_products (id,scenario_id,title,description,cover,price,duration_seconds,difficulty,max_attempts,published) VALUES ('borrowed-time',1,'Время Взаймы','','',1000,7200,1,3,1)");
  const houses=[];
  for(let h=0;h<2;h++){
    const id=await f.create({name:'ИИ-тест '+h,questions_immediate:true}),teams=[];
    for(let n=0;n<3;n++)teams.push(await f.add(id,'Агентство '+n));
    houses.push({id,teams});await f.control(id,'start');
  }
  for(const house of houses)for(const team of house.teams){
    const identity=await f.user(team.room_id),state=await f.store.shared.snapshot(identity);
    assert.equal(state.questions_access.is_open,true);assert.equal(state.questions.length,7);
    await f.query('INSERT INTO visit_attempts (user_id,room_id,scenario_id,found) VALUES ($1,$2,1,TRUE)',[identity.id,team.room_id]);
    await f.store.shared.submitAnswers(identity,{finish:true,answers:state.questions.map((q,i)=>({question_id:q.id,text:rules[i].answer,revision:q.revision}))});
  }
  assert.equal((await f.query("SELECT room_id FROM player_ai_reviews WHERE status='queued'")).rows.length,6);
  for(let i=0;i<6;i++)await f.store.scoring.aiReviews.tick();
  assert.equal(calls,6);assert.equal((await f.query("SELECT room_id FROM player_ai_reviews WHERE status='completed'")).rows.length,6);
  for(const house of houses){
    await f.control(house.id,'finish',{confirmed:true});const standings=await f.detail(house.id);
    assert.equal(standings.standings_final,true);assert.deepEqual(standings.teams.map(t=>t.fee),[2000,2000,2000]);
    for(const team of house.teams){const result=await f.store.shared.result(await f.user(team.room_id));assert.equal(result.scoring.ai_review.status,'completed');assert.equal(result.scoring.grades.length,7);}
  }
  assert.equal((await f.query('SELECT * FROM player_attempts')).rows.length,0);
});

test('house creation, settings, ownership and public lobby expose only intended data',async t=>{
  const f=await fixture(t),id=await f.create({format:'offline',venue:'Кафе',scheduled_at:'2026-11-01T15:00:00Z'});
  await f.add(id,'Сыщики');
  const data=await f.detail(id),publicId=data.house.public_id;
  const info=await f.store.houses.publicInfo(publicId);
  assert.equal(info.house.name,'Дом');assert.equal(info.house.venue,'Кафе');assert.equal(info.teams[0].name,'Сыщики');
  assert.equal(info.house.created_by,undefined);assert.equal(info.teams[0].fee,undefined);assert.equal(info.teams[0].password,undefined);
  assert.equal((await f.store.houses.list(f.other)).items.length,0);
  await rejected(f.store.houses.detail(f.other,id),404);await rejected(f.store.houses.create({},f.body({name:'Нет',scenario_id:1})),403);
  await rejected(f.create({scenario_id:2}),403);
  await f.query('INSERT INTO admin_scenario_permissions VALUES (1,1,2)');assert.ok(await f.create({scenario_id:2}));
  assert.equal((await f.store.houses.detail(f.chief,id)).house.id,id);
});

test('password entry shares one team identity, cannot cross houses or bypass passwords via invitation',async t=>{
  const f=await fixture(t),id=await f.create(),a=await f.add(id,'А'),b=await f.add(id,'Б'),otherId=await f.create(),other=await f.add(otherId,'А');
  const publicId=(await f.detail(id)).house.public_id;
  const first=await f.store.houses.join(publicId,{room_id:a.room_id,password:'секрет123'}),second=await f.store.houses.join(publicId,{room_id:a.room_id,password:'секрет123'});
  assert.equal(first.user.id,second.user.id);assert.equal(first.room.shared,true);assert.equal(first.shared_access.is_owner,false);
  assert.notEqual(first.user.id,(await f.store.houses.join(publicId,{room_id:b.room_id,password:'секрет123'})).user.id);
  await rejected(f.store.houses.join(publicId,{room_id:other.room_id,password:'секрет123'}),401);
  await rejected(f.store.houses.join(publicId,{room_id:a.room_id,password:'wrong'}),401);
  const invite=(await f.query('SELECT invite_token FROM shared_rooms WHERE room_id=$1',[a.room_id])).rows[0].invite_token;
  await rejected(f.store.shared.join(invite),403);await rejected(f.store.shared.adminInvite(a.room_id,f.admin),409);
  assert.match(first.shared_access.invite_path,/^\/house\//);
});

test('one source of time controls all teams; retries, stale revisions and individual controls are safe',async t=>{
  const f=await fixture(t),id=await f.create(),a=await f.add(id,'А'),b=await f.add(id,'Б');
  await f.control(id,'start');
  let ra=await f.roomSync(a.room_id),rb=await f.roomSync(b.room_id);
  assert.equal(ra.game_start_time,rb.game_start_time);assert.equal(ra.game_end_time,rb.game_end_time);assert.equal(ra.scenario_name,'Дело');
  const body=f.body({revision:await f.revision(id),action:'add_time',minutes:15});
  await f.store.houses.control(f.admin,id,body);await f.store.houses.control(f.admin,id,body);
  assert.equal((await f.detail(id)).house.duration_seconds,8100);
  await rejected(f.store.houses.control(f.admin,id,f.body({action:'pause',revision:body.revision})),409);
  await f.control(id,'pause');ra=await f.roomSync(a.room_id);rb=await f.roomSync(b.room_id);
  assert.equal(ra.state,'paused');assert.equal(ra.paused_at,rb.paused_at);const frozen=remainingSeconds(ra);
  await f.control(id,'add_time',{minutes:1});assert.equal(remainingSeconds(await f.roomSync(a.room_id)),frozen+60);
  await f.control(id,'resume');assert.equal((await f.roomSync(b.room_id)).state,'running');
  await rejected(f.store.admin.control(f.admin,a.room_id,{action:'pause'}),409);
  await rejected(f.add(id,'Поздняя команда'),409);
  await rejected(f.control(id,'start'),409);
  await rejected(f.control(id,'finish'),400);await f.control(id,'finish',{confirmed:true});
  assert.equal((await f.roomSync(a.room_id)).state,'finished');assert.equal((await f.roomSync(b.room_id)).state,'finished');
});

test('settings and scoring are frozen at house start, independent of team creation dates',async t=>{
  const f=await fixture(t),id=await f.create(),a=await f.add(id,'А');
  await f.query('INSERT INTO scenario_scoring_settings VALUES (1,5000,25,1,$1)',[new Date().toISOString()]);
  const b=await f.add(id,'Б');await f.control(id,'start');
  const conditions=(await f.query('SELECT max_fee,standard_trips,settings_revision FROM player_room_scoring ORDER BY room_id')).rows;
  assert.deepEqual(conditions,[{max_fee:5000,standard_trips:25,settings_revision:1},{max_fee:5000,standard_trips:25,settings_revision:1}]);
  await f.query('UPDATE scenario_scoring_settings SET max_fee=100 WHERE scenario_id=1');
  assert.equal((await f.store.scoring.conditions(a.room_id)).max_fee,5000);assert.equal((await f.store.scoring.conditions(b.room_id)).max_fee,5000);
  await rejected(f.store.houses.update(f.admin,id,f.body({revision:await f.revision(id),name:'Иное',scenario_id:1,duration_seconds:7200})),409);
});

test('expiry and halfway pause synchronize every room even when clients were disconnected',async t=>{
  const f=await fixture(t),id=await f.create(),a=await f.add(id,'А'),b=await f.add(id,'Б');await f.control(id,'start');
  await f.query('UPDATE game_houses SET game_end_time=$1 WHERE id=$2',[new Date(Date.now()-1000).toISOString(),id]);
  assert.equal((await f.roomSync(a.room_id)).state,'finished');assert.equal((await f.roomSync(b.room_id)).state,'finished');
  const half=await f.create({pause_halfway:true}),c=await f.add(half,'В');await f.control(half,'start');
  await f.query('UPDATE game_houses SET game_end_time=$1 WHERE id=$2',[new Date(Date.now()-1000).toISOString(),half]);
  const paused=await f.roomSync(c.room_id);assert.equal(paused.state,'paused');assert.equal(remainingSeconds(paused),3600);
  await f.control(half,'resume');assert.equal((await f.roomSync(c.room_id)).state,'running');
});

test('early submission closes only its agency; team drafts, results and answer keys remain isolated',async t=>{
  const f=await fixture(t),id=await f.create(),a=await f.add(id,'А'),b=await f.add(id,'Б');await f.control(id,'start');
  await f.query('UPDATE game_houses SET game_end_time=$1 WHERE id=$2',[new Date(Date.now()+6200000).toISOString(),id]);
  await f.query('UPDATE rooms SET game_end_time=$1',[new Date(Date.now()+6200000).toISOString()]);
  const ua=await f.user(a.room_id),ub=await f.user(b.room_id);
  await f.store.shared.saveNotes(ua,{text:'Только команда А',revision:0});
  assert.equal((await f.store.shared.snapshot(ub)).notes,'');
  await rejected(f.store.shared.result({...ua,id:ub.id}),403);
  await f.query('INSERT INTO visit_attempts (user_id,room_id,scenario_id,found) VALUES ($1,$2,1,TRUE)',[ua.id,a.room_id]);
  await f.store.shared.submitAnswers(ua,{finish:true,answers:[{question_id:1,text:'Анна',revision:0}]});
  assert.equal((await f.roomSync(a.room_id)).state,'finished');assert.equal((await f.roomSync(b.room_id)).state,'running');
  let result=await f.store.shared.result(ua);assert.equal(result.awaiting_house_finish,true);assert.deepEqual(result.scoring.grades,[]);assert.equal(result.scoring.fee,2000);
  assert.equal((await f.query('SELECT * FROM player_attempts')).rows.length,0);
  await f.control(id,'finish',{confirmed:true});result=await f.store.shared.result(ua);assert.equal(result.awaiting_house_finish,false);assert.equal(result.scoring.grades[0].correct_answer,'Анна');
  const login=await f.store.houses.join((await f.detail(id)).house.public_id,{room_id:a.room_id,password:'секрет123'});assert.equal(login.finished,true);
});

test('standings sort published fees, share equal places and never turn unchecked teams into zero scores',async t=>{
  const f=await fixture(t),id=await f.create();const teams=[];
  for(const name of ['А','Б','В','Г'])teams.push(await f.add(id,name));
  await f.control(id,'start');await f.control(id,'finish',{confirmed:true});await f.detail(id);
  for(let i=0;i<3;i++)await f.query("UPDATE player_room_scoring SET fee=$1,review_status='graded' WHERE room_id=$2",[i===2?900:1200,teams[i].room_id]);
  await f.query("UPDATE player_room_scoring SET fee=NULL,review_status='pending_review' WHERE room_id=$1",[teams[3].room_id]);
  let data=await f.detail(id);assert.deepEqual(data.teams.map(t=>t.place),[1,1,3,null]);assert.equal(data.standings_final,false);assert.equal(data.teams[3].fee,null);
  await f.query("UPDATE player_room_scoring SET fee=0,review_status='graded' WHERE room_id=$1",[teams[3].room_id]);
  data=await f.detail(id);assert.equal(data.standings_final,true);assert.equal(data.teams[3].place,4);
  const lobby=await f.store.houses.publicInfo(data.house.public_id);assert.ok(!JSON.stringify(lobby).includes('1200'));
});

test('draft house settings, passwords, removals and idempotent preparation keep existing data consistent',async t=>{
  const f=await fixture(t),body=f.body({name:'Первый',scenario_id:1,duration_seconds:7200});
  const {id}=await f.store.houses.create(f.admin,body);assert.deepEqual(await f.store.houses.create(f.admin,body),{id});
  const teamBody=f.body({revision:0,name:'А',password:'secret',participants:'5'});
  const a=await f.store.houses.addTeam(f.admin,id,teamBody);assert.deepEqual(await f.store.houses.addTeam(f.admin,id,teamBody),a);
  assert.ok(!JSON.stringify((await f.query('SELECT * FROM house_operations')).rows).includes('secret'));
  await rejected(f.add(id,'а'),409);
  await f.store.houses.editTeam(f.admin,id,a.room_id,f.body({revision:await f.revision(id),name:'Б',participants:'6–8',password:'changed'}));
  await f.store.houses.update(f.admin,id,f.body({revision:await f.revision(id),name:'Новый дом',scenario_id:1,timer_disabled:true,format:'offline',venue:'Зал'}));
  assert.equal((await f.roomSync(a.room_id)).duration_seconds,0);
  const publicId=(await f.detail(id)).house.public_id;
  await rejected(f.store.houses.join(publicId,{room_id:a.room_id,password:'secret'}),401);
  assert.equal((await f.store.houses.join(publicId,{room_id:a.room_id,password:'changed'})).user.username,'Б');
  await f.store.houses.removeTeam(f.admin,id,a.room_id,f.body({revision:await f.revision(id)}));
  assert.equal((await f.detail(id)).teams.length,0);assert.equal((await f.roomSync(a.room_id)).state,'finished');
  await rejected(f.control(id,'start'),409);
});

test('real HTTP enforces organizer ownership, team passwords, rate limits and all legacy timer guards',async t=>{
  const f=await fixture(t),id=await f.create(),a=await f.add(id,'А'),b=await f.add(id,'Б');
  const publicId=(await f.detail(id)).house.public_id;
  const fs=require('node:fs'),vm=require('node:vm'),express=require('../backend/node_modules/express'),jwt=require('../backend/node_modules/jsonwebtoken');
  const secret='house-http-fixture';let legacyMutations=0;
  const respond=(_req,res)=>{legacyMutations++;res.json({ok:true});};
  const dependencies={express,jsonwebtoken:jwt,'../models/user':{findById:async id=>Number(id)===1?f.admin:f.other},'../models/room':{},
    '../services/playerRuntime':{cabinet:f.store},'../services/playerDatabase':{query:f.query},'../services/roomTimer':{syncRoomTimer:f.roomSync},
    '../controllers/roomController':Object.fromEntries(['createRoom','changeTestRoomScenario','enterTestRoom','listRooms','addRoomUser','listRoomUsers','removeRoomUser','startRoomTimer','pauseRoomTimer','resumeRoomTimer','stopRoomTimer','deleteRoom'].map(k=>[k,respond]))};
  function load(path){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path,'utf8'),{module,console,process:{env:{JWT_SECRET:secret}},require:name=>{if(!(name in dependencies))throw Error('Unexpected dependency: '+name);return dependencies[name];}});return module.exports;}
  const auth=load('backend/middleware/auth.js');dependencies['../middleware/auth']=auth;
  const app=express();app.use(express.json());app.use('/api/houses',load('backend/routes/houses.js'));app.use('/api/rooms',load('backend/routes/room.js'));
  app.get('/game',auth.authenticateToken,(_req,res)=>res.json({ok:true}));
  app.get('/result',auth.authenticateResultToken,(req,res,next)=>f.store.shared.result(req.roomUser).then(r=>res.json(r)).catch(next));
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  const staff=jwt.sign({id:1},secret),other=jwt.sign({id:2},secret),ua=await f.user(a.room_id),ub=await f.user(b.room_id);
  const player=jwt.sign({room_user_id:ua.id,room_id:a.room_id},secret),forged=jwt.sign({room_user_id:ub.id,room_id:a.room_id},secret);
  const call=(path,method='GET',body,token=staff,headers={})=>fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  assert.equal((await call('/api/houses','GET',undefined,null)).status,401);
  assert.equal((await call('/api/houses/'+id,'GET',undefined,other)).status,404);
  assert.equal((await call('/api/houses/'+id,'GET',undefined,player)).status,403);
  const publicResponse=await call('/api/houses/public/'+publicId,'GET',undefined,null);assert.equal(publicResponse.status,200);assert.equal((await publicResponse.json()).teams.length,2);
  assert.equal((await call('/api/houses/public/'+publicId+'/join','POST',{room_id:a.room_id,password:'wrong'},null)).status,401);
  assert.equal((await call('/api/houses/public/'+publicId+'/join','POST',{room_id:a.room_id,password:'секрет123'},null)).status,200);
  for(const [path,method]of [[a.room_id+'/start','POST'],[a.room_id+'/pause','POST'],[a.room_id+'/resume','POST'],[a.room_id+'/stop','POST'],[a.room_id+'/invite','POST'],[a.room_id+'/users','POST'],['users/'+ua.id,'DELETE'],[String(a.room_id),'DELETE']]){
    assert.equal((await call('/api/rooms/'+path,method,{})).status,409,path);
  }
  assert.equal(legacyMutations,0);
  assert.equal((await call('/api/houses/'+id+'/control','POST',f.body({revision:await f.revision(id),action:'start'}),staff,{Origin:'https://elsewhere.invalid'})).status,403);
  await f.control(id,'start');assert.equal((await call('/game','GET',undefined,player)).status,200);
  await f.control(id,'finish',{confirmed:true});assert.equal((await call('/game','GET',undefined,player)).status,403);
  assert.equal((await call('/result','GET',undefined,player)).status,200);assert.equal((await call('/result','GET',undefined,forged)).status,403);
  const returned=await call('/api/houses/public/'+publicId+'/join','POST',{room_id:a.room_id,password:'секрет123'},null);assert.equal((await returned.json()).finished,true);
  let response;for(let i=0;i<16;i++)response=await call('/api/houses/public/'+publicId+'/join','POST',{room_id:b.room_id,password:'wrong'},null);
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');
});
