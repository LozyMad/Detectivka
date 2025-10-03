// Определяем тип базы данных из переменной окружения
const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let VisitedLocation;

if (DB_TYPE === 'postgresql') {
  // Используем PostgreSQL версию
  VisitedLocation = require('./visitedLocationPostgreSQL');
} else {
  // Используем SQLite версию (оригинальная логика)
  const { getScenarioDb } = require('../config/scenarioDatabase');

  // Model for visited locations history (successful finds)
  VisitedLocation = {
  // Idempotently mark an address as visited by a user within a scenario
  visitLocation: (userId, scenarioId, addressId, roomId = null) => {
    return new Promise((resolve, reject) => {
      const db = getScenarioDb(scenarioId);
      db.get(
        `SELECT * FROM visited_locations 
         WHERE user_id = ? AND address_id = ? ${roomId !== null ? 'AND room_id = ?' : ''}
         ORDER BY visited_at DESC LIMIT 1`,
        roomId !== null ? [userId, addressId, roomId] : [userId, addressId],
        (err, row) => {
          if (err) return reject(err);
          if (row) {
            return resolve({ alreadyVisited: true, visit: row });
          }
          db.run(
            `INSERT INTO visited_locations (user_id, room_id, address_id) VALUES (?, ?, ?)`,
            [userId, roomId, addressId],
            function(insertErr) {
              if (insertErr) return reject(insertErr);
              db.get(
                `SELECT vl.*, a.district, a.house_number, a.description 
                 FROM visited_locations vl
                 LEFT JOIN addresses a ON vl.address_id = a.id
                 WHERE vl.id = ?`,
                [this.lastID],
                (selectErr, visitRow) => {
                  if (selectErr) return reject(selectErr);
                  resolve({ alreadyVisited: false, visit: visitRow });
                }
              );
            }
          );
        }
      );
    });
  },

  // Get visited locations for user in active scenario
  getVisitedLocations: (userId, scenarioId, roomId = null) => {
    return new Promise((resolve, reject) => {
      const db = getScenarioDb(scenarioId);
      db.all(
        `SELECT vl.id, vl.visited_at, a.district, a.house_number, a.description
         FROM visited_locations vl
         LEFT JOIN addresses a ON vl.address_id = a.id
         WHERE vl.user_id = ? ${roomId !== null ? 'AND vl.room_id = ?' : ''}
         ORDER BY vl.visited_at DESC
         LIMIT 200`,
        roomId !== null ? [userId, roomId] : [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }
  };
}

module.exports = VisitedLocation;