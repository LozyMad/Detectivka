const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('../backend/node_modules/sqlite3');
const {randomUUID} = require('node:crypto');
const {rules, freezeRubric, VERSION} = require('../backend/services/borrowedTimeGrading');
const {createYandexGrader, validateGrades, readConfig, buildInstructions, ENDPOINT} = require('../backend/services/yandexGrading');
const {createPlayerScoring, calculateFee} = require('../backend/services/playerScoring');

const questions = () => rules.map((r, i) => ({id: 101 + i, question_text: r.aliases[0], criteria: ''}));
const fullGrades = qs => qs.map(q => ({question_id: q.id, matched: q.ai_rule.items.map(i => i.id), grade: 5, comment: 'Верно.', needs_review: false, review_reason: ''}));
const answersFor = qs => qs.map(q => ({question_id: q.id, answer_text: q.ai_rule.answer}));
const config = {enabled: true, apiKey: 'test-key-never-log', folder: 'b1gvih69o63hf3q9qj04', modelUri: 'gpt://test/deepseek-v4.1-flash/latest'};

async function fixture(t, options = {}) {
  const db = new sqlite3.Database(':memory:');
  const query = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (e, rows) => e ? reject(e) : resolve({rows})));
  let pending = Promise.resolve();
  const transaction = work => {
    const promise = pending.then(async () => {
      await query('BEGIN IMMEDIATE');
      try { const result = await work(query); await query('COMMIT'); return result; }
      catch (e) { await query('ROLLBACK'); throw e; }
    });
    pending = promise.catch(() => {});
    return promise;
  };
  for (const sql of [
    'CREATE TABLE scenarios (id INTEGER PRIMARY KEY,name TEXT,created_by INTEGER)',
    'CREATE TABLE rooms (id INTEGER PRIMARY KEY,name TEXT,scenario_id INTEGER,is_test BOOLEAN,state TEXT,game_start_time TEXT,created_by INTEGER,game_end_time TEXT)',
    'CREATE TABLE shared_rooms (room_id INTEGER,room_user_id INTEGER)',
    'CREATE TABLE player_runs (id TEXT,account_id TEXT,product_id TEXT,room_id INTEGER,room_user_id INTEGER,is_owner INTEGER,score INTEGER,result_status TEXT,created_at TEXT)',
    'CREATE TABLE player_products (id TEXT PRIMARY KEY,rubric TEXT,price INTEGER,scenario_id INTEGER)',
    'CREATE TABLE questions (id INTEGER PRIMARY KEY,scenario_id INTEGER,question_text TEXT,is_active BOOLEAN,question_order INTEGER)',
    'CREATE TABLE question_answers (id INTEGER PRIMARY KEY,question_id INTEGER,room_user_id INTEGER,answer_text TEXT)',
    'CREATE TABLE visit_attempts (id INTEGER PRIMARY KEY,user_id INTEGER,room_id INTEGER)',
    'CREATE TABLE player_admin_audit (id TEXT,admin_id INTEGER,admin_name TEXT,action TEXT,account_id TEXT,room_id INTEGER,reason TEXT,payload TEXT,result TEXT,created_at TEXT)'
  ]) await query(sql);
  let time = 1800000000000, calls = 0;
  const grader = {config: {...config, enabled: options.enabled !== false}, grade: async payload => {
    calls++;
    if (options.grade) return options.grade(payload, calls);
    return {grades: fullGrades(payload.questions), usage: {input_tokens: 200, output_tokens: 200}, model: config.modelUri};
  }};
  const roomSync = async id => (await query('SELECT * FROM rooms WHERE id=$1', [id])).rows[0];
  const scoring = createPlayerScoring({query, transaction, roomSync, aiGrader: grader});
  await scoring.init();
  await query("INSERT INTO scenarios VALUES (1,'Время Взаймы',1)");
  await query("INSERT INTO rooms VALUES (1,'Команда',1,FALSE,'running','2026-10-21',1,'2999-01-01')");
  await query('INSERT INTO player_products VALUES ($1,NULL,0,1)', [options.product || 'borrowed-time']);
  await query('INSERT INTO player_runs VALUES ($1,$2,$3,1,10,1,NULL,NULL,$4)', ['run', 'account', options.product || 'borrowed-time', '2026-10-21']);
  await query('INSERT INTO shared_rooms VALUES (1,10)');
  for (const q of questions()) {
    if(options.adminUntimed && q.id===101)q.question_text='Где находится подмастерье к и почему он перестал выходить на связь?';
    await query('INSERT INTO questions VALUES ($1,1,$2,TRUE,$3)', [q.id, q.question_text, q.id]);
    await query('INSERT INTO question_answers (question_id,room_user_id,answer_text) VALUES ($1,10,$2)', [q.id, options.empty ? '' : 'Ответ команды']);
  }
  await query('INSERT INTO visit_attempts VALUES (1,10,1)');
  if(options.adminUntimed){await query('ALTER TABLE rooms ADD COLUMN duration_seconds INTEGER');await query('UPDATE rooms SET duration_seconds=0 WHERE id=1');await query('DELETE FROM player_runs');}
  await transaction(q => scoring.capture(q, 1, options.adminUntimed?null:options.product || 'borrowed-time'));
  const finish = () => transaction(async q => { await q("UPDATE rooms SET state='finished' WHERE id=1"); return scoring.complete(q, 1); });
  t.after(async () => { scoring.aiReviews.stop(); await new Promise(resolve => db.close(resolve)); });
  return {query, transaction, scoring, finish, grader, calls: () => calls, time: () => time, advance: ms => {time += ms;}};
}

