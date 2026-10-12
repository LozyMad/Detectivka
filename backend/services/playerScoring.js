'use strict';
const FORMULA_VERSION=1, DEFAULT_MAX_FEE=2000, DEFAULT_STANDARD_TRIPS=20;
const fail=(status,message)=>{const e=new Error(message);e.status=status;throw e;};
const now=()=>new Date().toISOString();
const normalized=value=>String(value||'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function calculateFee({points,max_points,trips,max_fee=DEFAULT_MAX_FEE,standard_trips=DEFAULT_STANDARD_TRIPS}) {
  for(const n of [points,max_points,trips,max_fee,standard_trips])if(!Number.isFinite(n)||!Number.isInteger(n)||n<0)fail(400,'Некорректные параметры расчёта');
  if(max_fee<1||standard_trips<1||points>max_points)fail(400,'Некорректные параметры формулы');
  const quality=max_points>0?points/max_points:0;
  const trip_factor=trips>0?Math.min(1,Math.sqrt(standard_trips/trips)):0;
  const fee=Math.round(max_fee*quality*quality*trip_factor);
  return {points,max_points,trips,max_fee,standard_trips,quality,trip_factor,fee,rating_points:Math.round(2000*quality*quality*trip_factor),formula_version:FORMULA_VERSION};
}
function createPlayerScoring({query:rawQuery,transaction:rawTransaction,roomSync}) {
  const bind=q=>(sql,params=[])=>{const values=[];const mapped=sql.replace(/\$(\d+)/g,(_,n)=>{values.push(params[Number(n)-1]);return '$'+values.length;});return q(mapped,values);};
  const query=bind(rawQuery),transaction=work=>rawTransaction(q=>work(bind(q)));
  const one=async(q,sql,params=[]) => (await q(sql,params)).rows[0];
  const chief=admin=>admin?.is_admin&&admin.admin_level==='super_admin';
  const staff=admin=>{if(!admin?.is_admin)fail(403,'Нужны права организатора');};
  let finalize=async()=>{};
  async function init(){
    for(const sql of [
      `CREATE TABLE IF NOT EXISTS scenario_scoring_settings (scenario_id INTEGER PRIMARY KEY REFERENCES scenarios(id) ON DELETE CASCADE,max_fee INTEGER NOT NULL CHECK(max_fee>0),standard_trips INTEGER NOT NULL CHECK(standard_trips>0),revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS scenario_question_criteria (scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,question_id INTEGER NOT NULL,criteria TEXT NOT NULL DEFAULT '',PRIMARY KEY(scenario_id,question_id))`,
      `CREATE TABLE IF NOT EXISTS player_room_scoring (room_id INTEGER PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,room_user_id INTEGER NOT NULL,scenario_id INTEGER NOT NULL,formula_version INTEGER NOT NULL,max_fee INTEGER NOT NULL,standard_trips INTEGER NOT NULL,max_points INTEGER NOT NULL,settings_revision INTEGER NOT NULL,questions TEXT NOT NULL,trips INTEGER,points INTEGER,fee INTEGER,rating_points INTEGER,review_status TEXT NOT NULL DEFAULT 'pending_review',published_grades TEXT,answers TEXT,revision INTEGER NOT NULL DEFAULT 0,reviewed_by INTEGER,reviewed_at TEXT,created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS player_answer_grades (room_id INTEGER NOT NULL REFERENCES player_room_scoring(room_id) ON DELETE CASCADE,question_id INTEGER NOT NULL,grade INTEGER NOT NULL CHECK(grade>=0 AND grade<=5),comment TEXT NOT NULL DEFAULT '',PRIMARY KEY(room_id,question_id))`
    ])await query(sql);
    for(const definition of ['rating_points INTEGER','answers TEXT']){try{await query('ALTER TABLE player_room_scoring ADD COLUMN '+definition);}catch(e){if(e.code!=='42701'&&!String(e.message).includes('duplicate column'))throw e;}}
    const rooms=(await query(`SELECT r.id FROM rooms r WHERE r.is_test=FALSE AND (EXISTS (SELECT 1 FROM shared_rooms h WHERE h.room_id=r.id) OR EXISTS (SELECT 1 FROM player_runs g WHERE g.room_id=r.id AND g.is_owner=1)) AND NOT EXISTS (SELECT 1 FROM player_room_scoring f WHERE f.room_id=r.id)`)).rows;
    for(const r of rooms)await transaction(async q=>{await capture(q,r.id,null,true);const room=await one(q,'SELECT state,game_start_time FROM rooms WHERE id=$1',[r.id]);if(room.state==='finished'&&room.game_start_time){const grade=await complete(q,r.id);if(grade.result_status==='graded')await q("UPDATE player_runs SET score=$1,result_status='graded' WHERE room_id=$2 AND room_user_id=(SELECT f.room_user_id FROM player_room_scoring f WHERE f.room_id=$2) AND (result_status IS NULL OR result_status='pending_review')",[grade.score,r.id]);}});
    const unarchived=(await query("SELECT f.room_id,f.room_user_id FROM player_room_scoring f JOIN rooms r ON r.id=f.room_id WHERE r.state='finished' AND f.answers IS NULL")).rows;
    for(const f of unarchived)await transaction(async q=>{const answers=(await q('SELECT question_id,answer_text FROM question_answers WHERE room_user_id=$1 ORDER BY id',[f.room_user_id])).rows;await q('UPDATE player_room_scoring SET answers=$1 WHERE room_id=$2 AND answers IS NULL',[JSON.stringify(answers),f.room_id]);});
  }
  async function scenarioAccess(admin,id,q=query){
    staff(admin);if(!Number.isSafeInteger(Number(id))||Number(id)<1)fail(400,'Неверный идентификатор дела');const s=await one(q,'SELECT id,name,created_by FROM scenarios WHERE id=$1',[id]);
    if(!s||(!chief(admin)&&Number(s.created_by)!==Number(admin.id)))fail(404,'Дело не найдено или недоступно');return s;
  }
  async function roomAccess(admin,id,q=query){
    staff(admin);if(!Number.isSafeInteger(Number(id))||Number(id)<1)fail(400,'Неверный идентификатор комнаты');const r=await one(q,'SELECT * FROM rooms WHERE id=$1',[id]);
    if(!r||(!chief(admin)&&Number(r.created_by)!==Number(admin.id)))fail(404,'Комната не найдена или недоступна');return r;
  }
  async function settings(admin,id){
    const s=await scenarioAccess(admin,id);const saved=await one(query,'SELECT * FROM scenario_scoring_settings WHERE scenario_id=$1',[s.id]);
    const questions=(await query('SELECT id,question_text FROM questions WHERE scenario_id=$1 AND is_active=TRUE ORDER BY question_order,id',[s.id])).rows;
    const criteria=(await query('SELECT question_id,criteria FROM scenario_question_criteria WHERE scenario_id=$1',[s.id])).rows;
    return {scenario:s,max_fee:saved?.max_fee||DEFAULT_MAX_FEE,standard_trips:saved?.standard_trips||DEFAULT_STANDARD_TRIPS,revision:saved?.revision||0,formula_version:FORMULA_VERSION,questions:questions.map(q=>({...q,criteria:criteria.find(c=>Number(c.question_id)===Number(q.id))?.criteria||''}))};
  }
  async function settingsList(admin){
    staff(admin);const rows=(await query('SELECT s.id,s.name,s.created_by,f.max_fee,f.standard_trips,f.revision FROM scenarios s LEFT JOIN scenario_scoring_settings f ON f.scenario_id=s.id ORDER BY s.name')).rows;
    return {items:rows.filter(s=>chief(admin)||Number(s.created_by)===Number(admin.id)).map(s=>({...s,max_fee:s.max_fee||DEFAULT_MAX_FEE,standard_trips:s.standard_trips||DEFAULT_STANDARD_TRIPS,revision:s.revision||0}))};
  }
  function mutation(body){
    if(typeof body.request_key!=='string'||!/^[\w-]{16,100}$/.test(body.request_key))fail(400,'Некорректный идентификатор запроса');
    const reason=typeof body.reason==='string'?body.reason.trim():'';if(reason.length<3||reason.length>500)fail(400,'Укажите причину: от 3 до 500 символов');
    if(!Number.isInteger(body.revision)||body.revision<0)fail(400,'Некорректная версия данных');return reason;
  }
  async function audit(q,admin,action,roomId,accountId,body,payload,work){
    const reason=mutation(body),encoded=JSON.stringify(payload);
    const old=await one(q,'SELECT * FROM player_admin_audit WHERE id=$1',[body.request_key]);
    if(old){if(Number(old.admin_id)!==Number(admin.id)||old.action!==action||Number(old.room_id||0)!==Number(roomId||0)||old.payload!==encoded||old.reason!==reason)fail(409,'Идентификатор уже использован для другого действия');return JSON.parse(old.result);}
    const result=await work();await q('INSERT INTO player_admin_audit (id,admin_id,admin_name,action,account_id,room_id,reason,payload,result,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[body.request_key,admin.id,admin.username||String(admin.id),action,accountId||null,roomId||null,reason,encoded,JSON.stringify(result),now()]);return result;
  }
  async function saveSettings(admin,id,body={}){
    await scenarioAccess(admin,id);mutation(body);
    if(!Number.isInteger(body.max_fee)||body.max_fee<1||body.max_fee>1000000)fail(400,'Максимальный гонорар: от 1 до 1000000');
    if(!Number.isInteger(body.standard_trips)||body.standard_trips<1||body.standard_trips>10000)fail(400,'Норматив поездок: от 1 до 10000');
    if(!Array.isArray(body.criteria)||body.criteria.length>500)fail(400,'Укажите критерии вопросов');
    const seen=new Set();for(const c of body.criteria){if(!Number.isSafeInteger(c.question_id)||seen.has(c.question_id)||typeof c.text!=='string'||c.text.length>5000)fail(400,'Некорректные критерии');seen.add(c.question_id);}
    return transaction(async q=>{
      await q('UPDATE scenarios SET name=name WHERE id=$1',[id]);await scenarioAccess(admin,id,q);
      return audit(q,admin,'scoring_settings',null,null,body,{scenario_id:Number(id),max_fee:body.max_fee,standard_trips:body.standard_trips,criteria:body.criteria,revision:body.revision},async()=>{
        const old=await one(q,'SELECT revision FROM scenario_scoring_settings WHERE scenario_id=$1',[id]);if(Number(old?.revision||0)!==body.revision)fail(409,'Настройки изменились. Обновите страницу перед сохранением');
        const active=(await q('SELECT id FROM questions WHERE scenario_id=$1 AND is_active=TRUE',[id])).rows;
        if(body.criteria.length!==active.length||body.criteria.some(c=>!active.some(a=>Number(a.id)===c.question_id)))fail(409,'Состав вопросов изменился. Обновите настройки');
        await q(`INSERT INTO scenario_scoring_settings (scenario_id,max_fee,standard_trips,revision,updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(scenario_id) DO UPDATE SET max_fee=excluded.max_fee,standard_trips=excluded.standard_trips,revision=excluded.revision,updated_at=excluded.updated_at`,[id,body.max_fee,body.standard_trips,body.revision+1,now()]);
        for(const c of body.criteria)await q(`INSERT INTO scenario_question_criteria (scenario_id,question_id,criteria) VALUES ($1,$2,$3) ON CONFLICT(scenario_id,question_id) DO UPDATE SET criteria=excluded.criteria`,[id,c.question_id,c.text.trim()]);
        return {ok:true,revision:body.revision+1};
      });
    });
  }
  async function capture(existingQuery,roomId,productId=null,preserveLegacy=false){
    const q=bind(existingQuery);const old=await one(q,'SELECT * FROM player_room_scoring WHERE room_id=$1',[roomId]);if(old)return old;
    const room=await one(q,'SELECT * FROM rooms WHERE id=$1',[roomId]);if(!room||room.is_test)return null;
    const link=await one(q,'SELECT room_user_id FROM shared_rooms WHERE room_id=$1',[roomId]);
    const owner=await one(q,'SELECT * FROM player_runs WHERE room_id=$1 AND is_owner=1 ORDER BY created_at,id LIMIT 1',[roomId]);
    const userId=link?.room_user_id||owner?.room_user_id;if(!userId)return null;
    await q('UPDATE scenarios SET name=name WHERE id=$1',[room.scenario_id]);
    const saved=await one(q,'SELECT * FROM scenario_scoring_settings WHERE scenario_id=$1',[room.scenario_id]);
    const criteria=(await q('SELECT question_id,criteria FROM scenario_question_criteria WHERE scenario_id=$1',[room.scenario_id])).rows;
    const product=productId||owner?.product_id?await one(q,'SELECT rubric FROM player_products WHERE id=$1',[productId||owner.product_id]):null;
    const rubric=product?.rubric?JSON.parse(product.rubric):[];
    const questions=(await q('SELECT id,question_text FROM questions WHERE scenario_id=$1 AND is_active=TRUE ORDER BY question_order,id',[room.scenario_id])).rows.map(item=>({...item,criteria:criteria.find(c=>Number(c.question_id)===Number(item.id))?.criteria||'',auto_answers:rubric.find(r=>Number(r.question_id)===Number(item.id))?.answers||null}));
    const legacy=preserveLegacy&&room.state==='finished'&&owner?.result_status==='graded';
    const trips=legacy?Number((await one(q,'SELECT COUNT(*) AS n FROM visit_attempts WHERE room_id=$1 AND user_id=$2',[roomId,userId])).n):null;
    await q(`INSERT INTO player_room_scoring (room_id,room_user_id,scenario_id,formula_version,max_fee,standard_trips,max_points,settings_revision,questions,trips,fee,review_status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(room_id) DO NOTHING`,[roomId,userId,room.scenario_id,legacy?0:FORMULA_VERSION,legacy?2000:saved?.max_fee||DEFAULT_MAX_FEE,saved?.standard_trips||DEFAULT_STANDARD_TRIPS,questions.length*5,saved?.revision||0,JSON.stringify(questions),trips,legacy?owner.score:null,legacy?'graded':'pending_review',now()]);
    return one(q,'SELECT * FROM player_room_scoring WHERE room_id=$1',[roomId]);
  }
  async function conditions(roomId){return one(query,'SELECT formula_version,max_fee,standard_trips,max_points FROM player_room_scoring WHERE room_id=$1',[roomId]);}
  async function frozenQuestions(room,q=rawQuery){
    const saved=await one(bind(q),'SELECT questions FROM player_room_scoring WHERE room_id=$1',[room.id]);
    return saved?JSON.parse(saved.questions).map(({id,question_text})=>({id,question_text})):null;
  }
  async function needsFinalize(roomId){
    const r=await one(query,'SELECT r.state,r.game_start_time,f.trips FROM rooms r LEFT JOIN player_room_scoring f ON f.room_id=r.id WHERE r.id=$1',[roomId]);
    return !!r&&r.state==='finished'&&!!r.game_start_time&&r.trips==null;
  }
  async function complete(existingQuery,roomId){
    const q=bind(existingQuery);const saved=await capture(q,roomId);if(!saved)return {score:null,result_status:'pending_review'};
    if(saved.trips!=null)return {score:saved.fee,result_status:saved.review_status};
    const trips=Number((await one(q,'SELECT COUNT(*) AS n FROM visit_attempts WHERE room_id=$1 AND user_id=$2',[roomId,saved.room_user_id])).n);
    const questions=JSON.parse(saved.questions);
    const auto=questions.every(item=>Array.isArray(item.auto_answers));
    const answers=(await q('SELECT question_id,answer_text FROM question_answers WHERE room_user_id=$1 ORDER BY id',[saved.room_user_id])).rows;
    const latest=new Map(answers.map(a=>[Number(a.question_id),a.answer_text]));
    const grades=auto?questions.map(item=>({question_id:Number(item.id),grade:item.auto_answers.map(normalized).includes(normalized(latest.get(Number(item.id))))?5:0,comment:''})):null;
    const points=grades?grades.reduce((s,g)=>s+g.grade,0):null;
    const calculation=grades?calculateFee({points,max_points:Number(saved.max_points),trips,max_fee:Number(saved.max_fee),standard_trips:Number(saved.standard_trips)}):null;
    for(const g of grades||[])await q('INSERT INTO player_answer_grades (room_id,question_id,grade,comment) VALUES ($1,$2,$3,$4) ON CONFLICT(room_id,question_id) DO NOTHING',[roomId,g.question_id,g.grade,g.comment]);
    await q('UPDATE player_room_scoring SET trips=$1,points=$2,fee=$3,review_status=$4,published_grades=$5,rating_points=$6,answers=$7 WHERE room_id=$8',[trips,points,calculation?.fee??null,auto?'graded':'pending_review',grades?JSON.stringify(grades):null,calculation?.rating_points??null,JSON.stringify(answers),roomId]);
    return {score:calculation?.fee??null,result_status:auto?'graded':'pending_review'};
  }
  async function savedAnswers(q,f){return f.answers!=null?JSON.parse(f.answers):(await q('SELECT question_id,answer_text FROM question_answers WHERE room_user_id=$1 ORDER BY id',[f.room_user_id])).rows;}
  async function publicSummary(roomId){
    const f=await one(query,'SELECT * FROM player_room_scoring WHERE room_id=$1',[roomId]);if(!f)return null;
    const qs=JSON.parse(f.questions),published=f.published_grades?JSON.parse(f.published_grades):[];const answerMap=new Map(published.length?(await savedAnswers(query,f)).map(a=>[Number(a.question_id),a.answer_text]):[]);
    const calculation=f.points==null||f.trips==null?null:calculateFee({points:Number(f.points),max_points:Number(f.max_points),trips:Number(f.trips),max_fee:Number(f.max_fee),standard_trips:Number(f.standard_trips)});
    return {formula_version:f.formula_version,legacy:f.formula_version===0,review_status:f.review_status,revision:f.revision,points:f.points,max_points:f.max_points,trips:f.trips,max_fee:f.max_fee,standard_trips:f.standard_trips,fee:f.fee,quality:calculation?.quality??null,trip_factor:calculation?.trip_factor??null,rating_points:f.fee==null?null:(f.rating_points??calculation?.rating_points??Math.round(Number(f.fee)/Number(f.max_fee)*2000)),reviewed_at:f.reviewed_at,grades:published.map(g=>({question_id:g.question_id,question_text:qs.find(q=>Number(q.id)===g.question_id)?.question_text||'Вопрос',grade:g.grade,comment:g.comment,answer_text:answerMap.get(Number(g.question_id))||''}))};
  }
  async function review(admin,id){
    await roomAccess(admin,id);const r=await roomSync(id);if(r?.state==='finished')await finalize(id);
    if(r?.state!=='finished')fail(409,'Проверка доступна после завершения комнаты');if(!r.game_start_time)fail(409,'Комната закрыта до запуска. Гонорар не рассчитывается.');
    const f=await one(query,'SELECT * FROM player_room_scoring WHERE room_id=$1',[id]);if(!f)fail(404,'В этой комнате нет результатов для проверки');
    const grades=(await query('SELECT question_id,grade,comment FROM player_answer_grades WHERE room_id=$1',[id])).rows;
    const answers=await savedAnswers(query,f);const latest=new Map(answers.map(a=>[Number(a.question_id),a.answer_text]));
    const scenario=await one(query,'SELECT name FROM scenarios WHERE id=$1',[r.scenario_id]);
    const owner=await one(query,'SELECT a.username,g.id AS run_id FROM player_runs g JOIN player_accounts a ON a.id=g.account_id WHERE g.room_id=$1 AND g.is_owner=1 ORDER BY g.created_at,g.id LIMIT 1',[id]);
    return {room:{id:r.id,name:r.name,title:scenario?.name,owner_name:owner?.username||null},...(await publicSummary(id)),settings_revision:f.settings_revision,questions:JSON.parse(f.questions).map(q=>({id:Number(q.id),question_text:q.question_text,criteria:q.criteria,answer_text:latest.get(Number(q.id))||'',grade:grades.find(g=>Number(g.question_id)===Number(q.id))?.grade??null,comment:grades.find(g=>Number(g.question_id)===Number(q.id))?.comment||''}))};
  }
  async function reviews(admin,filters={}){
    staff(admin);const status=String(filters.status||'pending_review');if(!['pending_review','graded','all'].includes(status))fail(400,'Неизвестный статус проверки');
    const accessible=(await query('SELECT r.id,r.created_by FROM rooms r JOIN player_room_scoring f ON f.room_id=r.id WHERE r.is_test=FALSE')).rows.filter(r=>chief(admin)||Number(r.created_by)===Number(admin.id));
    for(const r of accessible){const room=await roomSync(r.id);if(room?.state==='finished')await finalize(r.id);}
    const rows=(await query(`SELECT f.room_id,f.review_status,f.trips,f.points,f.max_points,f.max_fee,f.fee,f.revision,r.name AS team_name,r.created_by,s.name AS title,a.username AS owner_name FROM player_room_scoring f JOIN rooms r ON r.id=f.room_id JOIN scenarios s ON s.id=r.scenario_id LEFT JOIN shared_rooms h ON h.room_id=r.id LEFT JOIN player_accounts a ON a.id=h.owner_account_id WHERE r.state='finished' AND r.game_start_time IS NOT NULL ORDER BY r.id DESC`)).rows;
    return {items:rows.filter(r=>(chief(admin)||Number(r.created_by)===Number(admin.id))&&(status==='all'||r.review_status===status))};
  }
  async function saveReview(admin,id,body={}){
    await roomAccess(admin,id);mutation(body);if(typeof body.publish!=='boolean')fail(400,'Укажите действие проверки');
    if(!Array.isArray(body.grades)||body.grades.length>500)fail(400,'Укажите оценки вопросов');
    const seen=new Set();for(const g of body.grades){if(!Number.isSafeInteger(g.question_id)||seen.has(g.question_id)||!Number.isInteger(g.grade)||g.grade<0||g.grade>5||typeof g.comment!=='string'||g.comment.length>2000)fail(400,'Каждая оценка должна быть целым числом от 0 до 5');seen.add(g.question_id);}
    const current=await roomSync(id);if(current?.state==='finished')await finalize(id);
    return transaction(async q=>{
      await q('UPDATE rooms SET name=name WHERE id=$1',[id]);const r=await roomAccess(admin,id,q);if(r.state!=='finished')fail(409,'Сначала завершите комнату');
      const owner=await one(q,'SELECT account_id FROM player_runs WHERE room_id=$1 AND is_owner=1 ORDER BY created_at,id LIMIT 1',[id]);
      return audit(q,admin,body.publish?'review_publish':'review_draft',id,owner?.account_id,body,{grades:body.grades,publish:body.publish,revision:body.revision},async()=>{
        const f=await one(q,'SELECT * FROM player_room_scoring WHERE room_id=$1',[id]);if(!f)fail(404,'Результат комнаты не найден');if(Number(f.revision)!==body.revision)fail(409,'Проверка изменена другим организатором. Обновите страницу');
        const questions=JSON.parse(f.questions);
        const answers=await savedAnswers(q,f);const latest=new Map(answers.map(a=>[Number(a.question_id),a.answer_text]));
        for(const g of body.grades){if(!questions.some(q=>Number(q.id)===g.question_id))fail(400,'Оценка относится к другому вопросу');if(!String(latest.get(g.question_id)||'').trim()&&g.grade!==0)fail(400,'За отсутствующий ответ можно поставить только 0');}
        for(const g of body.grades)await q(`INSERT INTO player_answer_grades (room_id,question_id,grade,comment) VALUES ($1,$2,$3,$4) ON CONFLICT(room_id,question_id) DO UPDATE SET grade=excluded.grade,comment=excluded.comment`,[id,g.question_id,g.grade,g.comment.trim()]);
        let calculation=null;
        if(body.publish){
          const rows=(await q('SELECT question_id,grade,comment FROM player_answer_grades WHERE room_id=$1 ORDER BY question_id',[id])).rows;
          const grades=questions.map(question=>rows.find(g=>Number(g.question_id)===Number(question.id)));if(grades.some(g=>!g))fail(400,'Перед публикацией оцените все вопросы');
          if(f.trips==null)fail(409,'Поездки ещё не зафиксированы');
          calculation=calculateFee({points:grades.reduce((s,g)=>s+Number(g.grade),0),max_points:Number(f.max_points),trips:Number(f.trips),max_fee:Number(f.max_fee),standard_trips:Number(f.standard_trips)});
          await q("UPDATE player_room_scoring SET points=$1,fee=$2,review_status='graded',published_grades=$3,reviewed_by=$4,reviewed_at=$5,formula_version=$6,rating_points=$7 WHERE room_id=$8",[calculation.points,calculation.fee,JSON.stringify(grades),admin.id,now(),FORMULA_VERSION,calculation.rating_points,id]);
          await q("UPDATE player_runs SET score=$1,result_status='graded' WHERE room_id=$2 AND room_user_id=$3",[calculation.fee,id,f.room_user_id]);
        }
        await q('UPDATE player_room_scoring SET revision=revision+1 WHERE room_id=$1',[id]);return {ok:true,published:body.publish,revision:body.revision+1,calculation};
      });
    });
  }
  async function firstRuns(accountId){
    const rows=(await query(`SELECT g.id,g.product_id,p.price FROM player_runs g JOIN rooms r ON r.id=g.room_id JOIN player_products p ON p.id=g.product_id WHERE g.account_id=$1 AND g.is_owner=1 AND r.state='finished' AND r.game_start_time IS NOT NULL ORDER BY g.created_at,g.id`,[accountId])).rows;
    const seen=new Set(),ids=new Set();for(const r of rows)if(!seen.has(r.product_id)){seen.add(r.product_id);if(Number(r.price)>0)ids.add(r.id);}return ids;
  }
  async function rankings(){
    const accounts=(await query('SELECT id FROM player_accounts')).rows;const totals=new Map(accounts.map(a=>[a.id,0]));
    const rows=(await query(`SELECT g.account_id,g.product_id,g.score,f.max_fee,f.rating_points FROM player_runs g JOIN rooms r ON r.id=g.room_id JOIN player_products p ON p.id=g.product_id LEFT JOIN player_room_scoring f ON f.room_id=r.id WHERE g.is_owner=1 AND r.state='finished' AND r.game_start_time IS NOT NULL AND p.price>0 ORDER BY g.created_at,g.id`)).rows;
    const seen=new Map();for(const r of rows){if(!seen.has(r.account_id))seen.set(r.account_id,new Set());const products=seen.get(r.account_id);if(products.has(r.product_id))continue;products.add(r.product_id);const points=r.score==null?0:(r.rating_points??Math.round(Number(r.score)/Number(r.max_fee||2000)*2000));totals.set(r.account_id,(totals.get(r.account_id)||0)+Math.max(0,Math.min(2000,points)));}
    return [...totals].map(([id,rating])=>({id,rating}));
  }
  async function questionInOpenRoom(questionId){
    const rows=(await query("SELECT f.questions FROM player_room_scoring f JOIN rooms r ON r.id=f.room_id WHERE r.state<>'finished'")).rows;
    return rows.some(r=>JSON.parse(r.questions).some(q=>Number(q.id)===Number(questionId)));
  }
  return {init,capture,complete,needsFinalize,conditions,frozenQuestions,publicSummary,settingsList,settings,saveSettings,reviews,review,saveReview,firstRuns,rankings,questionInOpenRoom,setFinalizer:fn=>{finalize=fn;}};
}
module.exports={createPlayerScoring,calculateFee,FORMULA_VERSION};
