const test=require('node:test');
const assert=require('node:assert/strict');
const sqlite3=require('../backend/node_modules/sqlite3');
const bcrypt=require('../backend/node_modules/bcryptjs');
const {randomUUID}=require('node:crypto');
const {createPlayerCabinet}=require('../backend/services/playerCabinet');
async function fixture(t,localMode=true){
 const db=new sqlite3.Database(':memory:');
 const query=(sql,values=[])=>new Promise((resolve,reject)=>db.all(sql,values,(error,rows)=>error?reject(error):resolve({rows})));
 let queue=Promise.resolve();
 const transaction=work=>{const result=queue.then(async()=>{await query('BEGIN IMMEDIATE');try{const value=await work(query);await query('COMMIT');return value;}catch(e){await query('ROLLBACK');throw e;}});queue=result.catch(()=>{});return result;};
 for(const sql of [
 `CREATE TABLE scenarios (id INTEGER PRIMARY KEY,name TEXT,created_by INTEGER)`,
 `CREATE TABLE rooms (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,scenario_id INTEGER,created_by INTEGER,duration_seconds INTEGER,is_test BOOLEAN,state TEXT,game_start_time TEXT,game_end_time TEXT,halfway_paused BOOLEAN,paused_at TEXT)`,
 `CREATE TABLE room_users (id INTEGER PRIMARY KEY AUTOINCREMENT,room_id INTEGER,username TEXT,password TEXT,UNIQUE(room_id,username))`,
 `CREATE TABLE visit_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,room_id INTEGER,scenario_id INTEGER,found BOOLEAN)`,
 `CREATE TABLE questions (id INTEGER PRIMARY KEY,scenario_id INTEGER,question_text TEXT,question_order INTEGER,is_active BOOLEAN)`,
 `CREATE TABLE question_answers (id INTEGER PRIMARY KEY AUTOINCREMENT,question_id INTEGER,room_user_id INTEGER,answer_text TEXT)`])await query(sql);
 const roomSync=async id=>{let room=(await query('SELECT * FROM rooms WHERE id=$1',[id])).rows[0];if(room?.state==='running'&&new Date(room.game_end_time)<=new Date()){await query("UPDATE rooms SET state='finished' WHERE id=$1",[id]);room={...room,state:'finished'};}return room;};
 const remainingSeconds=room=>room.state==='finished'?0:Math.max(0,Math.ceil((new Date(room.game_end_time)-new Date(room.state==='paused'?room.paused_at:Date.now()))/1000));
 const findTeams=async(name,password)=>{const teams=(await query('SELECT u.* FROM room_users u JOIN rooms r ON r.id=u.room_id WHERE u.username=$1 AND r.is_test=FALSE',[name])).rows;const matched=[];for(const team of teams)if(await bcrypt.compare(password,team.password))matched.push(team);return matched;};
 const store=createPlayerCabinet({query,transaction,localMode,roomSync,remainingSeconds,findTeams});await store.init();
 await query("INSERT INTO scenarios VALUES (1,'Demo',1),(2,'Paid',1)");await query("INSERT INTO questions VALUES (1,1,'Who?',1,TRUE),(2,2,'Why?',1,TRUE)");
 const seed=(id,scenario,price,rubric)=>query(`INSERT INTO player_products (id,scenario_id,title,description,cover,price,duration_seconds,difficulty,max_attempts,rubric,solution) VALUES ($1,$2,$1,'Description','/cover.webp',$3,7200,1,3,$4,'Solution')`,[id,scenario,price,rubric]);
 await seed('demo',1,0,JSON.stringify([{question_id:1,answers:['Анна Лебедева']}]));await seed('paid',2,2000,null);
 t.after(()=>new Promise(resolve=>db.close(resolve)));
 const registration=(email='detective@example.test')=>({username:'Детектив',email,password:'secret-password',confirm_password:'secret-password',accept_terms:true});
 const account=await store.register(registration());
 const start=(extra={})=>store.start(account.account.id,{product_id:'demo',team_name:'Команда',team_password:'team-secret',request_key:randomUUID(),...extra});
 const begin=async extra=>{const run=await start(extra);await store.control(account.account.id,run.id,'start');await query('INSERT INTO visit_attempts (user_id,room_id,scenario_id,found) VALUES ($1,$2,$3,TRUE)',[run.room_user_id,run.room_id,run.product_id==='demo'?1:2]);return run;};
 const finish=async run=>{await store.shared.submitAnswers({id:run.room_user_id,room_id:run.room_id},{answers:[{question_id:run.product_id==='demo'?1:2,text:'An answer',revision:0}]});return store.control(account.account.id,run.id,'finish',{confirmed:true});};
 return {query,store,account,registration,start,begin,finish,roomSync};
}
const rejected=(promise,status)=>assert.rejects(promise,error=>error.status===status);
test('registration validates agreement, confirmation, Unicode password length and unique normalized email',async t=>{const f=await fixture(t);await rejected(f.store.register({...f.registration('other@test.ru'),accept_terms:false}),400);await rejected(f.store.register({...f.registration('other@test.ru'),confirm_password:'different'}),400);await rejected(f.store.register({...f.registration('other@test.ru'),password:'я'.repeat(40),confirm_password:'я'.repeat(40)}),400);await rejected(f.store.register(f.registration('DETECTIVE@EXAMPLE.TEST')),409);const row=(await f.query('SELECT * FROM player_accounts')).rows[0];assert.notEqual(row.password_hash,'secret-password');assert.equal(f.account.account.password_hash,undefined);assert.equal((await f.store.authenticate(f.account.token)).email,'detective@example.test');});
test('login, logout and expiration enforce sessions',async t=>{const f=await fixture(t);await rejected(f.store.login({email:'detective@example.test',password:'wrong'}),401);const login=await f.store.login({email:' DETECTIVE@EXAMPLE.TEST ',password:'secret-password'});assert.equal((await f.store.authenticate(login.token)).id,f.account.account.id);await f.store.logout(login.token);await rejected(f.store.authenticate(login.token),401);await f.query("UPDATE player_login_sessions SET expires_at='2000-01-01'");await rejected(f.store.authenticate(f.account.token),401);});
test('password change requires current password and revokes old sessions',async t=>{const f=await fixture(t);await rejected(f.store.updateAccount(f.account.account.id,{username:'Новое имя',email:'new@test.ru',current_password:'wrong'}),400);const updated=await f.store.updateAccount(f.account.account.id,{username:'Новое имя',email:'new@test.ru',current_password:'secret-password',new_password:'next-password',confirm_password:'next-password'});await rejected(f.store.authenticate(f.account.token),401);assert.equal((await f.store.authenticate(updated.token)).email,'new@test.ru');await rejected(f.store.login({email:'new@test.ru',password:'secret-password'}),401);});
test('recovery links are expiring, single-use and revoke sessions',async t=>{const f=await fixture(t);const reset=await f.store.requestReset({email:'detective@example.test'});const body={token:reset.reset_url.split('#')[1],password:'new-password',confirm_password:'new-password'};await f.store.resetPassword(body);await rejected(f.store.resetPassword(body),400);await rejected(f.store.authenticate(f.account.token),401);const expired=await f.store.requestReset({email:'detective@example.test'});await f.query("UPDATE player_password_resets SET expires_at='2000-01-01'");await rejected(f.store.resetPassword({...body,token:expired.reset_url.split('#')[1]}),400);});
test('client flags cannot enable payments or recovery outside local mode',async t=>{const f=await fixture(t,false);await rejected(f.store.purchase(f.account.account.id,{confirm_local:true,product_id:'paid',request_key:randomUUID()}),503);await rejected(f.store.requestReset({email:'detective@example.test'}),503);});
test('catalog hides answer keys and checks ownership before creating a paid game',async t=>{const f=await fixture(t);const products=await f.store.catalog(f.account.account.id);assert.equal(products[0].owned,true);assert.equal(products[1].owned,false);assert.equal(products[0].rubric,undefined);assert.equal(products[0].solution,undefined);await rejected(f.start({product_id:'paid'}),403);});
test('checkout uses server price, is idempotent and rejects already owned cases',async t=>{const f=await fixture(t);const body={product_id:'paid',amount:1,confirm_local:true,request_key:randomUUID()};const [a,b]=await Promise.all([f.store.purchase(f.account.account.id,body),f.store.purchase(f.account.account.id,body)]);assert.equal(a.id,b.id);assert.equal(a.amount,2000);assert.equal((await f.query('SELECT * FROM player_orders')).rows.length,1);await rejected(f.store.purchase(f.account.account.id,{...body,request_key:randomUUID()}),409);assert.equal((await f.store.catalog(f.account.account.id))[1].owned,true);});
test('bundle uses server price and grants every included case',async t=>{const f=await fixture(t);const order=await f.store.purchase(f.account.account.id,{bundle_id:'starter',confirm_local:true,request_key:randomUUID()});assert.equal(order.amount,1800);assert.equal((await f.query('SELECT * FROM player_entitlements')).rows.length,2);});
test('concurrent creation with same request key consumes just one attempt',async t=>{const f=await fixture(t);const key=randomUUID();const [a,b]=await Promise.all([f.start({request_key:key}),f.start({request_key:key})]);assert.equal(a.id,b.id);assert.equal((await f.query('SELECT * FROM rooms')).rows.length,1);await rejected(f.start({team_password:'other-password'}),409);assert.equal((await f.store.catalog(f.account.account.id))[0].attempts_used,0);});
test('pause preserves time and continuing does not consume another attempt',async t=>{const f=await fixture(t);const run=await f.begin();await f.store.control(f.account.account.id,run.id,'pause');const before=await f.roomSync(run.room_id);await f.query('UPDATE rooms SET paused_at=$1 WHERE id=$2',[new Date(Date.now()-600000).toISOString(),run.room_id]);await f.store.control(f.account.account.id,run.id,'resume');const after=await f.roomSync(run.room_id);assert.ok(new Date(after.game_end_time)>new Date(before.game_end_time));assert.equal((await f.store.catalog(f.account.account.id))[0].attempts_used,0);});
test('unrelated account cannot enter, control or read a private game',async t=>{const f=await fixture(t);const run=await f.start();const other=await f.store.register(f.registration('second@test.ru'));await rejected(f.store.enter(other.account.id,run.id),404);await rejected(f.store.control(other.account.id,run.id,'finish'),404);await rejected(f.store.result(other.account.id,run.id),404);});
test('invite joins without an account and never grants creator controls',async t=>{const f=await fixture(t);const run=await f.begin();const identity=await f.store.enter(f.account.account.id,run.id);const token=identity.shared_access.invite_path.split('#')[1];const joined=await f.store.shared.join(token);assert.equal(joined.user.id,run.room_user_id);assert.equal(joined.shared_access.is_owner,false);assert.equal(joined.shared_access.run_id,null);await rejected(f.store.shared.join('invalid'),404);const profile=await f.store.profile(f.account.account.id);assert.equal(profile.products[0].attempts_used,0);});
test('demo grading uses stored answers and finish never changes a finalized score',async t=>{const f=await fixture(t);const run=await f.begin();await rejected(f.store.result(f.account.account.id,run.id),409);await f.store.shared.submitAnswers({id:run.room_user_id,room_id:run.room_id},{answers:[{question_id:1,text:'Анна, Лебедева!',revision:0}]});await f.store.control(f.account.account.id,run.id,'finish',{confirmed:true});const result=await f.store.result(f.account.account.id,run.id);assert.equal(result.run.score,2000);assert.equal(result.solution,'Solution');await f.store.control(f.account.account.id,run.id,'finish',{confirmed:true});const profile=await f.store.profile(f.account.account.id);assert.equal(profile.stats.played,1);assert.equal(profile.stats.rating,0);await rejected(f.store.control(f.account.account.id,run.id,'resume'),409);});
test('server enforces three attempts after separate completed games',async t=>{const f=await fixture(t);for(let i=0;i<3;i++){const run=await f.begin({team_password:'team-secret-'+i});assert.equal(run.attempt_number,i+1);await f.finish(run);}await rejected(f.begin({team_password:'fourth-password'}),409);assert.equal((await f.store.catalog(f.account.account.id))[0].attempts_left,0);});
test('expired timer finalizes history and preserves its result on later reads',async t=>{const f=await fixture(t);const run=await f.begin();await f.query("UPDATE rooms SET game_end_time='2000-01-01' WHERE id=$1",[run.room_id]);const history=await f.store.history(f.account.account.id);assert.equal(history[0].state,'finished');assert.equal(history[0].score,0);assert.equal(history[0].elapsed_seconds,7200);assert.equal((await f.store.history(f.account.account.id))[0].score,0);});
test('overall rating uses the first paid completion even when a replay scores higher',async t=>{const f=await fixture(t);await f.store.purchase(f.account.account.id,{product_id:'paid',confirm_local:true,request_key:randomUUID()});for(const [i,score]of [800,1200].entries()){const run=await f.begin({product_id:'paid',team_password:'paid-password-'+i});await f.finish(run);assert.equal((await f.store.result(f.account.account.id,run.id)).run.result_status,'pending_review');await f.query("UPDATE player_runs SET score=$1,result_status='graded' WHERE id=$2",[score,run.id]);}const profile=await f.store.profile(f.account.account.id);assert.equal(profile.stats.rating,800);assert.equal(profile.stats.rank,1);});

