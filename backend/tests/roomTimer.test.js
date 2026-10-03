const assert = require('node:assert/strict');
const { test } = require('node:test');
const sqlite3 = require('sqlite3').verbose();

process.env.DB_TYPE = 'sqlite';
const db = new sqlite3.Database(':memory:');
const configPath = require.resolve('../config/database');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { db } };
const Room = require('../models/room');
const { remainingSeconds, syncRoomTimer } = require('../services/roomTimer');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) reject(error);
      else resolve(this);
    });
  });
}

test('room timer freezes at halfway and preserves time across manual pauses', async (t) => {
  t.after(() => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())));
  await run('CREATE TABLE scenarios (id INTEGER PRIMARY KEY, name TEXT)');
  await run(`CREATE TABLE rooms (
    id INTEGER PRIMARY KEY, scenario_id INTEGER, duration_seconds INTEGER,
    is_test INTEGER DEFAULT 0, game_start_time TEXT, game_end_time TEXT,
    paused_at TEXT, halfway_paused INTEGER DEFAULT 0, state TEXT
  )`);
  await run("INSERT INTO scenarios (id, name) VALUES (1, 'Case')");

  const now = Date.now();
  await run(`INSERT INTO rooms (id, scenario_id, duration_seconds, game_end_time, state)
             VALUES (1, 1, 7200, ?, 'running')`, [new Date(now + 3590_000).toISOString()]);
  const halfway = await syncRoomTimer(1);
  assert.equal(halfway.state, 'paused');
  assert.equal(halfway.halfway_paused, 1);
  assert.equal(remainingSeconds(halfway), 3600);
  assert.equal(remainingSeconds(halfway, new Date(now + 600_000)), 3600);

  await Room.resumeGame(1);
  const resumed = await syncRoomTimer(1);
  assert.equal(resumed.state, 'running');
  assert.equal(resumed.halfway_paused, 1);
  assert.ok(remainingSeconds(resumed) >= 3599);

  await run(`INSERT INTO rooms (id, scenario_id, duration_seconds, game_end_time, state)
             VALUES (2, 1, 7200, ?, 'running')`, [new Date(now + 7000_000).toISOString()]);
  await Room.pauseGame(2);
  const tenMinutesAgo = Date.now() - 600_000;
  await run('UPDATE rooms SET paused_at = ?, game_end_time = ? WHERE id = 2', [
    new Date(tenMinutesAgo).toISOString(), new Date(tenMinutesAgo + 7000_000).toISOString()
  ]);
  const manualPause = await Room.getById(2);
  assert.equal(remainingSeconds(manualPause), 7000);
  await Room.resumeGame(2);
  const manualResume = await Room.getById(2);
  assert.equal(manualResume.state, 'running');
  assert.ok(remainingSeconds(manualResume) >= 6999);
  await run('UPDATE rooms SET game_end_time = ? WHERE id = 2', [new Date(Date.now() + 3500_000).toISOString()]);
  const pausedAfterManualResume = await syncRoomTimer(2);
  assert.equal(pausedAfterManualResume.state, 'paused');
  assert.equal(remainingSeconds(pausedAfterManualResume), 3600);

  await run(`INSERT INTO rooms (id, scenario_id, duration_seconds, game_end_time, state)
             VALUES (4, 1, 10800, ?, 'running')`, [new Date(Date.now() + 5390_000).toISOString()]);
  const ninetyMinuteBreak = await syncRoomTimer(4);
  assert.equal(remainingSeconds(ninetyMinuteBreak), 5400);

  await run(`INSERT INTO rooms (id, scenario_id, duration_seconds, game_end_time, halfway_paused, state)
             VALUES (3, 1, 7200, ?, 1, 'running')`, [new Date(now - 1000).toISOString()]);
  const finished = await syncRoomTimer(3);
  assert.equal(finished.state, 'finished');
  assert.equal(remainingSeconds(finished), 0);

});