test('rubric identifies all seven questions independently of order and freezes the narrow question variant', () => {
  const frozen = freezeRubric(questions().reverse());
  assert.equal(frozen.length, 7);
  assert.ok(frozen.every(q => q.ai_rule.version === VERSION && q.ai_rule.items.reduce((s,i) => s+i.points,0) === 5));
  const narrow = questions(); narrow[5].question_text = rules[5].aliases[1];
  assert.equal(freezeRubric(narrow)[5].ai_rule.items.at(-1).id, 'defense');
  const deployed = questions(); deployed[0].question_text = 'Где находится подмастерье к и почему он перестал выходить на связь?';
  assert.equal(freezeRubric(deployed)[0].ai_rule.items.length, 5);
  const changed = questions(); changed[0].question_text = 'Другой вопрос'; assert.equal(freezeRubric(changed), null);
  const duplicate = questions(); duplicate[1] = duplicate[0]; assert.equal(freezeRubric(duplicate), null);
  const custom = questions(); custom[0].criteria = 'Авторская новая шкала'; assert.equal(freezeRubric(custom), null);
});

test('requests load their own frozen semantic policy, preserving v4, v3 and v2 rooms', () => {
  const qs = freezeRubric(questions());
  const policy = require('node:fs').readFileSync(require('node:path').join(__dirname, '../backend/prompts/borrowed-time-grading-v5.md'), 'utf8');
  assert.ok(buildInstructions(qs).includes(policy));
  const legacy = qs.map(q => ({...q, ai_rule: {...q.ai_rule, version: 'borrowed-time-2026-10-21-v2'}}));
  assert.ok(!buildInstructions(legacy).includes(policy));
  const v3Policy=require('node:fs').readFileSync(require('node:path').join(__dirname,'../backend/prompts/borrowed-time-grading-v3.md'),'utf8');
  const v3=qs.map(q=>({...q,ai_rule:{...q.ai_rule,version:'borrowed-time-2026-10-21-v3'}}));
  assert.ok(buildInstructions(v3).includes(v3Policy));assert.ok(!buildInstructions(v3).includes(policy));
  const v4Policy=require('node:fs').readFileSync(require('node:path').join(__dirname,'../backend/prompts/borrowed-time-grading-v4.md'),'utf8');
  const v4=qs.map(q=>({...q,ai_rule:{...q.ai_rule,version:'borrowed-time-2026-10-21-v4'}}));
  assert.ok(buildInstructions(v4).includes(v4Policy));assert.ok(!buildInstructions(v4).includes(policy));
  const place = qs[4].ai_rule.items;
  assert.equal(place.find(item => item.id === 'place').points, 3);
  assert.ok(!place.some(item => item.id === 'pledger'));
});