function answerController(room) {
 const module={exports:{}};const requests=[],created=[];
 const dependencies={
  '../models/question':{getByScenario:async id=>{requests.push(id);return id===12?[{id:7}]:[];}},
  '../models/questionAnswer':{getByQuestionAndUser:async()=>null,create:async answer=>{created.push(answer);return answer;}},
  '../services/roomTimer':{syncRoomTimer:async()=>room}
 };
 require('node:vm').runInNewContext(require('node:fs').readFileSync('backend/controllers/questionController.js','utf8'),{module,console,require:name=>{if(!dependencies[name])throw new Error('Unexpected dependency '+name);return dependencies[name];}});
 return {controller:module.exports.createAnswer,requests,created};
}
async function submitAnswer(f,questionId=7){const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};await f.controller({body:{question_id:questionId,answer_text:'An answer'},roomUser:{id:4,room_id:20,scenario_id:999}},res);return res;}
test('answer scope follows current room scenario, including a switched test scenario',async()=>{const f=answerController({scenario_id:12,state:'running',is_test:true});const res=await submitAnswer(f);assert.equal(res.statusCode,201);assert.equal(f.requests[0],12);assert.equal(f.created[0].room_user_id,4);});
test('cross-scenario answers never get stored',async()=>{const f=answerController({scenario_id:12,state:'running',is_test:false});assert.equal((await submitAnswer(f,8)).statusCode,403);assert.equal(f.created.length,0);});
test('paused, pending, ended and missing rooms reject answer writes',async()=>{for(const room of [null,...['paused','pending','finished'].map(state=>({scenario_id:12,state,is_test:false}))]){const f=answerController(room);assert.equal((await submitAnswer(f)).statusCode,403);assert.equal(f.created.length,0);}});

