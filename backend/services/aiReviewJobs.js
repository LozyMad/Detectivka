'use strict';

const {randomUUID} = require('node:crypto');
const {createYandexGrader} = require('./yandexGrading');

function createAiReviewJobs({query, transaction, applyResult, settleExpired, grader = createYandexGrader(), clock = Date.now}) {
  let timer = null, busy = false;
  async function init() {
    await query(`CREATE TABLE IF NOT EXISTS player_ai_reviews (
      room_id INTEGER PRIMARY KEY REFERENCES player_room_scoring(room_id) ON DELETE CASCADE,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, expected_revision INTEGER NOT NULL,
      rubric_version TEXT NOT NULL, model_uri TEXT NOT NULL, payload TEXT NOT NULL,
      result TEXT, usage TEXT, error_code TEXT, lease_token TEXT, lease_until BIGINT,
      next_attempt_at BIGINT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await query('CREATE INDEX IF NOT EXISTS idx_player_ai_review_queue ON player_ai_reviews(status,next_attempt_at)');
  }
  async function enqueue(q, roomId, revision, questions, answers) {
    if (!grader.config.enabled || !questions.length || questions.some(item => !item.ai_rule)) return;
    await q(`INSERT INTO player_ai_reviews (room_id,status,expected_revision,rubric_version,model_uri,payload,next_attempt_at,created_at,updated_at)
      VALUES ($1,'queued',$2,$3,$4,$5,$6,$7,$7) ON CONFLICT(room_id) DO NOTHING`,
    [roomId, revision, questions[0].ai_rule.version, grader.config.modelUri,
      JSON.stringify({questions, answers}), clock(), new Date(clock()).toISOString()]);
  }
  async function claim() {
    return transaction(async q => {
      const time = clock();
      await q("UPDATE player_ai_reviews SET status='needs_review',error_code='AI_LEASE_EXHAUSTED',updated_at=$1 WHERE status='processing' AND lease_until<$2 AND attempts>=3", [new Date(time).toISOString(), time]);
      const job = (await q(`SELECT * FROM player_ai_reviews WHERE attempts<3 AND
        ((status='queued' AND next_attempt_at<=$1) OR (status='processing' AND lease_until<$1))
        ORDER BY next_attempt_at,room_id LIMIT 1`, [time])).rows[0];
      if (!job) return null;
      const token = randomUUID();
      return (await q(`UPDATE player_ai_reviews SET status='processing',attempts=attempts+1,lease_token=$1,lease_until=$2,updated_at=$3
        WHERE room_id=$4 AND attempts=$5 AND ((status='queued' AND next_attempt_at<=$6) OR (status='processing' AND lease_until<$6)) RETURNING *`,
      [token, time + 300000, new Date(time).toISOString(), job.room_id, job.attempts, time])).rows[0] || null;
    });
  }
  async function tick() {
    if (busy || !grader.config.enabled) return;
    busy = true;
    let job;
    try {
      if(settleExpired)await settleExpired();
      job = await claim();
      if (!job) return;
      const scoring = (await query('SELECT revision,review_status FROM player_room_scoring WHERE room_id=$1', [job.room_id])).rows[0];
      if (!scoring || scoring.review_status !== 'pending_review' || scoring.revision !== job.expected_revision) {
        await query("UPDATE player_ai_reviews SET status='superseded',lease_token=NULL,lease_until=NULL,updated_at=$1 WHERE room_id=$2 AND lease_token=$3", [new Date(clock()).toISOString(), job.room_id, job.lease_token]);
        return;
      }
      const payload = JSON.parse(job.payload);
      // Retrying a job must not silently switch the model used for that job.
      if (job.model_uri !== grader.config.modelUri) throw Object.assign(new Error('AI_MODEL_CHANGED'), {code: 'AI_MODEL_CHANGED'});
      const empty = payload.answers.every(a => !String(a.answer_text || '').trim());
      const result = empty ? {grades: payload.questions.map(q => ({question_id: Number(q.id), matched: [], grade: 0, comment: 'Ответ не дан.', needs_review: false, review_reason: ''})), usage: {}, model: 'local-empty-answers'} : await grader.grade(payload);
      await transaction(async q => {
        // The same room lock is used by organizer edits and score publication.
        await q('UPDATE rooms SET name=name WHERE id=$1', [job.room_id]);
        const current = (await q('SELECT * FROM player_ai_reviews WHERE room_id=$1 AND lease_token=$2 AND status=\'processing\'', [job.room_id, job.lease_token])).rows[0];
        if (!current) return;
        const applied = await applyResult(q, job, result);
        await q('UPDATE player_ai_reviews SET status=$1,result=$2,usage=$3,error_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=$4 WHERE room_id=$5 AND lease_token=$6',
          [applied, JSON.stringify(result), JSON.stringify(result.usage), new Date(clock()).toISOString(), job.room_id, job.lease_token]);
      });
    } catch (error) {
      if (job) {
        const code = /^AI_[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'AI_INTERNAL_ERROR';
        const retry = error.retryable === true && job.attempts < 3;
        await query('UPDATE player_ai_reviews SET status=$1,error_code=$2,lease_token=NULL,lease_until=NULL,next_attempt_at=$3,updated_at=$4 WHERE room_id=$5 AND lease_token=$6',
          [retry ? 'queued' : 'needs_review', code, clock() + (job.attempts === 1 ? 30000 : 120000), new Date(clock()).toISOString(), job.room_id, job.lease_token]);
      } else throw error;
    } finally { busy = false; }
  }
  function start() {
    if (timer || !grader.config.enabled) return;
    const run = () => tick().catch(() => console.error('[AI grading] Queue unavailable; saved answers remain pending review.'));
    timer = setInterval(run, 2000);
    timer.unref?.();
    run();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  async function summary(roomId) {
    const job = (await query('SELECT status FROM player_ai_reviews WHERE room_id=$1', [roomId])).rows[0];
    if (!job) return null;
    return {status: ['queued', 'processing'].includes(job.status) ? 'processing' : job.status};
  }
  return {init, enqueue, tick, start, stop, summary, enabled: grader.config.enabled};
}

module.exports = {createAiReviewJobs};
