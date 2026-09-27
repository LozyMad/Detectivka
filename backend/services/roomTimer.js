const Room = require('../models/room');

function remainingSeconds(room, now = new Date()) {
  if (!room || room.is_test || !room.game_end_time) return null;
  if (room.state === 'finished') return 0;
  if (room.state === 'pending') return null;
  const until = room.state === 'paused' && room.paused_at
    ? new Date(room.paused_at)
    : now;
  return Math.max(0, Math.ceil((new Date(room.game_end_time) - until) / 1000));
}

async function syncRoomTimer(roomId, room = null) {
  const current = room || await Room.getById(roomId);
  if (!current || current.is_test || current.state !== 'running' || !current.game_end_time) return current;

  const now = Date.now();
  const end = new Date(current.game_end_time).getTime();
  const halfwayMs = (Number(current.duration_seconds) || 3600) * 500;

  // Freeze at the exact halfway point, even if the next request arrives later.
  if (!current.halfway_paused && now >= end - halfwayMs) {
    await Room.pauseGame(roomId, new Date(end - halfwayMs).toISOString(), true);
    return Room.getById(roomId);
  }
  if (now >= end) {
    await Room.finishIfRunning(roomId, new Date(now).toISOString());
    return Room.getById(roomId);
  }
  return current;
}

module.exports = { remainingSeconds, syncRoomTimer };