test('an expired run cannot block starting the next attempt from a stale profile',async t=>{const f=await fixture(t);const old=await f.begin();await f.query("UPDATE rooms SET game_end_time='2000-01-01' WHERE id=$1",[old.room_id]);const next=await f.start({team_password:'next-team-password'});assert.equal(next.attempt_number,2);assert.notEqual(next.room_id,old.room_id);});

test('production catalog publishes only the existing advertised case and never creates the local demo',async()=>{
 const calls=[];const module={exports:{}};
 const query=async(sql,values=[])=>{calls.push({sql,values});if(sql.startsWith('SELECT id,name'))return {rows:[{id:7,name:'Ставка на молчание',created_by:1},{id:9,name:'Неопубликованный черновик',created_by:1}]};return {rows:[]};};
 require('node:vm').runInNewContext(require('node:fs').readFileSync('backend/services/playerCatalogSeed.js','utf8'),{module,process:{env:{NODE_ENV:'production',PLAYER_LOCAL_MODE:'1'}},require:name=>{if(name==='../config/database')return {query};if(['../models/scenario','../models/address','../models/question'].includes(name))return {};throw new Error('Unexpected dependency '+name);}});
 await module.exports.seedCatalog();const inserts=calls.filter(c=>c.sql.startsWith('INSERT'));assert.equal(inserts.length,1);assert.equal(inserts[0].values[0],'silence');assert.equal(inserts[0].values[1],7);assert.match(inserts[0].sql,/ON CONFLICT\(id\) DO NOTHING/);assert.equal(calls.some(c=>c.sql.includes('FROM users')),false);
});

