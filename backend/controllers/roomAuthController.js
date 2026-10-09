const jwt = require('jsonwebtoken');
const Room = require('../models/room');
const RoomUser = require('../models/roomUser');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const roomLogin = async (req, res) => {
  try {
    const { room_id, password } = req.body || {};
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!username || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Введите название команды и пароль' });
    }
    let room, user;
    // Keep existing clients working while the player form switches to two fields.
    if (room_id !== undefined && room_id !== null && room_id !== '') {
      if (!Number.isSafeInteger(Number(room_id)) || Number(room_id) < 1) {
        return res.status(400).json({ error: 'Некорректная комната' });
      }
      room = await Room.getById(Number(room_id));
      if (!room) return res.status(404).json({ error: 'Room not found' });
      if (room.is_test) return res.status(403).json({ error: 'Enter test rooms from the admin panel' });
      user = await RoomUser.verifyCredentials(room.id, username, password);
    } else {
      const matches = await RoomUser.findByCredentials(username, password);
      if (matches.length > 1) {
        return res.status(409).json({ code: 'TEAM_LOGIN_AMBIGUOUS',
          error: 'Эти название команды и пароль используются в нескольких комнатах. Обратитесь к организатору за другими данными для входа.' });
      }
      user = matches[0];
      if (user) room = await Room.getById(user.room_id);
    }
    if (!user || !room || room.is_test) return res.status(401).json({ error: 'Неверное название команды или пароль' });

    const token = jwt.sign(
      { room_user_id: user.id, room_id: room.id, username: user.username, scenario_id: room.scenario_id, role: 'room_user' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({
      token,
      room: { id: room.id, name: room.name, scenario_id: room.scenario_id, start_time: room.start_time, duration_seconds: room.duration_seconds },
      user: { id: user.id, username: user.username, room_id: room.id }
    });
  } catch (error) {
    console.error('Room login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { roomLogin };





