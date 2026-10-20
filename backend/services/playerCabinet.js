const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { newRoomQuestionDelay } = require('./questionAccess');
const SESSION_MS = 7 * 86400000;
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message, code) => { const error = new Error(message); error.status = status; error.code=code; throw error; };
const emailValue = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
function validPassword(value) { if (typeof value !== 'string' || value.length < 8 || value.length > 72) fail(400, 'Пароль должен содержать от 8 до 72 символов'); if (Buffer.byteLength(value,'utf8') > 72) fail(400, 'Пароль слишком длинный: используйте не больше 72 байт'); }
function validName(value) { if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 40) fail(400, 'Имя должно содержать от 2 до 40 символов'); return value.trim(); }
function validEmail(value) { const email = emailValue(value); if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Укажите корректный email'); return email; }
const publicAccount = account => ({ id: account.id, username: account.username, email: account.email, created_at: account.created_at });

function createPlayerCabinet({ query, transaction, localMode = false, postgres = false, roomSync, remainingSeconds, findTeams, aiGrader }) {
  const shared = require('./sharedRooms').createSharedRooms({query,transaction,postgres,roomSync,remainingSeconds});
  const scoring=require('./playerScoring').createPlayerScoring({query,transaction,roomSync,aiGrader});
  const one = async (q, sql, values = []) => (await q(sql, values)).rows[0];
  const insertSession = async (q, accountId) => {
    const token = crypto.randomBytes(32).toString('base64url');
    await q('INSERT INTO player_login_sessions (token_hash, account_id, expires_at) VALUES ($1,$2,$3)', [hash(token), accountId, new Date(Date.now() + SESSION_MS).toISOString()]);
    return token;
  };
  async function init() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS player_accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, username TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS player_login_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES player_accounts(id), expires_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS player_password_resets (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES player_accounts(id), expires_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS player_products (id TEXT PRIMARY KEY, scenario_id INTEGER NOT NULL REFERENCES scenarios(id), title TEXT NOT NULL, description TEXT NOT NULL, cover TEXT NOT NULL, price INTEGER NOT NULL CHECK(price >= 0), duration_seconds INTEGER NOT NULL CHECK(duration_seconds > 0), difficulty INTEGER NOT NULL, max_attempts INTEGER NOT NULL, published INTEGER NOT NULL DEFAULT 1, rubric TEXT, solution TEXT)`,
      `CREATE TABLE IF NOT EXISTS player_entitlements (account_id TEXT NOT NULL REFERENCES player_accounts(id), product_id TEXT NOT NULL REFERENCES player_products(id), acquired_at TEXT NOT NULL, PRIMARY KEY(account_id, product_id))`,
      `CREATE TABLE IF NOT EXISTS player_orders (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES player_accounts(id), request_key TEXT UNIQUE NOT NULL, title TEXT NOT NULL, amount INTEGER NOT NULL, items TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS player_runs (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES player_accounts(id), product_id TEXT REFERENCES player_products(id), room_id INTEGER NOT NULL REFERENCES rooms(id), room_user_id INTEGER NOT NULL REFERENCES room_users(id), attempt_number INTEGER NOT NULL, is_owner INTEGER NOT NULL, request_key TEXT UNIQUE NOT NULL, elapsed_seconds INTEGER NOT NULL DEFAULT 0, score INTEGER, result_status TEXT, created_at TEXT NOT NULL, UNIQUE(account_id, room_id))`,
      `CREATE TABLE IF NOT EXISTS player_attempts (run_id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES player_accounts(id),product_id TEXT NOT NULL REFERENCES player_products(id),completed_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_player_runs_account ON player_runs(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_player_runs_room ON player_runs(room_id)`
    ];
    for (const sql of statements) await query(sql);
    await shared.init();
    await admin.init();
    await scoring.init();
  }
  async function register(body) {
    const username = validName(body.username); const email = validEmail(body.email); validPassword(body.password);
    if (body.password !== body.confirm_password) fail(400, 'Пароли не совпадают');
    if (body.accept_terms !== true) fail(400, 'Примите условия использования');
    const passwordHash = await bcrypt.hash(body.password, 12);
    return transaction(async q => {
      if (await one(q, 'SELECT id FROM player_accounts WHERE email=$1', [email])) fail(409, 'Аккаунт с этим email уже существует');
      const account = {id: uuid(), email, username, created_at: now()};
      await q('INSERT INTO player_accounts (id,email,username,password_hash,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)', [account.id,email,username,passwordHash,account.created_at]);
      return { account, token: await insertSession(q, account.id) };
    });
  }
  async function login(body) {
    const email = validEmail(body.email);
    if (typeof body.password !== 'string' || body.password.length > 72) fail(400, 'Введите пароль');
    const account = await one(query, 'SELECT * FROM player_accounts WHERE email=$1', [email]);
    const passwordHash = account?.password_hash || '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxOkThpZd4ApjVBH.gOhMNI.FwG';
    const valid = await bcrypt.compare(body.password, passwordHash);
    if (!account || !valid) fail(401, 'Неверный email или пароль');
    return transaction(async q => {
      const current = await one(q, 'SELECT * FROM player_accounts WHERE id=$1', [account.id]);
      if (current.password_hash !== account.password_hash) fail(401, 'Пароль изменён. Войдите снова');
      return {account: publicAccount(account), token: await insertSession(q, account.id)};
    });
  }
  async function authenticate(token) {
    if (!token || token.length > 128) fail(401, 'Войдите в личный кабинет');
    const account = await one(query, `SELECT a.* FROM player_accounts a JOIN player_login_sessions s ON s.account_id=a.id WHERE s.token_hash=$1 AND s.expires_at>$2`, [hash(token),now()]);
    if (!account) fail(401, 'Сессия истекла. Войдите снова');
    return publicAccount(account);
  }
  async function logout(token) { if (token) await query('DELETE FROM player_login_sessions WHERE token_hash=$1',[hash(token)]); }
  async function updateAccount(accountId, body) {
    const username = validName(body.username); const email = validEmail(body.email);
    const changePassword = typeof body.new_password === 'string' && body.new_password.length > 0;
    if (changePassword) { validPassword(body.new_password); if (body.new_password !== body.confirm_password) fail(400,'Пароли не совпадают'); }
    return transaction(async q => {
      await q('UPDATE player_accounts SET updated_at=$1 WHERE id=$2',[now(),accountId]);
      const account = await one(q,'SELECT * FROM player_accounts WHERE id=$1',[accountId]);
      if (!account) fail(401,'Аккаунт не найден');
      if ((email !== account.email || changePassword) && (typeof body.current_password !== 'string' || !await bcrypt.compare(body.current_password,account.password_hash))) fail(400,'Для смены email или пароля укажите текущий пароль');
      const duplicate = await one(q,'SELECT id FROM player_accounts WHERE email=$1 AND id<>$2',[email,accountId]);
      if (duplicate) fail(409,'Этот email уже используется');
      await q('UPDATE player_accounts SET username=$1,email=$2,password_hash=$3 WHERE id=$4',[username,email,changePassword ? await bcrypt.hash(body.new_password,12) : account.password_hash,accountId]);
      if (changePassword || email !== account.email) {
        await q('DELETE FROM player_login_sessions WHERE account_id=$1',[accountId]);
        await q('DELETE FROM player_password_resets WHERE account_id=$1',[accountId]);
      }
      return {account: {...publicAccount(account),username,email},token:await insertSession(q,accountId)};
    });
  }
  async function requestReset(body) {
    const email = validEmail(body.email);
    if (!localMode) fail(503,'Отправка писем пока не подключена');
    return transaction(async q => {
      const account = await one(q,'SELECT id FROM player_accounts WHERE email=$1',[email]);
      if (!account) return {message:'Если аккаунт существует, инструкция по восстановлению подготовлена'};
      await q('DELETE FROM player_password_resets WHERE account_id=$1',[account.id]);
      const token = crypto.randomBytes(32).toString('base64url');
      await q('INSERT INTO player_password_resets (token_hash,account_id,expires_at) VALUES ($1,$2,$3)',[hash(token),account.id,new Date(Date.now()+30*60000).toISOString()]);
      return {message:'В локальном режиме письмо заменено ссылкой ниже. Ссылка действует 30 минут.',reset_url:'/reset-password#'+token};
    });
  }
  async function resetPassword(body) {
    validPassword(body.password); if (body.password !== body.confirm_password) fail(400,'Пароли не совпадают');
    if (typeof body.token !== 'string' || body.token.length > 128) fail(400,'Ссылка недействительна');
    return transaction(async q => {
      const reset = await one(q,'DELETE FROM player_password_resets WHERE token_hash=$1 AND expires_at>$2 RETURNING account_id',[hash(body.token),now()]);
      if (!reset) fail(400,'Ссылка недействительна или истекла');
      await q('UPDATE player_accounts SET password_hash=$1,updated_at=$2 WHERE id=$3',[await bcrypt.hash(body.password,12),now(),reset.account_id]);
      await q('DELETE FROM player_login_sessions WHERE account_id=$1',[reset.account_id]);
      await q('DELETE FROM player_password_resets WHERE account_id=$1',[reset.account_id]);
      return {message:'Пароль изменён. Войдите с новым паролем'};
    });
  }
  async function catalog(accountId = '') {
    if (accountId) await settleAccount(accountId);
    const rows = (await query(`SELECT p.id,p.scenario_id,p.title,p.description,p.cover,p.price,p.duration_seconds,p.difficulty,p.max_attempts,COALESCE(f.max_fee,2000) AS max_fee,COALESCE(f.standard_trips,20) AS standard_trips,
      CASE WHEN p.price=0 OR e.account_id IS NOT NULL THEN 1 ELSE 0 END AS owned,
      (SELECT COUNT(*) FROM player_attempts g WHERE g.account_id=$1 AND g.product_id=p.id) AS attempts_used,
      COALESCE((SELECT SUM(c.amount) FROM player_attempt_credits c WHERE c.account_id=$1 AND c.product_id=p.id),0) AS extra_attempts
      FROM player_products p LEFT JOIN player_entitlements e ON e.product_id=p.id AND e.account_id=$1 LEFT JOIN scenario_scoring_settings f ON f.scenario_id=p.scenario_id WHERE p.published=1 ORDER BY p.price,p.title`,[accountId])).rows;
    return rows.map(p=>({...p,base_attempts:Number(p.max_attempts),max_attempts:Number(p.max_attempts)+Number(p.extra_attempts),owned:!!p.owned,attempts_used:Number(p.attempts_used),attempts_left:Math.max(0,Number(p.max_attempts)+Number(p.extra_attempts)-Number(p.attempts_used))}));
  }
  async function bundles() {
    // Bundle prices are a local checkout prototype, not a public offer.
    if (!localMode) return [];
    const products = await catalog();
    if (products.length < 2 || !products.some(p=>p.price>0)) return [];
    return [{id:'starter',title:'Стартовый набор',description:'Знакомство с платформой и полное расследование в одном наборе.',product_ids:products.map(p=>p.id),original_price:products.reduce((s,p)=>s+p.price,0),price:Math.floor(products.reduce((s,p)=>s+p.price,0)*0.9),discount:10}];
  }
  async function purchase(accountId, body) {
    if (!localMode) fail(503,'Платёжный сервис пока не подключён');
    if (body.confirm_local !== true) fail(400,'Подтвердите тестовую покупку без списания денег');
    const requestKey = validKey(body.request_key);
    const allBundles = await bundles();
    return transaction(async q => {
      await q('UPDATE player_accounts SET updated_at=$1 WHERE id=$2',[now(),accountId]);
      const old = await one(q,'SELECT * FROM player_orders WHERE request_key=$1',[requestKey]);
      if (old) { if (old.account_id !== accountId) fail(409,'Повторите покупку'); return old; }
      let products, amount, title;
      if (body.bundle_id) {
        const bundle = allBundles.find(b=>b.id===body.bundle_id); if (!bundle) fail(404,'Набор не найден');
        products=(await q('SELECT * FROM player_products WHERE published=1')).rows.filter(p=>bundle.product_ids.includes(p.id));
        if (products.length !== bundle.product_ids.length) fail(409,'Состав набора изменился');
        amount=bundle.price;title=bundle.title;
      } else {
        const product=await one(q,'SELECT * FROM player_products WHERE id=$1 AND published=1',[body.product_id]);
        if (!product || product.price===0) fail(400,'Выберите платное дело'); products=[product];amount=product.price;title=product.title;
      }
      for (const product of products.filter(p=>p.price>0)) {
        if (await one(q,'SELECT account_id FROM player_entitlements WHERE account_id=$1 AND product_id=$2',[accountId,product.id])) fail(409,'Дело уже есть в вашей библиотеке');
      }
      const order={id:uuid(),account_id:accountId,request_key:requestKey,title,amount,items:JSON.stringify(products.map(p=>p.id)),status:'sandbox_paid',created_at:now()};
      await q('INSERT INTO player_orders (id,account_id,request_key,title,amount,items,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',Object.values(order));
      for(const product of products) await q('INSERT INTO player_entitlements (account_id,product_id,acquired_at) VALUES ($1,$2,$3) ON CONFLICT(account_id,product_id) DO NOTHING',[accountId,product.id,now()]);
      return order;
    });
  }
  function validKey(value) { if(typeof value!=='string'|| !/^[\w-]{16,100}$/.test(value)) fail(400,'Некорректный идентификатор запроса'); return value; }
  async function start(accountId, body) {
    const requestKey=validKey(body.request_key);const teamName=validName(body.team_name);
    await settleAccount(accountId);
    return transaction(async q=>{
      await q('UPDATE player_accounts SET updated_at=$1 WHERE id=$2',[now(),accountId]);
      const previous=await one(q,'SELECT * FROM player_runs WHERE request_key=$1',[requestKey]);
      if(previous){if(previous.account_id!==accountId)fail(409,'Повторите создание комнаты');return previous;}
      const product=await one(q,'SELECT * FROM player_products WHERE id=$1 AND published=1',[body.product_id]);
      if(!product)fail(404,'Дело не найдено');
      if(product.price>0&&!await one(q,'SELECT account_id FROM player_entitlements WHERE account_id=$1 AND product_id=$2',[accountId,product.id]))fail(403,'Сначала добавьте дело в библиотеку');
      const active=await one(q,`SELECT g.id FROM player_runs g JOIN rooms r ON r.id=g.room_id WHERE g.account_id=$1 AND g.product_id=$2 AND g.is_owner=1 AND r.state<>'finished'`,[accountId,product.id]);
      if(active)fail(409,'У вас уже есть комната по этому делу. Продолжите её из истории');
      const count=Number((await one(q,'SELECT COUNT(*) AS total FROM player_attempts WHERE account_id=$1 AND product_id=$2',[accountId,product.id])).total);
      const extra=Number((await one(q,'SELECT COALESCE(SUM(amount),0) AS total FROM player_attempt_credits WHERE account_id=$1 AND product_id=$2',[accountId,product.id])).total);
      if(count>=Number(product.max_attempts)+extra)fail(409,'Все попытки по этому делу использованы');
      const scenario=await one(q,'SELECT created_by FROM scenarios WHERE id=$1',[product.scenario_id]);if(!scenario)fail(409,'Сценарий больше не доступен');
      const delay=newRoomQuestionDelay(product.duration_seconds||7200);
      const room=await one(q,`INSERT INTO rooms (name,scenario_id,created_by,duration_seconds,questions_delay_seconds,is_test,state,halfway_paused) VALUES ($1,$2,$3,$4,$5,FALSE,'pending',TRUE) RETURNING id`,[teamName,product.scenario_id,scenario.created_by,product.duration_seconds||7200,delay]);
      const link=await shared.provision(q,{...room,name:teamName},accountId,null,product.id);
      const run={id:uuid(),account_id:accountId,product_id:product.id,room_id:room.id,room_user_id:link.room_user_id,attempt_number:count+1,is_owner:1,request_key:requestKey,created_at:now()};
      await q('INSERT INTO player_runs (id,account_id,product_id,room_id,room_user_id,attempt_number,is_owner,request_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',Object.values(run));return run;
    });
  }
  async function join(accountId, body) {
    const name=validName(body.team_name);if(typeof body.team_password!=='string'||body.team_password.length>72) fail(400,'Введите пароль команды');
    const teams=await findTeams(name,body.team_password);
    if(teams.length!==1) fail(teams.length>1?409:401,teams.length>1?'Данные команды неоднозначны. Обратитесь к организатору':'Неверное название команды или пароль');
    const team=teams[0];
    return transaction(async q=>{
      const old=await one(q,'SELECT * FROM player_runs WHERE account_id=$1 AND room_id=$2',[accountId,team.room_id]);if(old)return old;
      const product=await one(q,'SELECT p.id FROM player_products p JOIN rooms r ON r.scenario_id=p.scenario_id WHERE r.id=$1',[team.room_id]);
      const run={id:uuid(),account_id:accountId,product_id:product?.id||null,room_id:team.room_id,room_user_id:team.id,attempt_number:0,is_owner:0,request_key:uuid(),created_at:now()};
      await q('INSERT INTO player_runs (id,account_id,product_id,room_id,room_user_id,attempt_number,is_owner,request_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',Object.values(run));return run;
    });
  }
  async function ownRun(accountId,id,q=query) {
    const run=await one(q,`SELECT g.*,r.state,r.scenario_id,r.name AS team_name,r.game_start_time,r.game_end_time,r.duration_seconds,r.paused_at FROM player_runs g JOIN rooms r ON r.id=g.room_id WHERE g.id=$1 AND g.account_id=$2`,[id,accountId]);
    if(!run) fail(404,'Игра не найдена');return run;
  }
  async function enter(accountId,id) {
    const run=await ownRun(accountId,id);
    const currentRoom=await roomSync(run.room_id);
    if(!currentRoom)fail(404,'Комната больше не существует');
    if(!currentRoom.is_test&&currentRoom.state==='finished'){await finalizeRoom(run.room_id);fail(403,'Игра в этой комнате завершена. Повторный вход закрыт.','ROOM_FINISHED');}
    const linked=await one(query,'SELECT room_id FROM shared_rooms WHERE room_id=$1',[run.room_id]);
    if(linked){const identity=await shared.identity(run.room_id,{id:accountId});return {...identity,cabinet_run:{id:run.id,is_owner:!!run.is_owner}};}
    const room=await roomSync(run.room_id);
    const user=await one(query,'SELECT id,username FROM room_users WHERE id=$1 AND room_id=$2',[run.room_user_id,run.room_id]);if(!user||!room)fail(404,'Команда или комната больше не существует');
    const token=jwt.sign({room_user_id:user.id,room_id:room.id,username:user.username,scenario_id:room.scenario_id,role:'room_user'},process.env.JWT_SECRET||'your-secret-key',{expiresIn:'24h'});
    return {token,room:{id:room.id,name:room.name,scenario_id:room.scenario_id,duration_seconds:room.duration_seconds,is_test:false},user:{...user,room_id:room.id},cabinet_run:{id:run.id,is_owner:!!run.is_owner}};
  }
  function elapsed(room) { if(room.state==='pending')return 0;const remaining=remainingSeconds(room);return Math.max(0,Math.min(Number(room.duration_seconds),Number(room.duration_seconds)-Number(remaining))); }
  async function finalizeRoom(roomId, existingQuery=null, elapsedValue=null){
    if(!existingQuery){const pending=(await query(`SELECT g.id FROM player_runs g JOIN rooms r ON r.id=g.room_id LEFT JOIN player_attempts a ON a.run_id=g.id WHERE g.room_id=$1 AND g.is_owner=1 AND r.state='finished' AND r.game_start_time IS NOT NULL AND (a.run_id IS NULL OR g.result_status IS NULL)`,[roomId])).rows;if(!pending.length&&!await scoring.needsFinalize(roomId))return;}
    const work=async q=>{
      await q('UPDATE rooms SET name=name WHERE id=$1',[roomId]);
      const room=await one(q,'SELECT * FROM rooms WHERE id=$1',[roomId]);if(!room||room.state!=='finished'||!room.game_start_time)return;
      const grade=await scoring.complete(q,roomId);
      const runs=(await q('SELECT * FROM player_runs WHERE room_id=$1 AND is_owner=1',[roomId])).rows;
      for(const run of runs){
        if(run.product_id)await q('INSERT INTO player_attempts (run_id,account_id,product_id,completed_at) VALUES ($1,$2,$3,$4) ON CONFLICT(run_id) DO NOTHING',[run.id,run.account_id,run.product_id,now()]);
        if(!run.result_status){await q('UPDATE player_runs SET score=$1,result_status=$2,elapsed_seconds=$3 WHERE room_id=$4 AND room_user_id=$5 AND result_status IS NULL',[grade.score,grade.result_status,elapsedValue??room.duration_seconds,roomId,run.room_user_id]);}
      }
    };
    return existingQuery?work(existingQuery):transaction(work);
  }
  async function settleAccount(accountId){
    const runs=(await query('SELECT room_id FROM player_runs WHERE account_id=$1 AND is_owner=1',[accountId])).rows;
    for(const run of runs){const room=await roomSync(run.room_id);if(room?.state==='finished')await finalizeRoom(room.id);}
  }
  async function control(accountId,id,action,options={}) {
    if(!['start','pause','resume','finish'].includes(action))fail(400,'Неизвестное действие');
    const identity=await ownRun(accountId,id);if(!identity.is_owner)fail(403,'Управлять игрой может создавший её игрок');
    await roomSync(identity.room_id);
    return transaction(async q=>{
      await q('UPDATE rooms SET name=name WHERE id=$1',[identity.room_id]);
      const run=await ownRun(accountId,id,q);
      if(action==='start'){
        if(run.state!=='pending')fail(409,'Начать можно только ещё не запущенную комнату');
        const product=await one(q,'SELECT max_attempts FROM player_products WHERE id=$1',[run.product_id]);
        const used=Number((await one(q,'SELECT COUNT(*) AS total FROM player_attempts WHERE account_id=$1 AND product_id=$2',[accountId,run.product_id])).total);
        const extra=Number((await one(q,'SELECT COALESCE(SUM(amount),0) AS total FROM player_attempt_credits WHERE account_id=$1 AND product_id=$2',[accountId,run.product_id])).total);
        if(!product||used>=Number(product.max_attempts)+extra)fail(409,'Все попытки использованы');
        await q(`UPDATE rooms SET state='running',game_start_time=$1,game_end_time=$2,paused_at=NULL,halfway_paused=TRUE WHERE id=$3`,[now(),new Date(Date.now()+run.duration_seconds*1000).toISOString(),run.room_id]);
      }else if(action==='pause'){
        if(run.state!=='running')fail(409,'Поставить на паузу можно только идущую игру');
        await q(`UPDATE rooms SET state='paused',paused_at=$1 WHERE id=$2 AND state='running'`,[now(),run.room_id]);
      }else if(action==='resume'){
        if(run.state!=='paused')fail(409,'Игра сейчас не на паузе');
        const seconds=remainingSeconds(run);if(seconds<=0)fail(409,'Время игры истекло');
        await q(`UPDATE rooms SET state='running',game_end_time=$1,paused_at=NULL WHERE id=$2 AND state='paused'`,[new Date(Date.now()+seconds*1000).toISOString(),run.room_id]);
      }else{
        if(run.state==='finished'){await finalizeRoom(run.room_id,q);return run;}
        if(options.confirmed!==true)fail(400,'Подтвердите досрочное завершение');
        const link=await one(q,'SELECT answers_submitted FROM shared_rooms WHERE room_id=$1',[run.room_id]);
        if(link){if(!link.answers_submitted)fail(409,'Сначала отправьте командные ответы на вопросы');}else{const questions=await shared.activeQuestions(run,q);const answers=(await q('SELECT question_id FROM question_answers WHERE room_user_id=$1',[run.room_user_id])).rows;if(!questions.length||!questions.every(question=>answers.some(answer=>Number(answer.question_id)===Number(question.id))))fail(409,'Сначала отправьте ответы на все вопросы');}
        if(!['running','paused'].includes(run.state))fail(409,'Игра ещё не началась');
        const duration=elapsed(run);
        await q(`UPDATE rooms SET state='finished',game_end_time=$1,paused_at=NULL WHERE id=$2`,[now(),run.room_id]);
        await finalizeRoom(run.room_id,q,duration);
      }
      return ownRun(accountId,id,q);
    });
  }
  async function history(accountId) {
    const rows=(await query(`SELECT g.*,r.state,r.name AS team_name,r.scenario_id,r.duration_seconds,r.game_start_time,r.game_end_time,r.paused_at,p.title,p.max_attempts FROM player_runs g JOIN rooms r ON r.id=g.room_id LEFT JOIN player_products p ON p.id=g.product_id WHERE g.account_id=$1 ORDER BY g.created_at DESC`,[accountId])).rows;
    for(const run of rows){
      const room=await roomSync(run.room_id);run.state=room.state;
      if(room.state==='finished'){
        await finalizeRoom(room.id);
        Object.assign(run,await one(query,'SELECT score,result_status,elapsed_seconds FROM player_runs WHERE id=$1',[run.id]));
      }
      const link=await one(query,'SELECT invite_token,answers_submitted FROM shared_rooms WHERE room_id=$1',[run.room_id]);
      if(link){run.shared=true;if(room.state!=='finished')run.invite_path='/room#'+link.invite_token;run.can_finish=!!link.answers_submitted&&['running','paused'].includes(room.state);}
      if(room.state!=='finished')run.elapsed_seconds=elapsed(room);
      run.remaining_seconds=remainingSeconds(room);run.is_owner=!!run.is_owner;run.scoring=await scoring.publicSummary(room.id);
      if(!run.title){const scenario=await one(query,'SELECT name FROM scenarios WHERE id=$1',[run.scenario_id]);run.title=scenario?.name||'Расследование';}
    }const ranked=await scoring.firstRuns(accountId);for(const run of rows)run.ranked=ranked.has(run.id);return rows;
  }
  async function profile(accountId){
    const games=await history(accountId);const products=await catalog(accountId);
    const rankings=await scoring.rankings();const rating=Number(rankings.find(r=>r.id===accountId)?.rating||0);
    return {games,products,bundles:await bundles(),orders:(await query('SELECT id,title,amount,status,created_at FROM player_orders WHERE account_id=$1 ORDER BY created_at DESC',[accountId])).rows,
      stats:{played:games.filter(g=>g.state==='finished'&&g.game_start_time).length,purchased:products.filter(p=>p.owned&&p.price>0).length,rating,rank:rating>0?1+rankings.filter(r=>Number(r.rating)>rating).length:null,total_players:rankings.length},local_mode:localMode};
  }
  async function result(accountId,id){let run=await ownRun(accountId,id);await roomSync(run.room_id);await finalizeRoom(run.room_id);run=await ownRun(accountId,id);if(run.state!=='finished')fail(409,'Разбор доступен после завершения');if(!run.game_start_time)return {run,cancelled:true,scoring:null,ranked:false,solution:null,rating_rule:'Комната закрыта до запуска. Попытка не использована.'};const product=await one(query,'SELECT solution FROM player_products WHERE id=$1',[run.product_id]);return {run,scoring:await scoring.publicSummary(run.room_id),ranked:(await scoring.firstRuns(accountId)).has(run.id),solution:product?.solution||null,rating_rule:'Гонорар учитывает качество ответов и поездки. В общий рейтинг входит только первое завершённое прохождение каждого платного дела: до 2000 рейтинговых баллов за дело. Демо и повторные прохождения не меняют рейтинг.'};}
  const admin=require('./playerAdmin').createPlayerAdmin({query,transaction,roomSync,remainingSeconds,finalizeRoom,scoring});
  scoring.setFinalizer(finalizeRoom);
  shared.setScoring(scoring);
  shared.setFinalizer(finalizeRoom);
  return {scoring,admin,shared,finalizeRoom,init,register,login,authenticate,logout,updateAccount,requestReset,resetPassword,catalog,bundles,purchase,start,join,enter,control,history,profile,result};
}
module.exports={createPlayerCabinet,SESSION_MS};