test('creation opens a lobby without a timer or a consumed attempt',async t=>{const f=await fixture(t);const run=await f.start();const room=await f.roomSync(run.room_id);assert.equal(room.state,'pending');assert.equal(room.game_end_time,null);assert.equal(room.duration_seconds,7200);assert.equal((await f.store.catalog(f.account.account.id))[0].attempts_left,3);await rejected(f.store.control(f.account.account.id,run.id,'finish',{confirmed:true}),409);});
test('early finish requires shared answer submission and explicit confirmation',async t=>{const f=await fixture(t);const run=await f.begin();await rejected(f.store.control(f.account.account.id,run.id,'finish',{confirmed:true}),409);await f.store.shared.submitAnswers({id:run.room_user_id,room_id:run.room_id},{answers:[{question_id:1,text:'Анна Лебедева',revision:0}]});await rejected(f.store.control(f.account.account.id,run.id,'finish'),400);await f.store.control(f.account.account.id,run.id,'finish',{confirmed:true});await Promise.all([f.store.control(f.account.account.id,run.id,'finish',{confirmed:true}),f.store.control(f.account.account.id,run.id,'finish',{confirmed:true})]);assert.equal((await f.store.catalog(f.account.account.id))[0].attempts_used,1);});
test('guests share canonical progress and edits reject stale revisions',async t=>{const f=await fixture(t);const run=await f.begin();const identity={id:run.room_user_id,room_id:run.room_id};await f.store.shared.saveNotes(identity,{text:'Общая улика',revision:0});await rejected(f.store.shared.saveNotes(identity,{text:'Stale',revision:0}),409);assert.equal((await f.store.shared.snapshot(identity)).notes,'Общая улика');await f.store.shared.saveDraft(identity,{question_id:1,text:'Анна Лебедева',revision:0});await rejected(f.store.shared.saveDraft(identity,{question_id:1,text:'Other',revision:0}),409);await rejected(f.store.shared.saveDraft(identity,{question_id:2,text:'Other',revision:0}),403);await rejected(f.store.shared.snapshot({id:run.room_user_id+100,room_id:run.room_id}),403);assert.equal((await f.store.shared.snapshot(identity)).questions[0].answer_text,'Анна Лебедева');});
test('answer batch is atomic and submitted answers cannot be edited later',async t=>{const f=await fixture(t);const run=await f.begin();const identity={id:run.room_user_id,room_id:run.room_id};await f.store.shared.saveDraft(identity,{question_id:1,text:'Draft',revision:0});await rejected(f.store.shared.submitAnswers(identity,{answers:[{question_id:1,text:'Stale',revision:0}]}),409);assert.equal((await f.query('SELECT * FROM question_answers')).rows.length,0);await f.store.shared.submitAnswers(identity,{answers:[{question_id:1,text:'Final',revision:1}]});await rejected(f.store.shared.saveDraft(identity,{question_id:1,text:'Changed',revision:1}),409);await f.store.shared.submitAnswers(identity,{answers:[{question_id:1,text:'Repeated',revision:1}]});assert.equal((await f.query('SELECT * FROM question_answers')).rows[0].answer_text,'Final');});
test('pending and paused rooms never consume attempts; an expired room consumes exactly once',async t=>{const f=await fixture(t);const run=await f.begin();await f.store.control(f.account.account.id,run.id,'pause');await f.query("UPDATE rooms SET game_end_time='2000-01-01',paused_at='1999-12-31T23:00:00.000Z' WHERE id=$1",[run.room_id]);assert.equal((await f.store.catalog(f.account.account.id))[0].attempts_used,0);await f.store.control(f.account.account.id,run.id,'resume');await f.query("UPDATE rooms SET game_end_time='2000-01-01' WHERE id=$1",[run.room_id]);await Promise.all([f.store.catalog(f.account.account.id),f.store.catalog(f.account.account.id)]);assert.equal((await f.query('SELECT * FROM player_attempts')).rows.length,1);assert.equal((await f.store.catalog(f.account.account.id))[0].attempts_used,1);});

