'use strict';

const {createAiReviewJobs} = require('./aiReviewJobs');
const {configured, freezeScenarioRubric} = require('./scenarioAiGrading');
const {validateGrades} = require('./yandexGrading');

function fail(status, message) {
  throw Object.assign(new Error(message), {status});
}

function createIndividualAiReviews({query, transaction, roomSync, postgres, grader}) {
  const one = async (q, sql, params) => (await q(sql, params)).rows[0];
  const jobs = createAiReviewJobs({query, transaction, individual: true, settleExpired: enqueueFinished,
    ...(grader ? {grader} : {}),
    applyResult: async (_q, job, result) => {
      const {questions, answers} = JSON.parse(job.payload);
      const grades = validateGrades(result, questions, answers);
      return grades.some(grade => grade.needs_review) ? 'needs_review' : 'completed';
    }
  });

  function available(room) {
    return jobs.enabled && !room?.is_shared && configured(room?.scenario_id);
  }

  async function init() {
    await query(`CREATE TABLE IF NOT EXISTS player_individual_ai_checks (
      id ${postgres ? 'SERIAL' : 'INTEGER'} PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      room_user_id INTEGER NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
      scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 0, review_status TEXT NOT NULL DEFAULT 'pending_review',
      payload TEXT NOT NULL, UNIQUE(room_user_id,scenario_id))`);
    await jobs.init();
  }

  function findCheck(q, identity, scenarioId) {
    return one(q, `SELECT c.*, j.status, j.result, j.error_code FROM player_individual_ai_checks c
      LEFT JOIN player_individual_ai_jobs j ON j.review_id=c.id
      WHERE c.room_id=$1 AND c.room_user_id=$2 AND c.scenario_id=$3`, [identity.room_id, identity.id, scenarioId]);
  }

  async function member(q, identity) {
    if (!identity?.room_id || !identity.id) fail(403, 'Войдите в комнату');
    const room = await one(q, 'SELECT r.* FROM rooms r JOIN room_users u ON u.room_id=r.id WHERE r.id=$1 AND u.id=$2', [identity.room_id, identity.id]);
    if (!room || room.is_shared) fail(403, 'Нет доступа к отдельной команде');
    return room;
  }

  async function enqueue(q, check) {
    const {questions, answers} = JSON.parse(check.payload);
    await jobs.enqueue(q, check.id, check.revision, questions, answers);
  }

  async function enqueueFinished() {
    const waiting = (await query(`SELECT c.* FROM player_individual_ai_checks c JOIN rooms r ON r.id=c.room_id
      WHERE r.scenario_id=c.scenario_id AND (r.is_test=TRUE OR r.state='finished' OR (r.state='running' AND r.game_end_time<=$1))
        AND NOT EXISTS (SELECT 1 FROM player_individual_ai_jobs j WHERE j.review_id=c.id)
      ORDER BY c.id LIMIT 25`, [new Date().toISOString()])).rows;
    for (const check of waiting) {
      const room = await roomSync(check.room_id);
      if (room && (room.is_test || room.state === 'finished')) await transaction(q => enqueue(q, check));
    }
  }

  async function submit(identity) {
    await member(query, identity);
    await roomSync(identity.room_id);
    return transaction(async q => {
      await q('UPDATE rooms SET name=name WHERE id=$1', [identity.room_id]);
      const room = await member(q, identity);
      if (!available(room)) return {available: false};
      if (!room.is_test && !room.game_start_time) fail(409, 'Игра ещё не началась');
      const old = await findCheck(q, identity, room.scenario_id);
      if (old) return {available: true, test: !!room.is_test};
      const questions = (await q(`SELECT a.id,a.question_text,c.criteria FROM questions a
        LEFT JOIN scenario_question_criteria c ON c.scenario_id=a.scenario_id AND c.question_id=a.id
        WHERE a.scenario_id=$1 AND a.is_active=TRUE ORDER BY a.question_order,a.id`, [room.scenario_id])).rows;
      const frozen = freezeScenarioRubric(room.scenario_id, questions);
      if (!frozen) return {available: false};
      const saved = (await q('SELECT question_id,answer_text FROM question_answers WHERE room_user_id=$1 ORDER BY id', [identity.id])).rows;
      const byQuestion = new Map(saved.map(a => [Number(a.question_id), a.answer_text]));
      if (!frozen.every(question => byQuestion.has(Number(question.id)))) fail(409, 'Сначала отправьте ответы на все вопросы');
      const answers = frozen.map(question => ({question_id: Number(question.id), answer_text: byQuestion.get(Number(question.id))}));
      const check = await one(q, `INSERT INTO player_individual_ai_checks (room_id,room_user_id,scenario_id,payload)
        VALUES ($1,$2,$3,$4) RETURNING *`, [room.id, identity.id, room.scenario_id, JSON.stringify({questions: frozen, answers})]);
      if (room.is_test || room.state === 'finished') await enqueue(q, check);
      return {available: true, test: !!room.is_test};
    });
  }

  function grades(check, includeDraft) {
    if (!check?.result || (!includeDraft && check.status !== 'completed')) return [];
    const {questions, answers} = JSON.parse(check.payload);
    const result = JSON.parse(check.result);
    return questions.map(question => {
      const id = Number(question.id);
      return {...result.grades.find(g => g.question_id === id), question_text: question.question_text,
        answer_text: answers.find(a => a.question_id === id)?.answer_text || '', correct_answer: question.ai_rule.answer};
    });
  }

  async function result(identity) {
    const room = await member(query, identity);
    if (!room.is_test && room.state !== 'finished') fail(409, 'Разбор откроется после окончания игры');
    const check = await findCheck(query, identity, room.scenario_id);
    if (!check) fail(404, 'Для этой команды нет отправленного бланка на ИИ-проверке');
    const published = grades(check, false);
    const status = check.status === 'completed' ? 'completed' :
      ['needs_review', 'superseded'].includes(check.status) ? 'needs_review' : 'processing';
    const trips = await one(query, 'SELECT COUNT(*) AS n FROM visit_attempts WHERE room_id=$1 AND user_id=$2', [room.id, identity.id]);
    return {room: {id: room.id, name: room.name}, score_only: true, test: !!room.is_test, ranked: false,
      scoring: {ai_review: {status}, points: status === 'completed' ? published.reduce((sum, g) => sum + g.grade, 0) : null,
        max_points: JSON.parse(check.payload).questions.length * 5, trips: Number(trips.n), grades: published}};
  }

  async function organizerSummary(room, roomUserId) {
    const check = await findCheck(query, {room_id: room.id, id: roomUserId}, room.scenario_id);
    if (!check) return null;
    return {status: check.status || 'waiting', error_code: check.error_code, grades: grades(check, true)};
  }

  return {init, available, submit, result, organizerSummary, start: jobs.start};
}

module.exports = {createIndividualAiReviews};
