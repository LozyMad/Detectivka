const Room = require('../models/room');

const getRoomState = async (req, res) => {
  try {
    const { room_id } = req.params;
    const room = await Room.getById(room_id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    
    let state = room.state || 'pending';
    let remaining = null;
    
    if (state === 'running' && room.game_start_time && room.game_end_time) {
      const now = new Date();
      const endTime = new Date(room.game_end_time);
      remaining = Math.max(0, Math.floor((endTime - now) / 1000));
      
      if (remaining <= 0) {
        state = 'finished';
        remaining = 0;
        // Update room state to finished
        const { db } = require('../config/database');
        db.run(`UPDATE rooms SET state = 'finished' WHERE id = ?`, [room_id]);
      }
    } else if (state === 'paused' && room.game_start_time && room.game_end_time) {
      // При паузе показываем оставшееся время до конца игры
      const now = new Date();
      const endTime = new Date(room.game_end_time);
      remaining = Math.max(0, Math.floor((endTime - now) / 1000));
    } else if (state === 'finished') {
      remaining = 0;
    }
    
    res.json({
      room: {
        id: room.id,
        name: room.name,
        scenario_id: room.scenario_id,
        scenario_name: room.scenario_name,
        game_start_time: room.game_start_time,
        game_end_time: room.game_end_time,
        duration_seconds: room.duration_seconds
      },
      state,
      remaining
    });
  } catch (error) {
    console.error('Get room state error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { getRoomState };