const chief={id:1,username:'Главный',is_admin:true,admin_level:'super_admin'};
const organizer={id:1,username:'Организатор',is_admin:true,admin_level:'admin'};
const outsider={id:99,username:'Чужой',is_admin:true,admin_level:'admin'};
const adminBody=extra=>({request_key:randomUUID(),reason:'Проверка управления',...extra});
test('admin player search is scoped and never exposes password hashes or session tokens',async t=>{
 const f=await fixture(t);const run=await f.start();
 const list=await f.store.admin.players(chief,{q:'DETECTIVE@EXAMPLE'});assert.equal(list.total,1);assert.equal(list.items[0].id,f.account.account.id);
 const card=await f.store.admin.player(organizer,f.account.account.id);assert.equal(card.account.password_hash,undefined);assert.equal(card.games[0].id,run.room_id);assert.equal(card.products.length,2);
 assert.equal((await f.store.admin.players(outsider)).total,0);await rejected(f.store.admin.player(outsider,f.account.account.id),404);
 await rejected(f.store.admin.players({id:1,is_admin:false}),403);
});
test('manual access is audited and idempotent without fabricating a paid order',async t=>{
 const f=await fixture(t);const body=adminBody({action:'grant_access',product_id:'paid'});
 await rejected(f.store.admin.grant(organizer,f.account.account.id,body),403);
 const [a,b]=await Promise.all([f.store.admin.grant(chief,f.account.account.id,body),f.store.admin.grant(chief,f.account.account.id,body)]);assert.deepEqual(a,b);
 assert.equal((await f.store.catalog(f.account.account.id)).find(p=>p.id==='paid').owned,true);
 assert.equal((await f.query('SELECT * FROM player_orders')).rows.length,0);assert.equal((await f.store.admin.journal(chief)).length,1);
 await rejected(f.store.admin.grant(chief,f.account.account.id,{...body,reason:'Другая причина'}),409);
 await rejected(f.store.admin.grant(chief,f.account.account.id,adminBody({action:'grant_access',product_id:'paid'})),409);
});
test('added attempts survive reload, preserve completed history and work in player and admin starts',async t=>{
 const f=await fixture(t);for(let i=0;i<3;i++){const run=await f.begin();await f.finish(run);}
 await rejected(f.start(),409);
 const body=adminBody({action:'add_attempts',product_id:'demo',amount:2});await f.store.admin.grant(chief,f.account.account.id,body);await f.store.admin.grant(chief,f.account.account.id,body);
 const product=(await f.store.catalog(f.account.account.id)).find(p=>p.id==='demo');assert.equal(product.attempts_used,3);assert.equal(product.attempts_left,2);assert.equal(product.max_attempts,5);
 assert.equal((await f.query('SELECT * FROM player_attempts')).rows.length,3);
 const fourth=await f.start();await f.store.control(f.account.account.id,fourth.id,'start');await f.finish(fourth);
 const fifth=await f.start();await f.store.admin.control(chief,fifth.room_id,adminBody({action:'start'}));assert.equal((await f.roomSync(fifth.room_id)).state,'running');
 assert.equal((await f.store.admin.player(chief,f.account.account.id)).products.find(p=>p.id==='demo').attempts_left,1);
 await rejected(f.store.admin.grant(chief,f.account.account.id,adminBody({action:'add_attempts',product_id:'paid',amount:1})),409);
});
test('admin timer controls preserve paused time, are idempotent and record every accepted action',async t=>{
 const f=await fixture(t);const run=await f.start();
 const listing=await f.store.admin.rooms(organizer,{q:'Команда',state:'pending'});assert.equal(listing.items.length,1);assert.equal(listing.items[0].owner_id,f.account.account.id);
 await f.store.admin.control(organizer,run.room_id,adminBody({action:'start'}));await f.store.admin.control(organizer,run.room_id,adminBody({action:'pause'}));
 const before=await f.roomSync(run.room_id);const remaining=f.store.admin.room(organizer,run.room_id);assert.equal((await remaining).room.state,'paused');
 const body=adminBody({action:'add_time',minutes:15});await f.store.admin.control(organizer,run.room_id,body);await f.store.admin.control(organizer,run.room_id,body);
 const after=await f.roomSync(run.room_id);assert.equal(after.duration_seconds,before.duration_seconds+900);assert.equal(new Date(after.game_end_time)-new Date(before.game_end_time),900000);assert.equal(after.paused_at,before.paused_at);
 await f.store.admin.control(organizer,run.room_id,adminBody({action:'resume'}));assert.equal((await f.store.catalog(f.account.account.id))[0].attempts_used,0);
 assert.equal((await f.store.admin.journal(organizer,{room_id:run.room_id})).length,4);
});
test('admin can force confirmed finish without answers, consuming one attempt and preventing restart',async t=>{
 const f=await fixture(t);const run=await f.begin();const body=adminBody({action:'finish',confirmed:true});
 await rejected(f.store.admin.control(chief,run.room_id,{...body,confirmed:false}),400);
 await f.store.admin.control(chief,run.room_id,body);await f.store.admin.control(chief,run.room_id,body);
 assert.equal((await f.store.catalog(f.account.account.id))[0].attempts_used,1);assert.equal((await f.store.admin.room(chief,run.room_id)).run.score,0);
 await rejected(f.store.admin.control(chief,run.room_id,adminBody({action:'start'})),409);await rejected(f.store.admin.control(chief,run.room_id,adminBody({action:'add_time',minutes:10})),409);
 assert.equal((await f.store.admin.journal(chief,{room_id:run.room_id})).length,1);
});
test('organizers cannot inspect, invite or mutate another organizer room, answers or journal',async t=>{
 const f=await fixture(t);const run=await f.begin();await f.store.shared.saveDraft({id:run.room_user_id,room_id:run.room_id},{question_id:1,text:'Private answer',revision:0});
 await f.store.admin.control(chief,run.room_id,adminBody({action:'pause'}));
 assert.equal((await f.store.admin.rooms(outsider)).total,0);await rejected(f.store.admin.room(outsider,run.room_id),404);
 await rejected(f.store.admin.control(outsider,run.room_id,adminBody({action:'resume'})),404);assert.equal((await f.store.admin.journal(outsider)).length,0);
 assert.equal((await f.store.admin.room(organizer,run.room_id)).questions[0].answer_text,'Private answer');
});
test('admin rejects invalid values and never records a failed grant or timer action',async t=>{
 const f=await fixture(t);const run=await f.start();
 for(const amount of [0,-1,11,1.5,'1'])await rejected(f.store.admin.grant(chief,f.account.account.id,adminBody({action:'add_attempts',product_id:'demo',amount})),400);
 await rejected(f.store.admin.grant(chief,f.account.account.id,adminBody({action:'add_attempts',product_id:'demo',amount:1,reason:''})),400);
 await rejected(f.store.admin.control(chief,run.room_id,adminBody({action:'finish',confirmed:true})),409);
 await rejected(f.store.admin.control(chief,run.room_id,adminBody({action:'add_time',minutes:0})),400);
 assert.equal((await f.store.admin.journal(chief)).length,0);assert.equal((await f.query('SELECT * FROM player_attempt_credits')).rows.length,0);
});
test('admin room filters settle expired timers and finish attempts exactly once',async t=>{
 const f=await fixture(t);const run=await f.begin();await f.query("UPDATE rooms SET game_end_time='2000-01-01' WHERE id=$1",[run.room_id]);
 assert.equal((await f.store.admin.rooms(chief,{state:'running'})).total,0);assert.equal((await f.store.admin.rooms(chief,{state:'finished'})).total,1);
 assert.equal((await f.query('SELECT * FROM player_attempts')).rows.length,1);
});

