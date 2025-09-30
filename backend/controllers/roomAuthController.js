const jwt = require('jsonwebtoken');
const Room = require('../models/room');
const RoomUser = require('../models/roomUser');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const roomLogin = async (req, res) => {
  try {
    const { room_id, username, password } = req.body;
    if (!room_id || !username || !password) {
      return res.status(400).json({ error: 'room_id, username and password required' });
    }
    const room = await Room.getById(room_id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const user = await RoomUser.verifyCredentials(room_id, username, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { room_user_id: user.id, room_id: room_id, username, scenario_id: room.scenario_id, role: 'room_user' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({
      token,
      room: { id: room.id, name: room.name, scenario_id: room.scenario_id, start_time: room.start_time, duration_seconds: room.duration_seconds },
      user: { id: user.id, username }
    });
  } catch (error) {
    console.error('Room login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { roomLogin };





