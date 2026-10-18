// Use elapsed game time: pauses freeze the delay, and extra time does not reset it.
function questionAccess(room, now = Date.now()) {
  const delay = Math.max(0, Number(room?.questions_delay_seconds) || 0);
  if (room?.is_test || !delay) return { is_open: true, remaining_seconds: 0, delay_seconds: delay };
  let elapsed = 0;
  if (room.state !== 'pending' && room.game_end_time) {
    const reference = room.state === 'paused' ? new Date(room.paused_at).getTime() : now;
    const remaining = Math.max(0, Math.ceil((new Date(room.game_end_time).getTime() - reference) / 1000));
    elapsed = Math.max(0, Number(room.duration_seconds) - remaining);
  }
  const remaining = Math.max(0, delay - elapsed);
  return { is_open: remaining === 0, remaining_seconds: remaining, delay_seconds: delay };
}

function parseQuestionDelay(value, durationSeconds) {
  const minutes = value === undefined || value === null || value === '' ? 0 : Number(value);
  if (typeof value === 'boolean' || !Number.isSafeInteger(minutes) || minutes < 0 ||
      !Number.isSafeInteger(minutes * 60) || (minutes > 0 && minutes * 60 >= Number(durationSeconds))) {
    const error = new Error('Время до открытия вопросов должно быть целым числом минут от 0 и меньше длительности игры');
    error.status = 400;
    throw error;
  }
  return minutes * 60;
}

module.exports = { questionAccess, parseQuestionDelay };