test('finished shared rooms reject owner entry, invitation, guest identity and old-session snapshots after either finisher',async t=>{
 for(const finisher of ['player','admin']){
  const f=await fixture(t);const run=await f.begin();const before=await f.store.enter(f.account.account.id,run.id);const token=before.shared_access.invite_path.split('#')[1];
  if(finisher==='player')await f.finish(run);else await f.store.admin.control(chief,run.room_id,adminBody({action:'finish',confirmed:true}));
  for(const operation of [()=>f.store.enter(f.account.account.id,run.id),()=>f.store.shared.join(token),()=>f.store.shared.identity(run.room_id,{id:f.account.account.id}),()=>f.store.shared.snapshot({id:run.room_user_id,room_id:run.room_id}),()=>f.store.shared.saveNotes({id:run.room_user_id,room_id:run.room_id},{text:'late',revision:0})])await rejected(operation(),403);
  await rejected(f.store.shared.adminInvite(run.room_id,chief),409);assert.equal((await f.store.history(f.account.account.id))[0].invite_path,undefined);
  assert.equal((await f.store.result(f.account.account.id,run.id)).run.state,'finished');assert.equal((await f.store.admin.room(chief,run.room_id)).invite_path,null);
 }
});
test('an expired room is closed before invitation or account entry can mint another JWT',async t=>{
 const f=await fixture(t);const run=await f.begin();const identity=await f.store.enter(f.account.account.id,run.id);await f.query("UPDATE rooms SET game_end_time='2000-01-01' WHERE id=$1",[run.room_id]);
 await rejected(f.store.shared.join(identity.shared_access.invite_path.split('#')[1]),403);await rejected(f.store.enter(f.account.account.id,run.id),403);assert.equal((await f.query('SELECT * FROM player_attempts')).rows.length,1);
});

