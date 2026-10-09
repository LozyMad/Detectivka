const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('../backend/node_modules/express');
const sqlite3 = require('../backend/node_modules/sqlite3');
const bcrypt = require('../backend/node_modules/bcryptjs');
const jwt = require('../backend/node_modules/jsonwebtoken');

async function fixture(t, dialect) {
  const db = new sqlite3.Database(':memory:');
  const query = (sql, values = []) => new Promise((resolve, reject) =>
    db.all(sql, values, (error, rows) => error ? reject(error) : resolve({rows})));
  await query('CREATE TABLE rooms (id INTEGER PRIMARY KEY, name TEXT, scenario_id INTEGER, is_test BOOLEAN DEFAULT FALSE, state TEXT)');
  await query(`CREATE TABLE room_users (id INTEGER PRIMARY KEY, room_id INTEGER, username TEXT, password TEXT,
    UNIQUE(room_id,username))`);
  const dependencies = { '../config/database': {db,query}, bcryptjs: bcrypt, jsonwebtoken: jwt,
    crypto: require('node:crypto'), '../models/scenario': {}, '../services/roomTimer': {} };
  const load = file => {
    const module = {exports:{}};
    vm.runInNewContext(fs.readFileSync(file,'utf8'), {module, console, process:{env:{DB_TYPE:'sqlite',JWT_SECRET:'room-login-tests'}},
      require(name) {if (!(name in dependencies)) throw new Error('Unexpected dependency '+name);return dependencies[name];}});
    return module.exports;
  };
  // Exercise both models' parameterized SQL and credential matching against isolated tables.
  const RoomUser = load(dialect === 'sqlite' ? 'backend/models/roomUser.js' : 'backend/models/roomUserPostgreSQL.js');
  const Room = {getById: async id => (await query('SELECT * FROM rooms WHERE id=?',[id])).rows[0]};
  Object.assign(dependencies, {'../models/roomUser':RoomUser,'../models/room':Room});
  const app = express();app.use(express.json());
  app.post('/login',load('backend/controllers/roomAuthController.js').roomLogin);
  app.post('/rooms/:room_id/users',load('backend/controllers/roomController.js').addRoomUser);
  const server = await new Promise(resolve => {const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await new Promise(resolve=>db.close(resolve));});
  const post = (route,body) => fetch(`http://127.0.0.1:${server.address().port}${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const addRoom = (id,isTest=0,state='pending') => query('INSERT INTO rooms VALUES (?,?,?,?,?)',[id,'Room '+id,id+100,isTest,state]);
  const addTeam = (id,username,password) => RoomUser.add({room_id:id,username,password});
  return {query,post,addRoom,addTeam};
}

for (const dialect of ['sqlite','postgresql']) {
  test(`${dialect}: two fields choose the correct room and issue its canonical identity`,async t=>{
    const f=await fixture(t,dialect);await f.addRoom(1);await f.addRoom(2,0,'finished');await f.addRoom(3,1);
    await f.addTeam(1,'Шляпники','first-password');const target=await f.addTeam(2,'Шляпники','second-password');
    await f.addTeam(3,'Шляпники','second-password');
    const response=await f.post('/login',{username:'  Шляпники  ',password:'second-password'});
    assert.equal(response.status,200);const data=await response.json();
    assert.equal(data.room.id,2);assert.equal(data.user.id,target.id);assert.equal(data.user.room_id,2);
    const claims=jwt.verify(data.token,'room-login-tests');assert.equal(claims.room_id,2);assert.equal(claims.scenario_id,102);
    assert.equal(claims.room_user_id,target.id);assert.equal(claims.username,'Шляпники');assert.equal(data.user.password,undefined);
    assert.equal((await f.post('/login',{username:'Шляпники',password:'wrong-password'})).status,401);
    assert.equal((await f.post('/login',{username:'Нет команды',password:'second-password'})).status,401);
    assert.equal((await f.post('/login',{username:['Шляпники'],password:'second-password'})).status,400);
    assert.equal((await f.post('/login',{username:'Шляпники',password:123})).status,400);
    const legacy=await f.post('/login',{room_id:1,username:'Шляпники',password:'first-password'});
    assert.equal(legacy.status,200);assert.equal((await legacy.json()).room.id,1);
  });
  test(`${dialect}: duplicate credentials never select an arbitrary room and test rooms cannot log in`,async t=>{
    const f=await fixture(t,dialect);await f.addRoom(1);await f.addRoom(2);await f.addRoom(3,1);
    await f.addTeam(1,'Детективы','same-password');await f.addTeam(2,'Детективы','same-password');await f.addTeam(3,'Тест','test-password');
    const r=await f.post('/login',{username:'Детективы',password:'same-password'});assert.equal(r.status,409);
    const data=await r.json();assert.equal(data.code,'TEAM_LOGIN_AMBIGUOUS');assert.equal(data.token,undefined);
    assert.equal((await f.post('/login',{username:'Тест',password:'test-password'})).status,401);
    assert.equal((await f.post('/login',{room_id:3,username:'Тест',password:'test-password'})).status,403);
  });
  test(`${dialect}: organizer can reuse a team name with a different password and duplicate pairs are rejected`,async t=>{
    const f=await fixture(t,dialect);await f.addRoom(1);await f.addRoom(2);await f.addTeam(1,'Команда','first-password');
    const duplicate=await f.post('/rooms/2/users',{username:'  Команда  ',password:'first-password'});
    assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).code,'TEAM_CREDENTIALS_IN_USE');
    assert.equal((await f.query('SELECT * FROM room_users')).rows.length,1);
    const creation=await f.post('/rooms/2/users',{username:'  Команда  ',password:'second-password'});assert.equal(creation.status,201);
    assert.equal((await creation.json()).user.username,'Команда');
    const login=await f.post('/login',{username:'Команда',password:'second-password'});assert.equal(login.status,200);assert.equal((await login.json()).room.id,2);
  });
}
