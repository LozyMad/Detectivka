'use strict';
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const now = () => new Date().toISOString();
function createPlayerAdmin({query:rawQuery, transaction:rawTransaction, roomSync, remainingSeconds, finalizeRoom, scoring}) {
  // Renumber repeated parameters: SQLite binds by occurrence, PostgreSQL by number.
  const execute=(q,sql,params=[])=>{const values=[];const mapped=sql.replace(/\$(\d+)/g,(_,n)=>{values.push(params[Number(n)-1]);return '$'+values.length;});return q(mapped,values);};
  const query=(sql,params)=>execute(rawQuery,sql,params);
  const transaction=work=>rawTransaction(q=>work((sql,params)=>execute(q,sql,params)));
  const one = async (q, sql, params=[]) => (await q(sql, params)).rows[0];
  const superAdmin = admin => admin?.is_admin && admin.admin_level === 'super_admin';
  const staff = admin => { if (!admin?.is_admin) fail(403, 'Нужны права организатора'); };
  const superOnly = admin => { staff(admin); if (!superAdmin(admin)) fail(403, 'Доступы и попытки выдаёт главный администратор'); };
  const productScope = admin => superAdmin(admin) ? '1=1' : 's.created_by=$1';
  const roomScope = admin => superAdmin(admin) ? '1=1' : 'r.created_by=$1';
  const playerScope = admin => superAdmin(admin) ? '1=1' : `EXISTS (SELECT 1 FROM player_runs g JOIN rooms r ON r.id=g.room_id WHERE g.account_id=a.id AND r.created_by=$1) OR EXISTS (SELECT 1 FROM player_entitlements e JOIN player_products p ON p.id=e.product_id JOIN scenarios s ON s.id=p.scenario_id WHERE e.account_id=a.id AND s.created_by=$1)`;
  async function init() {
    await query(`CREATE TABLE IF NOT EXISTS player_admin_audit (id TEXT PRIMARY KEY,admin_id INTEGER NOT NULL,admin_name TEXT NOT NULL,action TEXT NOT NULL,account_id TEXT,room_id INTEGER,reason TEXT NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL)`);
    await query(`CREATE TABLE IF NOT EXISTS player_attempt_credits (request_key TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES player_accounts(id),product_id TEXT NOT NULL REFERENCES player_products(id),amount INTEGER NOT NULL CHECK(amount>0),created_at TEXT NOT NULL)`);
    await query('CREATE INDEX IF NOT EXISTS idx_attempt_credits_account_product ON player_attempt_credits(account_id,product_id)');
  }
  function paging(body={}) {
    const page=Number(body.page||1); if (!Number.isSafeInteger(page)||page<1||page>100000) fail(400,'Неверная страница');
    const search=String(body.q||'').trim(); if(search.length>160)fail(400,'Поисковый запрос слишком длинный');
    return {page,search,limit:25,offset:(page-1)*25};
  }
  async function account(admin,id,q=query) {
    staff(admin);
    const row=await one(q,`SELECT a.id,a.username,a.email,a.created_at FROM player_accounts a WHERE a.id=$2 AND (${playerScope(admin)})`,[admin.id,id]);
    if(!row)fail(404,'Игрок не найден или недоступен'); return row;
  }
  async function roomsForAccount(admin,id) {
    const rows=(await query(`SELECT r.id FROM rooms r JOIN player_runs g ON g.room_id=r.id WHERE g.account_id=$2 AND (${roomScope(admin)})`,[admin.id,id])).rows;
    for(const row of rows){const room=await roomSync(row.id);if(room?.state==='finished')await finalizeRoom(row.id);}
    return (await query(`SELECT g.id AS run_id,g.product_id,g.attempt_number,g.is_owner,g.score,g.result_status,g.elapsed_seconds,r.id,r.name,r.state,r.is_shared,r.duration_seconds,r.game_end_time,r.paused_at,s.name AS title FROM player_runs g JOIN rooms r ON r.id=g.room_id JOIN scenarios s ON s.id=r.scenario_id WHERE g.account_id=$2 AND (${roomScope(admin)}) ORDER BY g.created_at DESC`,[admin.id,id])).rows.map(r=>({...r,remaining_seconds:remainingSeconds(r)}));
  }
  async function players(admin,filters={}) {
    staff(admin); const p=paging(filters);
    const rows=(await query(`SELECT a.id,a.username,a.email,a.created_at,(SELECT COUNT(*) FROM player_runs g JOIN rooms r ON r.id=g.room_id WHERE g.account_id=a.id AND g.is_owner=1 AND (${roomScope(admin)})) AS games_count FROM player_accounts a WHERE (${playerScope(admin)}) ORDER BY a.created_at DESC,a.id`,[admin.id])).rows;
    // SQLite LOWER/NOCASE handles ASCII only; filter Unicode names after applying access scope.
    const found=rows.filter(a=>(a.username+' '+a.email).toLocaleLowerCase('ru').includes(p.search.toLocaleLowerCase('ru')));
    return {items:found.slice(p.offset,p.offset+p.limit),total:found.length,page:p.page,pages:Math.max(1,Math.ceil(found.length/p.limit)),can_grant:!!superAdmin(admin)};
  }
  async function player(admin,id) {
    const a=await account(admin,id);const games=await roomsForAccount(admin,id);
    const products=(await query(`SELECT p.id,p.title,p.price,p.published,p.max_attempts,e.acquired_at,CASE WHEN p.price=0 OR e.account_id IS NOT NULL THEN 1 ELSE 0 END AS owned,(SELECT COUNT(*) FROM player_attempts t WHERE t.account_id=$2 AND t.product_id=p.id) AS used,COALESCE((SELECT SUM(c.amount) FROM player_attempt_credits c WHERE c.account_id=$2 AND c.product_id=p.id),0) AS extra FROM player_products p JOIN scenarios s ON s.id=p.scenario_id LEFT JOIN player_entitlements e ON e.product_id=p.id AND e.account_id=$2 WHERE (${productScope(admin)}) ORDER BY p.price,p.title`,[admin.id,id])).rows.map(p=>({...p,owned:!!p.owned,used:Number(p.used),extra:Number(p.extra),attempts_left:Math.max(0,Number(p.max_attempts)+Number(p.extra)-Number(p.used))}));
    return {account:a,products,games,can_grant:!!superAdmin(admin),journal:await journal(admin,{account_id:id})};
  }
  async function roomIdentity(admin,id,q=query) {
    staff(admin);const row=await one(q,`SELECT r.* FROM rooms r JOIN shared_rooms h ON h.room_id=r.id WHERE r.id=$2 AND (${roomScope(admin)})`,[admin.id,id]);
    if(!row)fail(404,'Общая комната не найдена или недоступна');return row;
  }
  async function settleRooms(admin) {
    const rows=(await query(`SELECT r.id FROM rooms r JOIN shared_rooms h ON h.room_id=r.id WHERE r.state='running' AND (${roomScope(admin)})`,[admin.id])).rows;
    for(const row of rows){const room=await roomSync(row.id);if(room?.state==='finished')await finalizeRoom(row.id);}
  }
  async function rooms(admin,filters={}) {
    staff(admin);const p=paging(filters);const state=String(filters.state||'');
    if(state&&!['pending','running','paused','finished'].includes(state))fail(400,'Неизвестный статус');
    await settleRooms(admin);
    const rows=(await query(`SELECT r.id,r.name,r.state,r.duration_seconds,r.game_end_time,r.paused_at,s.name AS title,a.username AS owner_name,a.id AS owner_id,h.answers_submitted,g.attempt_number,g.score,g.result_status FROM rooms r JOIN shared_rooms h ON h.room_id=r.id JOIN scenarios s ON s.id=r.scenario_id LEFT JOIN player_accounts a ON a.id=h.owner_account_id LEFT JOIN player_runs g ON g.room_id=r.id AND g.is_owner=1 WHERE (${roomScope(admin)}) AND ($2='' OR r.state=$2) ORDER BY r.id DESC`,[admin.id,state])).rows;
    const found=rows.filter(r=>(r.name+' '+r.title+' '+(r.owner_name||'')).toLocaleLowerCase('ru').includes(p.search.toLocaleLowerCase('ru')));
    return {items:found.slice(p.offset,p.offset+p.limit).map(r=>({...r,answers_submitted:!!r.answers_submitted,remaining_seconds:remainingSeconds(r)})),total:found.length,page:p.page,pages:Math.max(1,Math.ceil(found.length/p.limit))};
  }
  async function room(admin,id) {
    await roomIdentity(admin,id);await roomSync(id);await finalizeRoom(id);
    const r=await roomIdentity(admin,id);
    const link=await one(query,'SELECT room_user_id,invite_token,owner_account_id,notes,answers_submitted FROM shared_rooms WHERE room_id=$1',[id]);
    const owner=link.owner_account_id?await one(query,'SELECT id,username,email FROM player_accounts WHERE id=$1',[link.owner_account_id]):null;
    const questions=(await query('SELECT id,question_text FROM questions WHERE scenario_id=$1 AND is_active=TRUE ORDER BY question_order,id',[r.scenario_id])).rows;
    const rows=(await query(link.answers_submitted?'SELECT question_id,answer_text FROM question_answers WHERE room_user_id=$1 ORDER BY id':'SELECT question_id,answer_text FROM shared_answer_drafts WHERE room_id=$1',[link.answers_submitted?link.room_user_id:id])).rows;
    const answers=new Map(rows.map(a=>[Number(a.question_id),a.answer_text]));
    const run=await one(query,'SELECT id,product_id,attempt_number,score,result_status,elapsed_seconds FROM player_runs WHERE room_id=$1 AND is_owner=1',[id]);
    const scenario=await one(query,'SELECT name FROM scenarios WHERE id=$1',[r.scenario_id]);
    return {scoring:await scoring.publicSummary(id),room:{...r,title:scenario?.name,remaining_seconds:remainingSeconds(r)},owner,run:run||null,invite_path:r.state==='finished'?null:'/room#'+link.invite_token,notes:link.notes,answers_submitted:!!link.answers_submitted,questions:questions.map(q=>({...q,answer_text:answers.get(Number(q.id))||''})),journal:await journal(admin,{room_id:id})};
  }
  function mutation(body) {
    const reason=typeof body.reason==='string'?body.reason.trim():'';if(reason.length<3||reason.length>500)fail(400,'Укажите причину: от 3 до 500 символов');
    if(typeof body.request_key!=='string'||!/^[\w-]{16,100}$/.test(body.request_key))fail(400,'Некорректный идентификатор запроса');
    return {reason,key:body.request_key};
  }
  async function audited(q,admin,action,accountId,roomId,body,payload,work) {
    const {reason,key}=mutation(body);const encoded=JSON.stringify(payload);
    const old=await one(q,'SELECT * FROM player_admin_audit WHERE id=$1',[key]);
    if(old){if(Number(old.admin_id)!==Number(admin.id)||old.action!==action||old.account_id!==(accountId||null)||Number(old.room_id||0)!==Number(roomId||0)||old.payload!==encoded||old.reason!==reason)fail(409,'Идентификатор уже использован для другого действия');return JSON.parse(old.result);}
    const result=await work();
    await q('INSERT INTO player_admin_audit (id,admin_id,admin_name,action,account_id,room_id,reason,payload,result,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[key,admin.id,admin.username||String(admin.id),action,accountId||null,roomId||null,reason,encoded,JSON.stringify(result),now()]);
    return result;
  }
  async function grant(admin,id,body={}) {
    superOnly(admin);const action=body.action;if(!['grant_access','add_attempts'].includes(action))fail(400,'Неизвестное действие');mutation(body);
    const amount=action==='add_attempts'?body.amount:0;
    if(action==='add_attempts'&&(!Number.isInteger(amount)||amount<1||amount>10))fail(400,'Можно добавить от 1 до 10 попыток');
    return transaction(async q=>{
      await q('UPDATE player_accounts SET updated_at=updated_at WHERE id=$1',[id]);await account(admin,id,q);
      const p=await one(q,'SELECT * FROM player_products WHERE id=$1',[body.product_id]);if(!p)fail(404,'Дело не найдено');
      return audited(q,admin,action,id,null,body,{product_id:p.id,amount},async()=>{
        const owned=p.price===0||!!await one(q,'SELECT account_id FROM player_entitlements WHERE account_id=$1 AND product_id=$2',[id,p.id]);
        if(action==='grant_access'){
          if(owned)fail(409,'Дело уже доступно игроку');
          await q('INSERT INTO player_entitlements (account_id,product_id,acquired_at) VALUES ($1,$2,$3)',[id,p.id,now()]);
        }else{
          if(!owned)fail(409,'Сначала выдайте доступ к делу');
          await q('INSERT INTO player_attempt_credits (request_key,account_id,product_id,amount,created_at) VALUES ($1,$2,$3,$4,$5)',[body.request_key,id,p.id,amount,now()]);
        }
        return {ok:true,action,product_id:p.id,amount};
      });
    });
  }
  async function control(admin,id,body={}) {
    staff(admin);const action=body.action;if(!['start','pause','resume','add_time','finish'].includes(action))fail(400,'Неизвестное действие');mutation(body);
    if(action==='finish'&&body.confirmed!==true)fail(400,'Подтвердите завершение комнаты');
    const minutes=action==='add_time'?body.minutes:0;if(action==='add_time'&&(!Number.isInteger(minutes)||minutes<1||minutes>240))fail(400,'Можно добавить от 1 до 240 минут');
    const controlRoom=async(q=query)=>{
      if(action!=='add_time')return roomIdentity(admin,id,q);
      const room=await one(q,`SELECT r.* FROM rooms r WHERE r.id=$2 AND (${roomScope(admin)})`,[admin.id,id]);
      if(!room)fail(404,'Комната не найдена или недоступна');
      if(room.is_test)fail(400,'В тестовых комнатах нет ограничения времени');
      if(room.duration_seconds===0)fail(400,'В комнате без таймера дополнительное время не требуется');
      return room;
    };
    await controlRoom();await roomSync(id);await finalizeRoom(id);
    return transaction(async q=>{
      await q('UPDATE rooms SET name=name WHERE id=$1',[id]);const r=await controlRoom(q);
      const link=await one(q,'SELECT owner_account_id FROM shared_rooms WHERE room_id=$1',[id]);
      return audited(q,admin,action,link?.owner_account_id,id,body,{minutes,confirmed:action==='finish'},async()=>{
        if(r.state==='finished')fail(409,'Завершённую комнату нельзя изменять');
        if(action==='start'){
          if(r.state!=='pending')fail(409,'Комната уже запущена');
          const run=await one(q,'SELECT account_id,product_id FROM player_runs WHERE room_id=$1 AND is_owner=1',[id]);
          if(run){const p=await one(q,'SELECT max_attempts FROM player_products WHERE id=$1',[run.product_id]);const used=Number((await one(q,'SELECT COUNT(*) AS n FROM player_attempts WHERE account_id=$1 AND product_id=$2',[run.account_id,run.product_id])).n);const extra=Number((await one(q,'SELECT COALESCE(SUM(amount),0) AS n FROM player_attempt_credits WHERE account_id=$1 AND product_id=$2',[run.account_id,run.product_id])).n);if(!p||used>=Number(p.max_attempts)+extra)fail(409,'Все попытки игрока использованы');}
          await q("UPDATE rooms SET state='running',game_start_time=$1,game_end_time=$2,paused_at=NULL,halfway_paused=TRUE WHERE id=$3",[now(),r.duration_seconds===0?null:new Date(Date.now()+r.duration_seconds*1000).toISOString(),id]);
        }else if(action==='pause'){
          if(r.state!=='running')fail(409,'Поставить на паузу можно только идущую игру');
          await q("UPDATE rooms SET state='paused',paused_at=$1 WHERE id=$2",[now(),id]);
        }else if(action==='resume'){
          if(r.state!=='paused')fail(409,'Комната сейчас не на паузе');const remaining=remainingSeconds(r);if(remaining!==null&&remaining<=0)fail(409,'Время игры истекло');
          await q("UPDATE rooms SET state='running',game_end_time=$1,paused_at=NULL WHERE id=$2",[r.duration_seconds===0?null:new Date(Date.now()+remaining*1000).toISOString(),id]);
        }else if(action==='add_time'){
          const seconds=minutes*60;const end=r.game_end_time?new Date(new Date(r.game_end_time).getTime()+seconds*1000).toISOString():null;
          await q('UPDATE rooms SET duration_seconds=duration_seconds+$1,game_end_time=$2 WHERE id=$3',[seconds,end,id]);
        }else{
          if(!['running','paused'].includes(r.state))fail(409,'Комната ещё не запущена');
          const elapsed=Math.max(0,Math.min(Number(r.duration_seconds),Number(r.duration_seconds)-Number(remainingSeconds(r))));
          await q("UPDATE rooms SET state='finished',game_end_time=$1,paused_at=NULL WHERE id=$2",[now(),id]);await finalizeRoom(id,q,elapsed);
        }
        const updated=await one(q,'SELECT state,duration_seconds,game_end_time,paused_at FROM rooms WHERE id=$1',[id]);return {ok:true,room:{id,...updated,remaining_seconds:remainingSeconds(updated)}};
      });
    });
  }
  async function journal(admin,filters={}) {
    staff(admin);
    return (await query(`SELECT j.id,j.admin_name,j.action,j.account_id,j.room_id,j.reason,j.payload,j.created_at FROM player_admin_audit j WHERE ($2='' OR j.account_id=$2) AND ($3=0 OR j.room_id=$3) AND (${superAdmin(admin)?'1=1':"EXISTS (SELECT 1 FROM rooms r WHERE r.id=j.room_id AND r.created_by=$1) OR (j.action='scoring_settings' AND j.admin_id=$1)"}) ORDER BY j.created_at DESC,j.id DESC LIMIT 100`,[admin.id,filters.account_id||'',Number(filters.room_id)||0])).rows.map(j=>({...j,payload:JSON.parse(j.payload)}));
  }
  return {init,players,player,rooms,room,grant,control,journal};
}
module.exports={createPlayerAdmin};