const scoringBody=extra=>({revision:0,reason:'Проверка формулы',request_key:randomUUID(),...extra});
const paidStart=async f=>{await f.store.admin.grant(chief,f.account.account.id,adminBody({action:'grant_access',product_id:'paid'}));return f.begin({product_id:'paid'});};
test('scoring settings, criteria and questions are frozen at room creation',async t=>{
 const f=await fixture(t);const body=scoringBody({max_fee:3000,standard_trips:10,criteria:[{question_id:2,text:'Первоначальный критерий'}]});await f.store.scoring.saveSettings(chief,2,body);await f.store.scoring.saveSettings(chief,2,body);
 const run=await paidStart(f);await f.store.scoring.saveSettings(chief,2,scoringBody({revision:1,max_fee:5000,standard_trips:30,criteria:[{question_id:2,text:'Новый критерий'}]}));await f.query("UPDATE questions SET question_text='Изменённый вопрос',is_active=FALSE WHERE id=2");
 const conditions=await f.store.scoring.publicSummary(run.room_id);assert.equal(conditions.max_fee,3000);assert.equal(conditions.standard_trips,10);assert.equal((await f.store.shared.snapshot({id:run.room_user_id,room_id:run.room_id})).questions[0].question_text,'Why?');assert.equal(await f.store.scoring.questionInOpenRoom(2),true);
 await f.finish(run);const review=await f.store.scoring.review(chief,run.room_id);assert.equal(review.questions[0].criteria,'Первоначальный критерий');assert.equal(review.questions[0].question_text,'Why?');assert.equal(await f.store.scoring.questionInOpenRoom(2),false);
});
test('draft review stays private; incomplete publication rolls back and complete publication is idempotent',async t=>{
 const f=await fixture(t);await f.query("INSERT INTO questions VALUES (3,2,'Second?',2,TRUE)");const run=await paidStart(f);
 await f.store.shared.submitAnswers({id:run.room_user_id,room_id:run.room_id},{answers:[{question_id:2,text:'First answer',revision:0},{question_id:3,text:'Second answer',revision:0}]});await f.store.control(f.account.account.id,run.id,'finish',{confirmed:true});
 await f.store.scoring.saveReview(chief,run.room_id,scoringBody({publish:false,grades:[{question_id:2,grade:3,comment:'Черновая оценка'}]}));const draft=await f.store.result(f.account.account.id,run.id);assert.equal(draft.scoring.fee,null);assert.equal(draft.scoring.points,null);assert.deepEqual(draft.scoring.grades,[]);
 await rejected(f.store.scoring.saveReview(chief,run.room_id,scoringBody({revision:1,publish:true,grades:[{question_id:2,grade:4,comment:'Changed'}]})),400);assert.equal((await f.store.scoring.review(chief,run.room_id)).questions[0].grade,3);
 const publish=scoringBody({revision:1,publish:true,grades:[{question_id:2,grade:4,comment:'Хорошо'},{question_id:3,grade:5,comment:'Полный ответ'}]});const a=await f.store.scoring.saveReview(chief,run.room_id,publish),b=await f.store.scoring.saveReview(chief,run.room_id,publish);assert.deepEqual(a,b);assert.equal(a.calculation.fee,1620);
 const result=await f.store.result(f.account.account.id,run.id);assert.equal(result.run.score,1620);assert.equal(result.scoring.points,9);assert.equal(result.scoring.grades[1].comment,'Полный ответ');assert.equal((await f.store.scoring.review(chief,run.room_id)).revision,2);
 await f.store.scoring.saveReview(chief,run.room_id,scoringBody({revision:2,publish:false,grades:[{question_id:2,grade:0,comment:'Новая черновая оценка'}]}));assert.equal((await f.store.result(f.account.account.id,run.id)).scoring.fee,1620);assert.equal((await f.store.result(f.account.account.id,run.id)).scoring.grades[0].grade,4);await f.query('DELETE FROM question_answers WHERE room_user_id=$1',[run.room_user_id]);assert.equal((await f.store.scoring.review(chief,run.room_id)).questions[0].answer_text,'First answer');assert.equal((await f.store.result(f.account.account.id,run.id)).scoring.grades[0].answer_text,'First answer');
});
test('fee counts accepted successful, unsuccessful and repeated team trips and freezes the count at finish',async t=>{
 const f=await fixture(t);const run=await paidStart(f);for(let i=0;i<39;i++)await f.query('INSERT INTO visit_attempts (user_id,room_id,scenario_id,found) VALUES ($1,$2,2,$3)',[run.room_user_id,run.room_id,i%2]);await f.query('INSERT INTO visit_attempts (user_id,room_id,scenario_id,found) VALUES ($1,$2,2,TRUE)',[999,run.room_id]);await f.finish(run);
 const pub=scoringBody({publish:true,grades:[{question_id:2,grade:4,comment:''}]});const scored=await f.store.scoring.saveReview(chief,run.room_id,pub);assert.equal(scored.calculation.trips,40);assert.equal(scored.calculation.fee,905);
 await f.query('INSERT INTO visit_attempts (user_id,room_id,scenario_id,found) VALUES ($1,$2,2,TRUE)',[run.room_user_id,run.room_id]);assert.equal((await f.store.scoring.publicSummary(run.room_id)).trips,40);
});
test('missing answers require zero and zero-trip investigations earn zero even with correct answers',async t=>{
 const f=await fixture(t);const run=await paidStart(f);await f.query('DELETE FROM visit_attempts');await f.store.admin.control(chief,run.room_id,adminBody({action:'finish',confirmed:true}));await rejected(f.store.scoring.saveReview(chief,run.room_id,scoringBody({publish:true,grades:[{question_id:2,grade:5,comment:''}]})),400);
 const zero=await f.store.scoring.saveReview(chief,run.room_id,scoringBody({publish:true,grades:[{question_id:2,grade:0,comment:''}]}));assert.equal(zero.calculation.fee,0);
 const f2=await fixture(t);const perfect=await f2.begin();await f2.query('DELETE FROM visit_attempts');await f2.store.shared.submitAnswers({id:perfect.room_user_id,room_id:perfect.room_id},{answers:[{question_id:1,text:'Анна Лебедева',revision:0}]});await f2.store.control(f2.account.account.id,perfect.id,'finish',{confirmed:true});const result=await f2.store.result(f2.account.account.id,perfect.id);assert.equal(result.scoring.points,5);assert.equal(result.scoring.fee,0);
});
test('scoring rejects stale revisions, wrong question grades, fractional grades and unauthorized organizers',async t=>{
 const f=await fixture(t);const run=await paidStart(f);await f.finish(run);const body=scoringBody({publish:true,grades:[{question_id:2,grade:5,comment:''}]});
 await rejected(f.store.scoring.review(outsider,run.room_id),404);await rejected(f.store.scoring.saveReview(outsider,run.room_id,body),404);await rejected(f.store.scoring.settings(outsider,2),404);
 for(const grade of [-1,6,2.5,'5'])await rejected(f.store.scoring.saveReview(chief,run.room_id,{...body,grades:[{question_id:2,grade,comment:''}]}),400);
 await rejected(f.store.scoring.saveReview(chief,run.room_id,{...body,grades:[{question_id:1,grade:5,comment:''}]}),400);await f.store.scoring.saveReview(organizer,run.room_id,body);
 await rejected(f.store.scoring.saveReview(chief,run.room_id,scoringBody({publish:false,grades:[{question_id:2,grade:4,comment:''}]})),409);
});
test('a higher replay fee cannot change first-completion ranking and corrected first grades can',async t=>{
 const f=await fixture(t);await f.store.admin.grant(chief,f.account.account.id,adminBody({action:'grant_access',product_id:'paid'}));let first;
 for(const grade of [3,5]){const run=await f.begin({product_id:'paid'});await f.finish(run);await f.store.scoring.saveReview(chief,run.room_id,scoringBody({publish:true,grades:[{question_id:2,grade,comment:''}]}));if(!first)first=run;}
 assert.equal((await f.store.profile(f.account.account.id)).stats.rating,720);const history=await f.store.history(f.account.account.id);assert.equal(history.find(g=>g.id===first.id).ranked,true);assert.equal(history.find(g=>g.id!==first.id).ranked,false);
 await f.store.scoring.saveReview(chief,first.room_id,scoringBody({revision:1,publish:true,grades:[{question_id:2,grade:4,comment:'Исправление оценки'}]}));assert.equal((await f.store.profile(f.account.account.id)).stats.rating,1280);
});
test('migration preserves already published legacy results instead of regrading old rooms',async t=>{
 const f=await fixture(t);const run=await f.begin();await f.finish(run);await f.query("UPDATE player_runs SET score=1375,result_status='graded' WHERE id=$1",[run.id]);await f.query('DELETE FROM player_answer_grades WHERE room_id=$1',[run.room_id]);await f.query('DELETE FROM player_room_scoring WHERE room_id=$1',[run.room_id]);await f.store.init();
 const result=await f.store.result(f.account.account.id,run.id);assert.equal(result.run.score,1375);assert.equal(result.scoring.fee,1375);assert.equal(result.scoring.legacy,true);
});

