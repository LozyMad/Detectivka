// Определяем тип базы данных из переменной окружения
const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let Room;

if (DB_TYPE === 'postgresql') {
  // Используем PostgreSQL версию
  Room = require('./roomPostgreSQL');
} else {
  // Используем SQLite версию (оригинальная логика)
  const { db } = require('../config/database');

  Room = {
  create: ({ name, scenario_id, created_by, duration_seconds = 3600, is_test = false }) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO rooms (name, scenario_id, created_by, duration_seconds, is_test, state, game_start_time) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, scenario_id, created_by, is_test ? 0 : duration_seconds, is_test ? 1 : 0,
          is_test ? 'running' : 'pending', is_test ? new Date().toISOString() : null],
        function(err) {
          if (err) return reject(err);
          resolve({ id: this.lastID, name, scenario_id, created_by, duration_seconds: is_test ? 0 : duration_seconds, is_test });
        }
      );
    });
  },

  listByAdmin: (userId) => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT r.*, s.name as scenario_name FROM rooms r
         LEFT JOIN scenarios s ON r.scenario_id = s.id
         WHERE r.created_by = ? ORDER BY r.created_at DESC`,
        [userId],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });
  },

  getById: (id) => {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT r.*, s.name as scenario_name FROM rooms r
         LEFT JOIN scenarios s ON r.scenario_id = s.id
         WHERE r.id = ?`, 
        [id], 
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });
  },

  updateTestScenario: (roomId, scenarioId) => new Promise((resolve, reject) => {
    db.run(`UPDATE rooms SET scenario_id = ? WHERE id = ? AND is_test = 1`, [scenarioId, roomId], function(err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    });
  }),

  // Новая простая логика таймера
  startGame: (roomId) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT duration_seconds FROM rooms WHERE id = ?`, [roomId], (err, row) => {
        if (err) return reject(err);
        if (!row) return reject(new Error('Room not found'));

        const durationSeconds = row.duration_seconds || 3600;
        const now = new Date();
        const endTime = new Date(now.getTime() + durationSeconds * 1000);

        db.run(`UPDATE rooms 
                SET game_start_time = ?, game_end_time = ?, paused_at = NULL,
                    halfway_paused = 0, state = 'running'
                WHERE id = ? AND state IN ('pending', 'finished')`, [now.toISOString(), endTime.toISOString(), roomId], function(updateErr) {
          if (updateErr) return reject(updateErr);
          if (!this.changes) return reject(new Error('Room cannot be started in its current state'));
          resolve({ id: roomId, game_start_time: now.toISOString(), game_end_time: endTime.toISOString(), duration_seconds: durationSeconds });
        });
      });
    });
  },

  pauseGame: (roomId, pausedAt = new Date().toISOString(), automatic = false) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE rooms SET state = 'paused', paused_at = ?,
              halfway_paused = CASE WHEN ? THEN 1 ELSE halfway_paused END
              WHERE id = ? AND state = 'running' AND (? = 0 OR halfway_paused = 0)`,
        [pausedAt, automatic ? 1 : 0, roomId, automatic ? 1 : 0], function(err) {
        if (err) return reject(err);
        resolve(this.changes ? { id: roomId, state: 'paused', paused_at: pausedAt } : null);
      });
    });
  },

  resumeGame: (roomId) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT game_end_time, paused_at FROM rooms WHERE id = ? AND state = 'paused'`, [roomId], (err, room) => {
        if (err) return reject(err);
        if (!room) return resolve(null);
        const now = new Date();
        const pausedAt = new Date(room.paused_at || now);
        const remainingMs = Math.max(0, new Date(room.game_end_time) - pausedAt);
        const endTime = new Date(now.getTime() + remainingMs);
        db.run(`UPDATE rooms SET state = 'running', game_end_time = ?, paused_at = NULL
                WHERE id = ? AND state = 'paused'`, [endTime.toISOString(), roomId], function(updateErr) {
          if (updateErr) return reject(updateErr);
          resolve(this.changes ? { id: roomId, state: 'running', game_end_time: endTime.toISOString() } : null);
        });
      });
    });
  },

  finishIfRunning: (roomId, now = new Date().toISOString()) => new Promise((resolve, reject) => {
    db.run(`UPDATE rooms SET state = 'finished'
            WHERE id = ? AND state = 'running' AND game_end_time <= ?`, [roomId, now], function(err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    });
  }),

  stopGame: (roomId) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE rooms SET state = 'finished', game_end_time = ? WHERE id = ?`, 
        [new Date().toISOString(), roomId], function(err) {
        if (err) return reject(err);
        resolve({ id: roomId, state: 'finished' });
      });
    });
  },

  delete: async (roomId) => {
    const room = await Room.getById(roomId);
    if (room?.is_test) {
      const run = (database, sql, params) => new Promise((resolve, reject) => {
        database.run(sql, params, err => err ? reject(err) : resolve());
      });
      const scenarioIds = await new Promise((resolve, reject) => {
        db.all(`SELECT id FROM scenarios`, [], (err, rows) => err ? reject(err) : resolve(rows));
      });
      const { getScenarioDb } = require('../config/scenarioDatabase');
      for (const scenario of scenarioIds) {
        await run(getScenarioDb(scenario.id), `DELETE FROM visited_locations WHERE room_id = ?`, [roomId]);
      }
      await run(db, `DELETE FROM game_choices WHERE room_user_id IN (SELECT id FROM room_users WHERE room_id = ?)`, [roomId]);
      await run(db, `DELETE FROM question_answers WHERE room_user_id IN (SELECT id FROM room_users WHERE room_id = ?)`, [roomId]);
      await run(db, `DELETE FROM visit_attempts WHERE room_id = ?`, [roomId]);
      await run(db, `DELETE FROM room_users WHERE room_id = ?`, [roomId]);
    }
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM rooms WHERE id = ?`, [roomId], function(err) {
        if (err) return reject(err);
        resolve({ deletedId: roomId });
      });
    });
  }
  };
}

module.exports = Room;
