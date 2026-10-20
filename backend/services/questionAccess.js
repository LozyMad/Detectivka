// Use elapsed game time: pauses freeze the delay, and extra time does not reset it.
function questionAccess(room, now = Date.now()) {
  const delay = Math.max(0, Number(room?.questions_delay_seconds) || 0);
  if (room?.is_test || room?.duration_seconds === 0 || !delay) return { is_open: true, remaining_seconds: 0, delay_seconds: delay };
  let elapsed = 0;
  if (room.state !== 'pending' && room.game_end_time) {
    const reference = room.state === 'paused' ? new Date(room.paused_at).getTime() : now;
    const remaining = Math.max(0, Math.ceil((new Date(room.game_end_time).getTime() - reference) / 1000));
    elapsed = Math.max(0, Number(room.duration_seconds) - remaining);
  }
  const remaining = Math.max(0, delay - elapsed);
  return { is_open: remaining === 0, remaining_seconds: remaining, delay_seconds: delay };
}

const STANDARD_QUESTION_DELAY_SECONDS = 15 * 60;
function newRoomQuestionDelay(durationSeconds, isTest = false) {
  if (isTest) return 0;
  if (!Number.isFinite(Number(durationSeconds)) || Number(durationSeconds) <= STANDARD_QUESTION_DELAY_SECONDS) {
    const error = new Error('Длительность расследования должна быть больше 15 минут, чтобы осталось время на ответы');
    error.status = 400;
    throw error;
  }
  return STANDARD_QUESTION_DELAY_SECONDS;
}

module.exports = { questionAccess, newRoomQuestionDelay, STANDARD_QUESTION_DELAY_SECONDS };
