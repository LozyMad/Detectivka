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
  create: ({ name, scenario_id, created_by, duration_seconds = 3600 }) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO rooms (name, scenario_id, created_by, duration_seconds) VALUES (?, ?, ?, ?)`,
        [name, scenario_id, created_by, duration_seconds],
        function(err) {
          if (err) return reject(err);
          resolve({ id: this.lastID, name, scenario_id, created_by, duration_seconds });
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

  // Новая простая логика таймера
  startGame: (roomId) => {
    return new Promise((resolve, reject) => {
      const now = new Date();
      const endTime = new Date(now.getTime() + 3600 * 1000); // по умолчанию 1 час
      
      db.run(`UPDATE rooms 
              SET game_start_time = ?, game_end_time = ?, state = 'running'
              WHERE id = ?`, [now.toISOString(), endTime.toISOString(), roomId], function(err) {
        if (err) return reject(err);
        resolve({ id: roomId, game_start_time: now.toISOString(), game_end_time: endTime.toISOString() });
      });
    });
  },

  pauseGame: (roomId) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE rooms SET state = 'paused' WHERE id = ?`, [roomId], function(err) {
        if (err) return reject(err);
        resolve({ id: roomId, state: 'paused' });
      });
    });
  },

  resumeGame: (roomId) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE rooms SET state = 'running' WHERE id = ?`, [roomId], function(err) {
        if (err) return reject(err);
        resolve({ id: roomId, state: 'running' });
      });
    });
  },

  stopGame: (roomId) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE rooms SET state = 'finished', game_end_time = ? WHERE id = ?`, 
        [new Date().toISOString(), roomId], function(err) {
        if (err) return reject(err);
        resolve({ id: roomId, state: 'finished' });
      });
    });
  },

  delete: (roomId) => {
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