test('a new untimed administrator demo room receives AI grading without a player purchase or owner run',async t=>{
 const f=await fixture(t,{adminUntimed:true});
 assert.deepEqual((await f.scoring.publicSummary(1)).grades,[]);
 await f.finish();assert.deepEqual((await f.scoring.publicSummary(1)).grades,[]);await f.scoring.aiReviews.tick();
 const summary=await f.scoring.publicSummary(1);
 assert.equal(f.calls(),1);assert.equal(summary.ai_review.status,'completed');assert.equal(summary.points,35);assert.equal(summary.grades.length,7);
 assert.equal(summary.grades[0].correct_answer,rules[0].answer);assert.equal(summary.grades[0].answer_text,'Ответ команды');
});

test('Responses request matches the Yandex example and sends only answers and frozen rules', async () => {
  const qs = freezeRubric(questions()), answers = answersFor(qs);
  let sent;
  const grader = createYandexGrader({config, fetchImpl: async (url, request) => {
    sent = {url, request, body: JSON.parse(request.body)};
    return {ok: true, json: async () => ({status: 'completed', model: 'deepseek', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({grades: fullGrades(qs)})}]}], usage: {input_tokens: 100, output_tokens: 20, leaked: 'ignored'}})};
  }});
  const result = await grader.grade({questions: qs, answers});
  assert.equal(result.grades.reduce((s,g) => s+g.grade,0), 35);
  assert.deepEqual(result.usage, {input_tokens: 100, output_tokens: 20});
  assert.equal(sent.url, ENDPOINT);
  assert.equal(sent.request.redirect, 'error');
  assert.equal(sent.request.headers.Authorization, 'Bearer test-key-never-log');
  assert.equal(sent.body.store, false); assert.equal(sent.body.temperature, 0);
  assert.deepEqual(sent.body.reasoning, {effort: 'none'});
  assert.equal(sent.body.text.format.type, 'json_schema');
  assert.equal(sent.body.text.format.strict, true);
  assert.ok(sent.body.text.format.schema.properties.grades.items.required.includes('needs_review'));
  assert.equal(sent.body.model, config.modelUri);
  assert.equal(JSON.parse(sent.body.input).answers.length, 7);
  assert.ok(!sent.request.body.includes(config.apiKey));
});

test('invalid, duplicated, missing and fabricated grades cannot be published', () => {
  const qs = freezeRubric(questions()), answers = answersFor(qs), valid = fullGrades(qs);
  const bad = [valid.slice(1), [valid[0], ...valid.slice(0,6)], valid.map((g,i) => i ? g : {...g, grade: 4}),
    valid.map((g,i) => i ? g : {...g, question_id: 999}), valid.map((g,i) => i ? g : {...g, grade: '5'}),
    valid.map((g,i) => i ? g : {...g, matched: ['made_up']}), valid.map((g,i) => i ? g : {...g, matched: ['place','place']}),
    valid.map((g,i) => i ? g : {...g, needs_review: true, review_reason: ''}),
    valid.map((g,i) => i ? g : {...g, needs_review: undefined, review_reason: undefined}),
    valid.map((g,i) => i ? g : {...g, needs_review: false, review_reason: 'Требуется ручная проверка'})];
  for (const grades of bad) assert.throws(() => validateGrades({grades}, qs, answers));
  assert.equal(validateGrades({grades: valid}, qs, answers.map(a => ({...a, answer_text: ''})))[0].grade, 0);
});

