// Определяем тип базы данных из переменной окружения
const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let RoomUser;

if (DB_TYPE === 'postgresql') {
  // Используем PostgreSQL версию
  RoomUser = require('./roomUserPostgreSQL');
} else {
  // Используем SQLite версию (оригинальная логика)
  const { db } = require('../config/database');
  const bcrypt = require('bcryptjs');

  RoomUser = {
    add: ({ room_id, username, password }) => {
      return new Promise((resolve, reject) => {
        const hashed = bcrypt.hashSync(password, 10);
        db.run(
          `INSERT INTO room_users (room_id, username, password) VALUES (?, ?, ?)`,
          [room_id, username, hashed],
          function(err) {
            if (err) return reject(err);
            resolve({ id: this.lastID, room_id, username });
          }
        );
      });
    },

    listByRoom: (room_id) => {
      return new Promise((resolve, reject) => {
        db.all(`SELECT id, room_id, username, created_at FROM room_users WHERE room_id = ? ORDER BY created_at DESC`, [room_id], (err, rows) => (err ? reject(err) : resolve(rows)));
      });
    },

    getByRoomId: (room_id) => {
      return new Promise((resolve, reject) => {
        db.all(`SELECT id, room_id, username, created_at FROM room_users WHERE room_id = ? ORDER BY created_at DESC`, [room_id], (err, rows) => (err ? reject(err) : resolve(rows)));
      });
    },

    remove: (room_user_id) => {
      return new Promise((resolve, reject) => {
        db.run(`DELETE FROM room_users WHERE id = ?`, [room_user_id], function(err) {
          if (err) return reject(err);
          resolve({ deletedId: room_user_id });
        });
      });
    },

    verifyCredentials: (room_id, username, password) => {
      return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM room_users WHERE room_id = ? AND username = ?`, [room_id, username], (err, row) => {
          if (err) return reject(err);
          if (!row) return resolve(null);
          const ok = bcrypt.compareSync(password, row.password);
          if (!ok) return resolve(null);
          resolve({ id: row.id, room_id: row.room_id, username: row.username });
        });
      });
    }
  };
}

module.exports = RoomUser;



