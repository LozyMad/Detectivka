'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { newRoomQuestionDelay } = require('./questionAccess');

const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const now = () => new Date().toISOString();
const nameKey = value => value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\s+/g,' ').trim();
const one = async (q, sql, values = []) => (await q(sql, values)).rows[0];
const text = (value, max, label, required = false) => {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(400, label);
  return value.trim();
};

function createGameHouses({ query, transaction, shared, scoring, finalizeRoom, remainingSeconds }) {
  let ready = false;
  async function init() {
    await query(`CREATE TABLE IF NOT EXISTS game_houses (
      id TEXT PRIMARY KEY, public_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      scenario_id INTEGER NOT NULL REFERENCES scenarios(id), created_by INTEGER NOT NULL,
      format TEXT NOT NULL, scheduled_at TEXT, venue TEXT NOT NULL DEFAULT '',
      duration_seconds INTEGER NOT NULL, questions_delay_seconds INTEGER NOT NULL,
      pause_halfway INTEGER NOT NULL DEFAULT 0, halfway_paused INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'pending', game_start_time TEXT, game_end_time TEXT, paused_at TEXT,
      revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`);
    await query(`CREATE TABLE IF NOT EXISTS house_teams (
      room_id INTEGER PRIMARY KEY REFERENCES rooms(id), house_id TEXT NOT NULL REFERENCES game_houses(id),
      name TEXT NOT NULL, name_key TEXT NOT NULL, participants TEXT NOT NULL DEFAULT '', UNIQUE(house_id, name_key))`);
    await query('CREATE INDEX IF NOT EXISTS idx_house_teams_house ON house_teams(house_id)');
    await query(`CREATE TABLE IF NOT EXISTS house_operations (
      id TEXT PRIMARY KEY, house_id TEXT NOT NULL REFERENCES game_houses(id), admin_id INTEGER NOT NULL,
      payload TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL)`);
    await query(`CREATE TABLE IF NOT EXISTS house_archives (
      house_id TEXT PRIMARY KEY REFERENCES game_houses(id) ON DELETE CASCADE, archived_at TEXT NOT NULL)`);
    await query(`CREATE TABLE IF NOT EXISTS house_deletions (
      house_id TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, request_key TEXT NOT NULL,
      payload TEXT NOT NULL, deleted_at TEXT NOT NULL)`);
    ready = true;
  }
  const staff = admin => { if (!admin?.is_admin) fail(403, 'Нужны права организатора'); };
  async function access(admin, id, q = query) {
    staff(admin);
    const house = await one(q, 'SELECT * FROM game_houses WHERE id=$1', [id]);
    if (!house || (admin.admin_level !== 'super_admin' && Number(house.created_by) !== Number(admin.id))) fail(404, 'Дом не найден или недоступен');
    return house;
  }
  async function scenarioAccess(admin, id, q) {
    const scenario = await one(q, 'SELECT * FROM scenarios WHERE id=$1', [id]);
    if (!scenario) fail(404, 'Дело не найдено');
    if (admin.admin_level !== 'super_admin' && Number(scenario.created_by) !== Number(admin.id) &&
      !await one(q, 'SELECT id FROM admin_scenario_permissions WHERE admin_id=$1 AND scenario_id=$2', [admin.id, id])) fail(403, 'Нет доступа к делу');
  }
  function settings(body) {
    const name = text(body.name, 120, 'Название дома: от 1 до 120 символов', true);
    const scenario_id = Number(body.scenario_id);
    if (!Number.isSafeInteger(scenario_id) || scenario_id < 1) fail(400, 'Выберите дело');
    const duration_seconds = body.timer_disabled === true ? 0 : Number(body.duration_seconds ?? 7200);
    if (!Number.isInteger(duration_seconds) || duration_seconds < 0 || duration_seconds > 86400 || (duration_seconds === 0 && body.timer_disabled !== true)) fail(400, 'Длительность: больше 15 минут и не более 24 часов');
    const standardDelay = duration_seconds ? newRoomQuestionDelay(duration_seconds) : 0;
    const questions_delay_seconds = body.questions_immediate === true ? 0 : standardDelay;
    if (!['online', 'offline'].includes(body.format || 'online')) fail(400, 'Неизвестный формат игры');
    let scheduled_at = null;
    if (body.scheduled_at) {
      const date = new Date(body.scheduled_at);
      if (!Number.isFinite(date.getTime())) fail(400, 'Некорректная дата игры');
      scheduled_at = date.toISOString();
    }
    return { name, scenario_id, duration_seconds, questions_delay_seconds, format: body.format || 'online',
      scheduled_at, venue: text(body.venue ?? '', 250, 'Место: до 250 символов'), pause_halfway: body.pause_halfway === true ? 1 : 0 };
  }
  function key(body) {
    if (typeof body.request_key !== 'string' || !/^[\w-]{16,100}$/.test(body.request_key)) fail(400, 'Некорректный идентификатор запроса');
    return body.request_key;
  }
  async function remember(q, admin, houseId, body, action, work) {
    // Compare retries without storing agency passwords in the operation journal.
    const id = key(body), payload = crypto.createHash('sha256').update(JSON.stringify({ action, body })).digest('hex');
    const old = await one(q, 'SELECT * FROM house_operations WHERE id=$1', [id]);
    if (old) {
      if (old.house_id !== houseId || Number(old.admin_id) !== Number(admin.id) || old.payload !== payload) fail(409, 'Идентификатор запроса уже использован');
      return JSON.parse(old.result);
    }
    const result = await work();
    await q('INSERT INTO house_operations (id,house_id,admin_id,payload,result,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [id, houseId, admin.id, payload, JSON.stringify(result), now()]);
    return result;
  }
  async function locked(admin, id, body, action, work) {
    await access(admin, id);
    await sync(id);
    return transaction(async q => {
      // All house mutations acquire this lock before touching its rooms.
      await q('UPDATE game_houses SET revision=revision WHERE id=$1', [id]);
      const house = await access(admin, id, q);
      return remember(q, admin, id, body, action, async () => {
        if (!Number.isInteger(body.revision) || body.revision !== Number(house.revision)) fail(409, 'Дом изменился. Обновите данные перед повторным действием');
        const result = await work(q, house);
        await q('UPDATE game_houses SET revision=revision+1 WHERE id=$1', [id]);
        return result;
      });
    });
  }
  async function create(admin, body = {}) {
    staff(admin); key(body); const config = settings(body);
    return transaction(async q => {
      const old = await one(q, 'SELECT house_id FROM house_operations WHERE id=$1', [body.request_key]);
      if (old) return remember(q, admin, old.house_id, body, 'create', async () => {});
      await scenarioAccess(admin, config.scenario_id, q);
      const id = crypto.randomUUID(), public_id = crypto.randomBytes(18).toString('base64url');
      await q(`INSERT INTO game_houses (id,public_id,name,scenario_id,created_by,format,scheduled_at,venue,duration_seconds,questions_delay_seconds,pause_halfway,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id,public_id,config.name,config.scenario_id,admin.id,config.format,config.scheduled_at,config.venue,config.duration_seconds,config.questions_delay_seconds,config.pause_halfway,now()]);
      return remember(q, admin, id, body, 'create', async () => ({ id }));
    });
  }
  async function update(admin, id, body = {}) {
    const config = settings(body);
    return locked(admin, id, body, 'settings', async (q, house) => {
      if (house.state !== 'pending') fail(409, 'Настройки дома можно менять только до старта');
      await scenarioAccess(admin, config.scenario_id, q);
      await q(`UPDATE game_houses SET name=$1,scenario_id=$2,format=$3,scheduled_at=$4,venue=$5,duration_seconds=$6,questions_delay_seconds=$7,pause_halfway=$8 WHERE id=$9`,
        [config.name,config.scenario_id,config.format,config.scheduled_at,config.venue,config.duration_seconds,config.questions_delay_seconds,config.pause_halfway,id]);
      await q('UPDATE rooms SET scenario_id=$1 WHERE id IN (SELECT room_id FROM house_teams WHERE house_id=$2)', [config.scenario_id,id]);
      await mirror(q, { ...house, ...config });
      return { ok: true };
    });
  }
  function password(value) {
    if (typeof value !== 'string' || value.length < 4 || Buffer.byteLength(value, 'utf8') > 72) fail(400, 'Пароль: от 4 символов и не более 72 байт');
    return value;
  }
  async function addTeam(admin, id, body = {}) {
    const name = text(body.name, 80, 'Название агентства: от 1 до 80 символов', true);
    const participants = text(body.participants ?? '', 40, 'Количество участников: до 40 символов');
    const hash = await bcrypt.hash(password(body.password), 10);
    return locked(admin, id, body, 'add_team', async (q, house) => {
      if (house.state !== 'pending') fail(409, 'Агентства добавляются до старта дома');
      if (await one(q, 'SELECT room_id FROM house_teams WHERE house_id=$1 AND name_key=$2', [id,nameKey(name)])) fail(409, 'Агентство с таким названием уже есть в доме');
      const room = await one(q, `INSERT INTO rooms (name,scenario_id,created_by,duration_seconds,questions_delay_seconds,is_test,state) VALUES ($1,$2,$3,$4,$5,FALSE,'pending') RETURNING *`, [name,house.scenario_id,house.created_by,house.duration_seconds,house.questions_delay_seconds]);
      const product = await one(q,'SELECT id FROM player_products WHERE scenario_id=$1 AND published=1 ORDER BY price DESC,id LIMIT 1',[house.scenario_id]);
      const link = await shared.provision(q, room, null, admin.id, product?.id);
      await q('UPDATE room_users SET password=$1 WHERE id=$2', [hash,link.room_user_id]);
      await q('INSERT INTO house_teams (room_id,house_id,name,name_key,participants) VALUES ($1,$2,$3,$4,$5)', [room.id,id,name,nameKey(name),participants]);
      return { room_id: room.id };
    });
  }
  async function editTeam(admin, id, roomId, body = {}) {
    const name = text(body.name, 80, 'Название агентства: от 1 до 80 символов', true);
    const participants = text(body.participants ?? '', 40, 'Количество участников: до 40 символов');
    const hash = body.password ? await bcrypt.hash(password(body.password),10) : null;
    return locked(admin, id, body, 'edit_team:' + roomId, async (q, house) => {
      if (house.state === 'finished') fail(409, 'Дом уже завершён');
      const team = await one(q, 'SELECT * FROM house_teams WHERE room_id=$1 AND house_id=$2', [roomId,id]);
      if (!team) fail(404, 'Агентство не найдено');
      if (house.state !== 'pending' && name !== team.name) fail(409, 'Название агентства можно менять только до старта');
      const duplicate = await one(q, 'SELECT room_id FROM house_teams WHERE house_id=$1 AND name_key=$2 AND room_id<>$3', [id,nameKey(name),roomId]);
      if (duplicate) fail(409, 'Агентство с таким названием уже есть');
      await q('UPDATE house_teams SET name=$1,name_key=$2,participants=$3 WHERE room_id=$4', [name,nameKey(name),participants,roomId]);
      await q('UPDATE rooms SET name=$1 WHERE id=$2', [name,roomId]);
      await q('UPDATE room_users SET username=$1 WHERE id=(SELECT room_user_id FROM shared_rooms WHERE room_id=$2)', [name,roomId]);
      if (hash) await q('UPDATE room_users SET password=$1 WHERE id=(SELECT room_user_id FROM shared_rooms WHERE room_id=$2)', [hash,roomId]);
      return { ok: true };
    });
  }
  async function removeTeam(admin, id, roomId, body = {}) {
    return locked(admin, id, body, 'remove_team:' + roomId, async (q, house) => {
      if (house.state !== 'pending') fail(409, 'Удалить агентство можно только до старта');
      const team = await one(q, 'SELECT room_id FROM house_teams WHERE house_id=$1 AND room_id=$2', [id,roomId]);
      if (!team) fail(404, 'Агентство не найдено');
      // Keep the closed room for audit; revoke every invitation and exclude it from the event.
      await q("UPDATE rooms SET state='finished',game_end_time=$1 WHERE id=$2", [now(),roomId]);
      await q('DELETE FROM house_teams WHERE room_id=$1', [roomId]);
      return { ok: true };
    });
  }
  async function mirror(q, house) {
    await q(`UPDATE rooms SET state=$1,duration_seconds=$2,questions_delay_seconds=$3,game_start_time=$4,game_end_time=$5,paused_at=$6,halfway_paused=TRUE
      WHERE id IN (SELECT room_id FROM house_teams WHERE house_id=$7) AND state<>'finished'`,
      [house.state,house.duration_seconds,house.questions_delay_seconds,house.game_start_time,house.game_end_time,house.paused_at,house.id]);
  }
  async function sync(id) {
    let house = await one(query, 'SELECT * FROM game_houses WHERE id=$1', [id]);
    if (!house) return null;
    const deadline = house.game_end_time ? new Date(house.game_end_time).getTime() : null;
    const halfway = deadline - Number(house.duration_seconds) * 500;
    if (house.state === 'running' && deadline && (Date.now() >= deadline || (house.pause_halfway && !house.halfway_paused && Date.now() >= halfway))) {
      house = await transaction(async q => {
        await q('UPDATE game_houses SET revision=revision WHERE id=$1', [id]);
        const current = await one(q, 'SELECT * FROM game_houses WHERE id=$1', [id]);
        if (!current || current.state !== 'running' || !current.game_end_time) return current;
        const end = new Date(current.game_end_time).getTime(), half = end - Number(current.duration_seconds) * 500;
        if (current.pause_halfway && !current.halfway_paused && Date.now() >= half) {
          current.state = 'paused'; current.paused_at = new Date(half).toISOString(); current.halfway_paused = 1;
        } else if (Date.now() >= end) { current.state = 'finished'; current.paused_at = null; }
        else return current;
        await q('UPDATE game_houses SET state=$1,paused_at=$2,halfway_paused=$3,revision=revision+1 WHERE id=$4', [current.state,current.paused_at,current.halfway_paused,id]);
        current.revision++; await mirror(q,current); return current;
      });
    }
    return house;
  }
  async function syncRoom(roomId, current) {
    if (!ready) return null;
    const team = await one(query, 'SELECT house_id FROM house_teams WHERE room_id=$1', [roomId]);
    if (!team) return null;
    await sync(team.house_id);
    return { ...(current || {}), ...await one(query, 'SELECT r.*,s.name AS scenario_name FROM rooms r JOIN scenarios s ON s.id=r.scenario_id WHERE r.id=$1', [roomId]) };
  }
  async function control(admin, id, body = {}) {
    const action = body.action;
    if (!['start','pause','resume','add_time','finish'].includes(action)) fail(400, 'Неизвестное действие');
    return locked(admin,id,body,action,async(q,house) => {
      if (house.state === 'finished') fail(409, 'Дом уже завершён');
      const timestamp = now();
      if (action === 'start') {
        if (house.state !== 'pending') fail(409, 'Дом уже запущен');
        const teams = (await q('SELECT room_id FROM house_teams WHERE house_id=$1 ORDER BY room_id',[id])).rows;
        if (!teams.length) fail(409, 'Добавьте хотя бы одно агентство');
        // Capture the same current scoring conditions for every team under one transaction.
        await q('UPDATE scenarios SET name=name WHERE id=$1',[house.scenario_id]);
        const product = await one(q,'SELECT id FROM player_products WHERE scenario_id=$1 AND published=1 ORDER BY price DESC,id LIMIT 1',[house.scenario_id]);
        for (const team of teams) {
          await q('DELETE FROM player_room_scoring WHERE room_id=$1',[team.room_id]);
          await scoring.capture(q,team.room_id,product?.id);
        }
        house.state = 'running'; house.game_start_time = timestamp;
        house.game_end_time = house.duration_seconds ? new Date(Date.now()+house.duration_seconds*1000).toISOString() : null;
      } else if (action === 'pause') {
        if (house.state !== 'running') fail(409, 'Дом сейчас не запущен');
        house.state = 'paused'; house.paused_at = timestamp;
      } else if (action === 'resume') {
        if (house.state !== 'paused') fail(409, 'Дом сейчас не на паузе');
        const remaining = remainingSeconds(house);
        house.game_end_time = remaining === null ? null : new Date(Date.now()+remaining*1000).toISOString();
        house.state = 'running'; house.paused_at = null;
      } else if (action === 'add_time') {
        if (!house.duration_seconds) fail(400, 'Дом работает без таймера');
        if (!Number.isInteger(body.minutes) || body.minutes < 1 || body.minutes > 240) fail(400, 'Можно добавить от 1 до 240 минут');
        house.duration_seconds += body.minutes*60;
        if (house.game_end_time) house.game_end_time = new Date(new Date(house.game_end_time).getTime()+body.minutes*60000).toISOString();
      } else {
        if (body.confirmed !== true) fail(400, 'Подтвердите завершение всего дома');
        if (!['running','paused'].includes(house.state)) fail(409, 'Дом ещё не запущен');
        house.state = 'finished'; house.game_end_time = timestamp; house.paused_at = null;
      }
      await q('UPDATE game_houses SET state=$1,duration_seconds=$2,game_start_time=$3,game_end_time=$4,paused_at=$5 WHERE id=$6', [house.state,house.duration_seconds,house.game_start_time,house.game_end_time,house.paused_at,id]);
      await mirror(q,house);
      return { ok: true };
    });
  }
  async function archive(admin, id, body = {}) {
    if (typeof body.archived !== 'boolean') fail(400, 'Укажите, нужно ли архивировать дом');
    return locked(admin, id, body, 'archive', async q => {
      if (body.archived) await q('INSERT INTO house_archives (house_id,archived_at) VALUES ($1,$2) ON CONFLICT(house_id) DO NOTHING', [id,now()]);
      else await q('DELETE FROM house_archives WHERE house_id=$1', [id]);
      return { ok: true, archived: body.archived };
    });
  }
  async function remove(admin, id, body = {}) {
    staff(admin); key(body);
    if (body.confirmed !== true) fail(400, 'Подтвердите удаление дома');
    const payload = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const prior = async q => {
      const receipt = await one(q, 'SELECT * FROM house_deletions WHERE house_id=$1', [id]);
      if (!receipt) return false;
      if (Number(receipt.admin_id) !== Number(admin.id) || receipt.request_key !== body.request_key || receipt.payload !== payload) fail(404, 'Дом не найден или недоступен');
      return true;
    };
    if (await prior(query)) return { ok: true, deleted: true };
    await access(admin, id); await sync(id);
    return transaction(async q => {
      await q('UPDATE game_houses SET revision=revision WHERE id=$1', [id]);
      if (await prior(q)) return { ok: true, deleted: true };
      const house = await access(admin, id, q);
      if (body.revision !== Number(house.revision)) fail(409, 'Дом изменился. Обновите данные перед удалением');
      if (!['pending','finished'].includes(house.state)) fail(409, 'Сначала завершите игру во всём доме');
      const timestamp = now();
      const teams = (await q('SELECT room_id FROM house_teams WHERE house_id=$1', [id])).rows;
      for (const team of teams) {
        await q("UPDATE rooms SET state='finished',game_end_time=COALESCE(game_end_time,$1) WHERE id=$2", [timestamp,team.room_id]);
        await q('INSERT INTO room_archives (room_id,archived_at) VALUES ($1,$2) ON CONFLICT(room_id) DO NOTHING', [team.room_id,timestamp]);
        await q('UPDATE shared_rooms SET invite_token=$1 WHERE room_id=$2', [crypto.randomBytes(32).toString('base64url'),team.room_id]);
      }
      await q('DELETE FROM house_teams WHERE house_id=$1', [id]);
      await q('DELETE FROM house_operations WHERE house_id=$1', [id]);
      await q('DELETE FROM house_archives WHERE house_id=$1', [id]);
      await q('DELETE FROM game_houses WHERE id=$1', [id]);
      await q('INSERT INTO house_deletions (house_id,admin_id,request_key,payload,deleted_at) VALUES ($1,$2,$3,$4,$5)', [id,admin.id,body.request_key,payload,timestamp]);
      return { ok: true, deleted: true };
    });
  }
  async function list(admin, archived = false) {
    staff(admin);
    const houses = (await query('SELECT h.*,s.name AS scenario_name,a.archived_at FROM game_houses h JOIN scenarios s ON s.id=h.scenario_id LEFT JOIN house_archives a ON a.house_id=h.id ORDER BY h.created_at DESC')).rows
      .filter(h => (admin.admin_level === 'super_admin' || Number(h.created_by) === Number(admin.id)) && Boolean(h.archived_at) === archived);
    const items = [];
    for (const house of houses) {
      const current = await sync(house.id);
      if (!current) continue;
      Object.assign(house,current);
      house.team_count = Number((await one(query,'SELECT COUNT(*) AS n FROM house_teams WHERE house_id=$1',[house.id])).n);
      house.remaining_seconds = remainingSeconds(house); house.invite_path = '/house/' + house.public_id;
      items.push(house);
    }
    return { items };
  }
  async function detail(admin,id) {
    await access(admin,id); const house = await sync(id);
    if (!house) fail(404, 'Дом не найден или недоступен');
    house.archived_at = (await one(query, 'SELECT archived_at FROM house_archives WHERE house_id=$1', [id]))?.archived_at || null;
    const teams = (await query(`SELECT t.*,r.state,h.answers_submitted,f.review_status,f.fee,f.points,f.max_points,f.trips
      FROM house_teams t JOIN rooms r ON r.id=t.room_id JOIN shared_rooms h ON h.room_id=r.id
      LEFT JOIN player_room_scoring f ON f.room_id=r.id WHERE t.house_id=$1 ORDER BY t.room_id`,[id])).rows;
    for (const team of teams) if (team.state === 'finished') await finalizeRoom(team.room_id);
    // Finalization can publish an automatic result, so read the standings afterwards.
    for (const team of teams) Object.assign(team,await one(query,'SELECT review_status,fee,points,max_points,trips FROM player_room_scoring WHERE room_id=$1',[team.room_id]));
    teams.sort((a,b) => (b.fee !== null && b.fee !== undefined ? b.fee : -1) - (a.fee !== null && a.fee !== undefined ? a.fee : -1) || a.room_id-b.room_id);
    const final = house.state === 'finished' && teams.every(t => t.review_status === 'graded');
    for (const team of teams) {
      team.place = team.review_status === 'graded' ? 1+teams.filter(t => t.review_status === 'graded' && Number(t.fee)>Number(team.fee)).length : null;
      team.invite_path = '/house/'+house.public_id+'?team='+team.room_id;
    }
    const scenario = await one(query,'SELECT name FROM scenarios WHERE id=$1',[house.scenario_id]);
    return { house: { ...house, scenario_name: scenario?.name, remaining_seconds:remainingSeconds(house),invite_path:'/house/'+house.public_id }, teams, standings_final:final };
  }
  async function publicInfo(publicId) {
    const found = await one(query,'SELECT id FROM game_houses WHERE public_id=$1',[publicId]);
    if (!found) fail(404,'Игра не найдена');
    const house = await sync(found.id);
    if (!house) fail(404,'Игра не найдена');
    const scenario = await one(query,'SELECT name FROM scenarios WHERE id=$1',[house.scenario_id]);
    return { house: { name:house.name,scenario_name:scenario?.name,state:house.state,format:house.format,scheduled_at:house.scheduled_at,venue:house.venue,remaining_seconds:remainingSeconds(house) },
      teams:(await query('SELECT t.room_id,t.name,r.state FROM house_teams t JOIN rooms r ON r.id=t.room_id WHERE t.house_id=$1 ORDER BY t.name',[house.id])).rows };
  }
  async function join(publicId,body={}) {
    const found = await one(query,'SELECT id FROM game_houses WHERE public_id=$1',[publicId]);
    if (!found) fail(404,'Игра не найдена');
    await sync(found.id);
    const team = await one(query,`SELECT r.*,u.id AS team_user_id,u.username,u.password FROM house_teams t JOIN rooms r ON r.id=t.room_id JOIN shared_rooms h ON h.room_id=r.id JOIN room_users u ON u.id=h.room_user_id WHERE t.house_id=$1 AND t.room_id=$2`,[found.id,Number(body.room_id)||0]);
    if (!team || typeof body.password !== 'string' || body.password.length > 100 || !await bcrypt.compare(body.password,team.password)) fail(401,'Неверное агентство или пароль');
    const token = jwt.sign({ room_user_id:team.team_user_id,room_id:team.id,username:team.username,scenario_id:team.scenario_id,role:'room_user' },process.env.JWT_SECRET||'your-secret-key',{expiresIn:'24h'});
    const result = { token,room:{id:team.id,name:team.name,scenario_id:team.scenario_id,duration_seconds:team.duration_seconds,is_test:false,shared:true,house:true},
      user:{id:team.team_user_id,username:team.username,room_id:team.id},shared_access:{is_owner:false,run_id:null,invite_path:'/house/'+publicId+'?team='+team.id} };
    if (team.state === 'finished') result.finished = true;
    return result;
  }
  async function membership(roomId,q=query) {
    if (!ready) return null;
    return one(q,'SELECT t.house_id,h.state AS house_state,h.public_id FROM house_teams t JOIN game_houses h ON h.id=t.house_id WHERE t.room_id=$1',[roomId]);
  }
  return { init,create,update,list,detail,archive,remove,addTeam,editTeam,removeTeam,control,publicInfo,join,syncRoom,membership };
}
module.exports = { createGameHouses };
