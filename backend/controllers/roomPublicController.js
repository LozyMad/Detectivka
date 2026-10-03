const { remainingSeconds, syncRoomTimer } = require('../services/roomTimer');

const getRoomState = async (req, res) => {
  try {
    const { room_id } = req.params;
    const room = await syncRoomTimer(room_id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const state = room.is_test ? 'running' : (room.state || 'pending');
    const remaining = remainingSeconds(room);
    
    const response = {
      room: {
        id: room.id,
        name: room.name,
        scenario_id: room.scenario_id,
        scenario_name: room.scenario_name,
        game_start_time: room.game_start_time,
        game_end_time: room.game_end_time,
        paused_at: room.paused_at,
        halfway_paused: !!room.halfway_paused,
        duration_seconds: room.duration_seconds,
        is_test: !!room.is_test
      },
      scenario_name: room.scenario_name, // Добавляем scenario_name на верхний уровень
      state,
      remaining
    };
    
    res.json(response);
  } catch (error) {
    console.error('Get room state error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { getRoomState };