test('provider failures are sanitized, retry only transient errors, and reject truncated output', async () => {
  const qs = freezeRubric(questions()), answers = answersFor(qs);
  for (const [status, retryable] of [[401,false],[403,false],[429,true],[500,true]]) {
    const grader = createYandexGrader({config, fetchImpl: async () => ({ok: false, status})});
    await assert.rejects(grader.grade({questions: qs, answers}), e => e.code === `AI_HTTP_${status}` && e.retryable === retryable && !e.message.includes(config.apiKey));
  }
  const truncated = createYandexGrader({config, fetchImpl: async () => ({ok: true, json: async () => ({status: 'incomplete', output: []})})});
  await assert.rejects(truncated.grade({questions: qs, answers}), e => e.code === 'AI_INCOMPLETE_RESPONSE');
  const network = createYandexGrader({config, fetchImpl: async () => {throw new Error(config.apiKey);}});
  await assert.rejects(network.grade({questions: qs, answers}), e => e.message === 'AI_NETWORK_ERROR');
  assert.throws(() => readConfig({AI_GRADING_ENABLED:'1'}), e => e.code === 'AI_CONFIG_INVALID');
});

test('finishing only enqueues; worker publishes all scores and fee exactly once', async t => {
  const f = await fixture(t);
  assert.equal((await f.finish()).result_status, 'pending_review');
  await f.finish(); assert.equal(f.calls(), 0);
  assert.equal((await f.query('SELECT * FROM player_ai_reviews')).rows.length, 1);
  await Promise.all([f.scoring.aiReviews.tick(), f.scoring.aiReviews.tick()]);
  assert.equal(f.calls(), 1);
  const summary = await f.scoring.publicSummary(1);
  assert.equal(summary.points, 35); assert.equal(summary.fee, calculateFee({points:35,max_points:35,trips:1}).fee);
  assert.equal(summary.grades.length, 7); assert.equal(summary.review_status, 'graded');
  assert.equal((await f.query('SELECT result_status FROM player_runs')).rows[0].result_status, 'graded');
  const job = (await f.query('SELECT * FROM player_ai_reviews')).rows[0];
  assert.equal(job.status, 'completed'); assert.ok(!JSON.stringify(job).includes(config.apiKey));
  await f.scoring.aiReviews.tick(); assert.equal(f.calls(), 1);
});

test('blank submissions use local zero grades without a paid request', async t => {
  const f = await fixture(t, {empty: true}); await f.finish(); await f.scoring.aiReviews.tick();
  assert.equal(f.calls(), 0); assert.equal((await f.scoring.publicSummary(1)).points, 0);
});

test('AI publication respects the frozen fee version for both old and new rooms',async t=>{
  for(const [version,fee] of [[1,1469],[2,1714]]){
    const f=await fixture(t,{grade:async payload=>({grades:fullGrades(payload.questions).map((g,i)=>i===6?{...g,matched:[],grade:0}:g),usage:{}})});
    await f.query('UPDATE player_room_scoring SET formula_version=$1 WHERE room_id=1',[version]);
    await f.finish();await f.scoring.aiReviews.tick();
    const summary=await f.scoring.publicSummary(1);
    assert.equal(summary.points,30);assert.equal(summary.fee,fee);assert.equal(summary.rating_points,fee);assert.equal(summary.formula_version,version);
    assert.equal((await f.query('SELECT score FROM player_runs WHERE room_id=1')).rows[0].score,fee);
  }
});

test('feature flag and product scope preserve existing manual checking', async t => {
  for (const options of [{enabled:false}, {product:'paid'}]) {
    const f = await fixture(t, options); await f.finish(); await f.scoring.aiReviews.tick();
    assert.equal(f.calls(), 0); assert.equal((await f.query('SELECT * FROM player_ai_reviews')).rows.length, 0);
    assert.equal((await f.scoring.publicSummary(1)).review_status, 'pending_review');
  }
});

