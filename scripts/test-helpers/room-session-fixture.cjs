const fs = require('node:fs');
const vm = require('node:vm');
const express = require('../../backend/node_modules/express');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const secret = 'isolated-room-session-test-secret';

function roomSessionFixture() {
  const rooms = new Map(), attempts = [];
  const admin = { id: 99, username: 'Fixture admin', password: 'fixture-password', is_admin: true, admin_level: 'super_admin' };
  const User = { findById: async id => id === admin.id ? admin : null,
    findByUsername: async username => username === admin.username ? admin : null,
    verifyPassword: (given, expected) => given === expected };
  const Room = { getById: async id => rooms.get(Number(id)),
    create: async data => { const room = { id: 14 + rooms.size, ...data, state: 'running' }; rooms.set(room.id, room); return room; } };
  const RoomUser = { verifyCredentials: async (id, username, password) => rooms.has(Number(id)) && password === 'fixture-password'
    ? { id: Number(id) + 1, username } : null,
    listByRoom: async () => [], add: async data => ({ id: data.room_id + 1, ...data }) };
  const Scenario = { getById: async id => Number(id) === 12 ? { id: 12, name: 'Ставка на молчание' } : null,
    getActive: async () => ({ id: 12 }) };
  const dependencies = { jsonwebtoken: jwt, express, crypto: require('node:crypto'),
    '../models/user': User, '../models/room': Room, '../models/roomUser': RoomUser, '../models/scenario': Scenario,
    '../models/address': { findByScenarioAndAddress: async (id, district, house, apartment) =>
      house === '31' ? { id: 50, district, house_number: house, apartment, description: 'Материал поездки' } : null },
    '../models/addressBook': { ensureSeeded: async () => {}, findNamesByAddress: async () => [] },
    '../models/visitAttempt': { create: async data => { const attempt = { id: attempts.length + 1, ...data }; attempts.push(attempt); return attempt; } },
    '../models/visitedLocation': { visitLocation: async () => ({ visit: { id: 51 }, alreadyVisited: false }) },
    '../sse/roomEvents': { broadcastNewTrip() {} },
    '../services/roomTimer': { syncRoomTimer: id => Room.getById(id) } };
  function load(path) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path, 'utf8'), { module, process: { env: { JWT_SECRET: secret } }, console,
      require(name) { if (!(name in dependencies)) throw new Error(`Unexpected fixture dependency: ${name}`); return dependencies[name]; }
    }, { filename: path });
    return module.exports;
  }
  const auth = load('backend/middleware/auth.js');
  dependencies['../middleware/auth'] = auth;
  dependencies['../controllers/authController'] = load('backend/controllers/authController.js');
  dependencies['../controllers/roomAuthController'] = load('backend/controllers/roomAuthController.js');
  const room = load('backend/controllers/roomController.js'), game = load('backend/controllers/gameController.js');
  const app = express(); app.use(express.json());
  app.use('/api/auth', load('backend/routes/auth.js'));
  app.post('/api/rooms', auth.authenticateToken, auth.adminRequired, room.createRoom);
  app.post('/api/rooms/:room_id/test-login', auth.authenticateToken, auth.adminRequired, room.enterTestRoom);
  app.post('/api/game/visit', auth.authenticateToken, game.visitLocation);
  return { app, auth, rooms, attempts, secret, jwt, Room, admin, authenticateToken: auth.authenticateToken };
}
module.exports = { roomSessionFixture };
