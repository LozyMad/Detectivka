const Room = require('../models/room');
const RoomUser = require('../models/roomUser');
const Scenario = require('../models/scenario');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

async function canUseScenario(user, scenarioId) {
  if (user.admin_level === 'super_admin') return true;
  const AdminPermission = require('../models/adminPermission');
  return AdminPermission.hasPermission(user.id, scenarioId);
}

const createRoom = async (req, res) => {
  try {
    const { name, scenario_id, duration_seconds, is_test } = req.body;
    if (!name || !scenario_id) {
      return res.status(400).json({ error: 'Name and scenario_id required' });
    }
    
    // Проверяем доступ к сценарию (если не супер-админ)
    if (!await canUseScenario(req.user, scenario_id)) {
      return res.status(403).json({ error: 'Access denied to this scenario' });
    }
    
    // Получаем информацию о сценарии
    const scenario = await Scenario.getById(scenario_id);
    if (!scenario) {
      return res.status(400).json({ error: 'Scenario not found' });
    }
    
    const room = await Room.create({ name, scenario_id, created_by: req.user.id, duration_seconds, is_test: is_test === true });
    
    // Возвращаем комнату с названием сценария
    res.status(201).json({ 
      room: {
        ...room,
        scenario_name: scenario.name
      }
    });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const changeTestRoomScenario = async (req, res) => {
  try {
    const room = await Room.getById(req.params.room_id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (!room.is_test || room.created_by !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    const { scenario_id } = req.body;
    const scenario = await Scenario.getById(scenario_id);
    if (!scenario) return res.status(400).json({ error: 'Scenario not found' });
    if (!await canUseScenario(req.user, scenario_id)) return res.status(403).json({ error: 'Access denied to this scenario' });
    await Room.updateTestScenario(room.id, scenario_id);
    res.json({ room: { ...room, scenario_id: scenario.id, scenario_name: scenario.name } });
  } catch (error) {
    console.error('Change test room scenario error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const enterTestRoom = async (req, res) => {
  try {
    const room = await Room.getById(req.params.room_id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (!room.is_test || room.created_by !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const username = `Тестировщик ${req.user.id}`;
    const users = await RoomUser.listByRoom(room.id);
    let testUser = users.find(user => user.username === username);
    if (!testUser) {
      testUser = await RoomUser.add({ room_id: room.id, username, password: crypto.randomBytes(32).toString('hex') });
    }
    const token = jwt.sign(
      { room_user_id: testUser.id, room_id: room.id, username, scenario_id: room.scenario_id, role: 'room_user' },
      process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '24h' }
    );
    res.json({
      token,
      room: { id: room.id, name: room.name, scenario_id: room.scenario_id, scenario_name: room.scenario_name, is_test: true },
      user: { id: testUser.id, username, room_id: room.id }
    });
  } catch (error) {
    console.error('Enter test room error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const listRooms = async (req, res) => {
  try {
    const rooms = await Room.listByAdmin(req.user.id);
    res.json({ rooms });
  } catch (error) {
    console.error('List rooms error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const addRoomUser = async (req, res) => {
  try {
    const { room_id } = req.params;
    const room = await Room.getById(room_id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.is_test) return res.status(400).json({ error: 'Test room players enter from the admin panel' });
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const record = await RoomUser.add({ room_id, username, password });
    res.status(201).json({ user: record });
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT') {
      return res.status(400).json({ error: 'User with this username already exists in room' });
    }
    console.error('Add room user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const listRoomUsers = async (req, res) => {
  try {
    const { room_id } = req.params;
    const users = await RoomUser.listByRoom(room_id);
    res.json({ users });
  } catch (error) {
    console.error('List room users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const removeRoomUser = async (req, res) => {
  try {
    const { user_id } = req.params;
    await RoomUser.remove(user_id);
    res.json({ message: 'Room user removed' });
  } catch (error) {
    console.error('Remove room user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const startRoomTimer = async (req, res) => {
  try {
    const { room_id } = req.params;
    const room = await Room.getById(room_id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.is_test) return res.status(400).json({ error: 'Test rooms have no timer' });
    if (room.state === 'running') return res.status(400).json({ error: 'Game already running' });
    
    const result = await Room.startGame(room_id);
    res.json({ room: result });
  } catch (error) {
    console.error('Start room timer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const pauseRoomTimer = async (req, res) => {
  try {
    const { room_id } = req.params;
    const room = await Room.getById(room_id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.is_test) return res.status(400).json({ error: 'Test rooms have no timer' });
    if (room.state !== 'running') return res.status(400).json({ error: 'Game not running' });
    
    const result = await Room.pauseGame(room_id);
    res.json({ room: result });
  } catch (error) {
    console.error('Pause room timer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const resumeRoomTimer = async (req, res) => {
  try {
    const { room_id } = req.params;
    const room = await Room.getById(room_id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.is_test) return res.status(400).json({ error: 'Test rooms have no timer' });
    if (room.state !== 'paused') return res.status(400).json({ error: 'Game not paused' });
    
    const result = await Room.resumeGame(room_id);
    res.json({ room: result });
  } catch (error) {
    console.error('Resume room timer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const stopRoomTimer = async (req, res) => {
  try {
    const { room_id } = req.params;
    const room = await Room.getById(room_id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.is_test) return res.status(400).json({ error: 'Test rooms have no timer' });
    
    const result = await Room.stopGame(room_id);
    res.json({ room: result });
  } catch (error) {
    console.error('Stop room timer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteRoom = async (req, res) => {
  try {
    const { room_id } = req.params;
    const room = await Room.getById(room_id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    
    // Проверяем, что комната принадлежит текущему админу
    if (room.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const result = await Room.delete(room_id);
    res.json({ message: 'Room deleted successfully', room: result });
  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createRoom,
  changeTestRoomScenario,
  enterTestRoom,
  listRooms,
  addRoomUser,
  listRoomUsers,
  removeRoomUser,
  startRoomTimer,
  pauseRoomTimer,
  resumeRoomTimer,
  stopRoomTimer,
  deleteRoom
};