test('manual draft during an API request cannot be overwritten by the returned AI result', async t => {
  let release, entered;
  const started = new Promise(resolve => {entered = resolve;});
  const f = await fixture(t, {grade: async payload => {entered(); await new Promise(resolve => {release = resolve;}); return {grades: fullGrades(payload.questions), usage:{}};}});
  await f.finish();
  const tick = f.scoring.aiReviews.tick(); await started;
  await f.scoring.saveReview({id:1,is_admin:true,admin_level:'super_admin'}, 1,
    {request_key:randomUUID(),reason:'Проверка организатора',revision:0,publish:false,grades:[{question_id:101,grade:2,comment:'Ручная оценка'}]});
  release(); await tick;
  assert.equal((await f.query('SELECT status FROM player_ai_reviews')).rows[0].status, 'superseded');
  assert.equal((await f.query('SELECT grade FROM player_answer_grades WHERE question_id=101')).rows[0].grade, 2);
  assert.equal((await f.scoring.publicSummary(1)).fee, null);
});

test('ambiguous results remain unpublished with an organizer draft', async t => {
  const f = await fixture(t, {grade: async payload => ({grades: fullGrades(payload.questions).map((g,i) => i ? g : {...g, needs_review:true,review_reason:'Противоречие в ответе'}), usage:{}})});
  await f.finish(); await f.scoring.aiReviews.tick();
  assert.equal((await f.scoring.publicSummary(1)).fee, null);
  assert.equal((await f.query('SELECT * FROM player_answer_grades')).rows.length, 7);
  assert.equal((await f.query('SELECT status FROM player_ai_reviews')).rows[0].status, 'needs_review');
});

test('transient errors survive restart and respect backoff and the retry limit', async t => {
  const f = await fixture(t, {grade: async () => {throw Object.assign(new Error('temporary'), {code:'AI_HTTP_429',retryable:true});}});
  await f.finish(); await f.scoring.aiReviews.tick();
  let job = (await f.query('SELECT * FROM player_ai_reviews')).rows[0]; assert.equal(job.status, 'queued'); assert.equal(job.attempts,1);
  await f.scoring.aiReviews.tick(); assert.equal(f.calls(),1);
  // Bring the durable job's next attempt forward, simulating elapsed backoff after restart.
  for (let i=0;i<2;i++) {await f.query('UPDATE player_ai_reviews SET next_attempt_at=0'); await f.scoring.aiReviews.tick();}
  job = (await f.query('SELECT * FROM player_ai_reviews')).rows[0]; assert.equal(job.status,'needs_review'); assert.equal(job.attempts,3);
  assert.equal((await f.scoring.publicSummary(1)).fee,null);
});

test('expired processing lease is recovered but a live lease is not duplicated', async t => {
  const f=await fixture(t); await f.finish();
  await f.query("UPDATE player_ai_reviews SET status='processing',attempts=1,lease_token='old',lease_until=$1",[Date.now()+60000]);
  await f.scoring.aiReviews.tick(); assert.equal(f.calls(),0);
  await f.query('UPDATE player_ai_reviews SET lease_until=0'); await f.scoring.aiReviews.tick();
  assert.equal(f.calls(),1); assert.equal((await f.query('SELECT status FROM player_ai_reviews')).rows[0].status,'completed');
});

test('worker settles a finished AI room without a player opening the result', async t => {
  const f=await fixture(t);
  f.scoring.setFinalizer(()=>f.finish());
  await f.query("UPDATE rooms SET state='finished' WHERE id=1");
  await f.scoring.aiReviews.tick();
  assert.equal(f.calls(),1);
  assert.equal((await f.scoring.publicSummary(1)).points,35);
});