test('admin-created shared rooms can be reviewed and paid a fee without a buyer account',async t=>{
 const f=await fixture(t);const room=(await f.query("INSERT INTO rooms (name,scenario_id,created_by,duration_seconds,is_test,state,halfway_paused) VALUES ('Комната организатора',1,1,7200,FALSE,'pending',TRUE) RETURNING id")).rows[0];
 const link=await f.store.shared.provision(f.query,{...room,name:'Комната организатора'},null,1);await f.store.admin.control(chief,room.id,adminBody({action:'start'}));await f.query('INSERT INTO visit_attempts (room_id,user_id,scenario_id,found) VALUES ($1,$2,1,TRUE)',[room.id,link.room_user_id]);
 await f.store.shared.submitAnswers({id:link.room_user_id,room_id:room.id},{answers:[{question_id:1,text:'Ответ организованной команды',revision:0}]});await f.store.admin.control(chief,room.id,adminBody({action:'finish',confirmed:true}));
 assert.ok((await f.store.scoring.reviews(chief)).items.some(r=>r.room_id===room.id));await f.store.scoring.saveReview(chief,room.id,scoringBody({publish:true,grades:[{question_id:1,grade:5,comment:'Полный ответ'}]}));assert.equal((await f.store.admin.room(chief,room.id)).scoring.fee,2000);assert.equal((await f.store.profile(f.account.account.id)).stats.rating,0);
});
test('a room closed before start never consumes the first eligible completion or enters review',async t=>{
 const f=await fixture(t);await f.store.admin.grant(chief,f.account.account.id,adminBody({action:'grant_access',product_id:'paid'}));const cancelled=await f.start({product_id:'paid'});await f.query("UPDATE rooms SET state='finished' WHERE id=$1",[cancelled.room_id]);
 assert.equal((await f.store.result(f.account.account.id,cancelled.id)).cancelled,true);await rejected(f.store.scoring.review(chief,cancelled.room_id),409);
 const first=await f.begin({product_id:'paid'});assert.equal(first.attempt_number,1);await f.finish(first);await f.store.scoring.saveReview(chief,first.room_id,scoringBody({publish:true,grades:[{question_id:2,grade:4,comment:''}]}));
 const profile=await f.store.profile(f.account.account.id);assert.equal(profile.stats.rating,1280);assert.equal(profile.stats.played,1);assert.equal(profile.games.find(g=>g.id===cancelled.id).ranked,false);assert.ok(!(await f.store.scoring.reviews(chief,{status:'all'})).items.some(r=>r.room_id===cancelled.room_id));
});
