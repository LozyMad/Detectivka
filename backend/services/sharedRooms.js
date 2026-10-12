const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fail = (status, message, data) => { const e=new Error(message);e.status=status;e.data=data;e.code=data?.code;throw e; };
const now=()=>new Date().toISOString();
function createSharedRooms({query,transaction,postgres=false,roomSync,remainingSeconds}) {
  const one=async(q,sql,params=[]) => (await q(sql,params)).rows[0];
  let finalize=async()=>{};
  async function init(){
    try {await query(`ALTER TABLE rooms ADD COLUMN is_shared ${postgres?'BOOLEAN NOT NULL DEFAULT FALSE':'INTEGER NOT NULL DEFAULT 0'}`);}catch(e){if(e.code!=='42701'&&!String(e.message).includes('duplicate column'))throw e;}
    await query(`CREATE TABLE IF NOT EXISTS shared_rooms (room_id INTEGER PRIMARY KEY REFERENCES rooms(id),room_user_id INTEGER NOT NULL REFERENCES room_users(id),invite_token TEXT UNIQUE NOT NULL,owner_account_id TEXT REFERENCES player_accounts(id),admin_id INTEGER,notes TEXT NOT NULL DEFAULT '',notes_revision INTEGER NOT NULL DEFAULT 0,answers_submitted INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)`);
    await query(`CREATE TABLE IF NOT EXISTS shared_answer_drafts (room_id INTEGER NOT NULL REFERENCES rooms(id),question_id INTEGER NOT NULL REFERENCES questions(id),answer_text TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(room_id,question_id))`);
  }
  async function provision(q,room,ownerAccountId=null,adminId=null){
    const old=await one(q,'SELECT * FROM shared_rooms WHERE room_id=$1',[room.id]);if(old)return old;
    const player=await one(q,'INSERT INTO room_users (room_id,username,password) VALUES ($1,$2,$3) RETURNING id',[room.id,room.name,await bcrypt.hash(crypto.randomBytes(32).toString('hex'),10)]);
    const record={room_id:room.id,room_user_id:player.id,invite_token:crypto.randomBytes(32).toString('base64url'),owner_account_id:ownerAccountId,admin_id:adminId,created_at:now()};
    await q('INSERT INTO shared_rooms (room_id,room_user_id,invite_token,owner_account_id,admin_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)',Object.values(record));
    await q('UPDATE rooms SET is_shared=TRUE,halfway_paused=TRUE WHERE id=$1',[room.id]);return record;
  }
  async function adminInvite(roomId,admin){
    return transaction(async q=>{
      await q('UPDATE rooms SET name=name WHERE id=$1',[roomId]);
      const room=await one(q,'SELECT * FROM rooms WHERE id=$1',[roomId]);
      if(!room)fail(404,'Комната не найдена');
      if(Number(room.created_by)!==Number(admin.id)&&admin.admin_level!=='super_admin')fail(403,'Нет доступа к комнате');
      if(!room.is_test&&room.state==='finished')fail(409,'Игра в этой комнате завершена. Повторный вход закрыт.',{code:'ROOM_FINISHED'});
      if(room.is_test)fail(400,'В тестовых комнатах используется вход организатора');
      let link=await one(q,'SELECT * FROM shared_rooms WHERE room_id=$1',[roomId]);
      if(!link){
        if(room.state!=='pending')fail(409,'Ссылку можно создать только для ещё не запущенной комнаты');
        if(Number((await one(q,'SELECT COUNT(*) AS count FROM room_users WHERE room_id=$1',[roomId])).count))fail(409,'В комнате уже есть отдельные команды. Создайте новую общую комнату');
        link=await provision(q,room,null,admin.id);
      }
      return {invite_path:'/room#'+link.invite_token,room_id:room.id};
    });
  }
  async function join(inviteToken,account=null){
    if(typeof inviteToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(inviteToken))fail(404,'Ссылка комнаты недействительна');
    const shared=await one(query,'SELECT * FROM shared_rooms WHERE invite_token=$1',[inviteToken]);if(!shared)fail(404,'Ссылка комнаты недействительна');
    return identity(shared.room_id,account);
  }
  async function identity(roomId,account=null){
    const link=await one(query,'SELECT * FROM shared_rooms WHERE room_id=$1',[roomId]);if(!link)fail(404,'Общая комната не найдена');
    const room=await roomSync(roomId);if(!room)fail(404,'Комната больше не существует');
    if(room.state==='finished'){await finalize(roomId);fail(403,'Игра в этой комнате завершена. Повторный вход закрыт.',{code:'ROOM_FINISHED'});}
    const user=await one(query,'SELECT id,username FROM room_users WHERE id=$1 AND room_id=$2',[link.room_user_id,roomId]);if(!user)fail(404,'Команда больше не существует');
    const owner=!!account&&link.owner_account_id===account.id;
    const run=owner?await one(query,'SELECT id FROM player_runs WHERE account_id=$1 AND room_id=$2',[account.id,roomId]):null;
    const token=jwt.sign({room_user_id:user.id,room_id:room.id,username:user.username,scenario_id:room.scenario_id,role:'room_user'},process.env.JWT_SECRET||'your-secret-key',{expiresIn:'24h'});
    return {token,room:{id:room.id,name:room.name,scenario_id:room.scenario_id,scenario_name:room.scenario_name,duration_seconds:room.duration_seconds,is_test:false,shared:true},user:{...user,room_id:room.id},shared_access:{is_owner:owner,run_id:run?.id||null,invite_path:'/room#'+link.invite_token}};
  }
  async function authorize(identity,q=query){
    if(!identity?.room_id||!identity?.id)fail(403,'Войдите в комнату по приглашению');
    const shared=await one(q,'SELECT * FROM shared_rooms WHERE room_id=$1 AND room_user_id=$2',[identity.room_id,identity.id]);if(!shared)fail(403,'Нет доступа к общей комнате');return shared;
  }
  async function activeQuestions(room,q=query){return (await q('SELECT id,question_text FROM questions WHERE scenario_id=$1 AND is_active=TRUE ORDER BY question_order,id',[room.scenario_id])).rows;}
  async function snapshot(identity){
    const link=await authorize(identity);const room=await roomSync(link.room_id);if(!room)fail(404,'Комната не найдена');
    if(room.state==='finished'){await finalize(room.id);fail(403,'Игра в этой комнате завершена. Повторный вход закрыт.',{code:'ROOM_FINISHED'});}
    const questions=room.state==='pending'?[]:await activeQuestions(room);
    const drafts=(await query('SELECT question_id,answer_text,revision FROM shared_answer_drafts WHERE room_id=$1',[room.id])).rows;
    const answers=(await query('SELECT question_id,answer_text FROM question_answers WHERE room_user_id=$1 ORDER BY id',[link.room_user_id])).rows;
    const saved=new Map(answers.map(a=>[Number(a.question_id),a.answer_text]));
    const result=room.state==='finished'?await one(query,'SELECT g.score,g.result_status,p.solution FROM player_runs g LEFT JOIN player_products p ON p.id=g.product_id WHERE g.room_id=$1 AND g.is_owner=1',[room.id]):null;
    return {result:result||null,room:{id:room.id,name:room.name,state:room.state,duration_seconds:room.duration_seconds,remaining:remainingSeconds(room)},notes:link.notes,notes_revision:link.notes_revision,answers_submitted:!!link.answers_submitted,can_finish:!!link.answers_submitted&&['running','paused'].includes(room.state),questions:questions.map(question=>{const draft=drafts.find(d=>Number(d.question_id)===Number(question.id));return {...question,answer_text:link.answers_submitted?(saved.get(Number(question.id))||''):(draft?.answer_text||''),revision:draft?.revision||0};})};
  }
  async function lock(q,identity){
    await q('UPDATE rooms SET name=name WHERE id=$1',[identity.room_id]);const link=await authorize(identity,q);const room=await one(q,'SELECT * FROM rooms WHERE id=$1',[identity.room_id]);if(!room)fail(404,'Комната не найдена');if(room.state==='finished')fail(403,'Игра в этой комнате завершена. Повторный вход закрыт.',{code:'ROOM_FINISHED'});return {link,room};
  }
  async function saveNotes(identity,body){
    if(typeof body.text!=='string'||body.text.length>30000||!Number.isInteger(body.revision)||body.revision<0)fail(400,'Некорректные заметки');
    await roomSync(identity.room_id);
    return transaction(async q=>{const {link,room}=await lock(q,identity);if(room.state==='finished')fail(409,'Дело уже завершено');if(Number(link.notes_revision)!==body.revision)fail(409,'Заметки изменены другим участником. Ваш текст сохранён в браузере',{current:{text:link.notes,revision:link.notes_revision}});await q('UPDATE shared_rooms SET notes=$1,notes_revision=notes_revision+1 WHERE room_id=$2',[body.text,room.id]);return {text:body.text,revision:body.revision+1};});
  }
  async function saveDraft(identity,body){
    if(!Number.isSafeInteger(Number(body.question_id))||typeof body.text!=='string'||body.text.length>10000||!Number.isInteger(body.revision)||body.revision<0)fail(400,'Некорректный ответ');
    await roomSync(identity.room_id);
    return transaction(async q=>{const {link,room}=await lock(q,identity);if(room.state!=='running')fail(409,'Ответы можно менять только во время игры');if(link.answers_submitted)fail(409,'Ответы уже отправлены командой');const questions=await activeQuestions(room,q);if(!questions.some(r=>Number(r.id)===Number(body.question_id)))fail(403,'Вопрос не относится к этому делу');const old=await one(q,'SELECT * FROM shared_answer_drafts WHERE room_id=$1 AND question_id=$2',[room.id,Number(body.question_id)]);if(Number(old?.revision||0)!==body.revision)fail(409,'Ответ изменён другим участником. Проверьте обе версии',{current:{text:old.answer_text,revision:old.revision}});const revision=body.revision+1;await q('INSERT INTO shared_answer_drafts (room_id,question_id,answer_text,revision) VALUES ($1,$2,$3,$4) ON CONFLICT(room_id,question_id) DO UPDATE SET answer_text=excluded.answer_text,revision=excluded.revision',[room.id,Number(body.question_id),body.text,revision]);return {text:body.text,revision};});
  }
  async function submitAnswers(identity,body){
    if(!Array.isArray(body.answers)||body.answers.length>200)fail(400,'Некорректные ответы');
    await roomSync(identity.room_id);
    return transaction(async q=>{const {link,room}=await lock(q,identity);if(link.answers_submitted)return {submitted:true};if(room.state!=='running')fail(409,'Отправить ответы можно только во время игры');const questions=await activeQuestions(room,q);if(!questions.length)fail(409,'В деле пока нет вопросов');if(body.answers.length!==questions.length||new Set(body.answers.map(a=>Number(a.question_id))).size!==questions.length)fail(400,'Отправьте ответы на все вопросы одним бланком');
      for(const question of questions){const answer=body.answers.find(a=>Number(a.question_id)===Number(question.id));if(!answer||typeof answer.text!=='string'||answer.text.length>10000||!Number.isInteger(answer.revision))fail(400,'Некорректный ответ');const draft=await one(q,'SELECT revision FROM shared_answer_drafts WHERE room_id=$1 AND question_id=$2',[room.id,question.id]);if(Number(draft?.revision||0)!==answer.revision)fail(409,'Кто-то изменил ответы. Обновите бланк перед отправкой');const existing=await one(q,'SELECT id FROM question_answers WHERE room_user_id=$1 AND question_id=$2',[link.room_user_id,question.id]);if(existing)await q('UPDATE question_answers SET answer_text=$1 WHERE id=$2',[answer.text,existing.id]);else await q('INSERT INTO question_answers (question_id,room_user_id,answer_text) VALUES ($1,$2,$3)',[question.id,link.room_user_id,answer.text]);}
      await q('UPDATE shared_rooms SET answers_submitted=1 WHERE room_id=$1',[room.id]);return {submitted:true};
    });
  }
  return {init,provision,adminInvite,join,identity,authorize,activeQuestions,snapshot,saveNotes,saveDraft,submitAnswers,setFinalizer(fn){finalize=fn;}};
}
module.exports={createSharedRooms};
