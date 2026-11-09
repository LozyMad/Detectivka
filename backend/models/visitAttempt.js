// Определяем тип базы данных из переменной окружения
const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let VisitAttempt;

if (DB_TYPE === 'postgresql') {
  // Используем PostgreSQL версию
  VisitAttempt = require('./visitAttemptPostgreSQL');
} else {
  // Используем SQLite версию (оригинальная логика)
  const { db } = require('../config/database');
  const { getScenarioDb } = require('../config/scenarioDatabase');

  function getDescriptionFromScenarioDb(scenarioId, addressId) {
    return new Promise((resolve) => {
      if (!scenarioId || !addressId) return resolve(null);
      try {
        const scenarioDb = getScenarioDb(scenarioId);
        scenarioDb.get('SELECT description FROM addresses WHERE id = ?', [addressId], (err, row) => {
          if (err) resolve(null);
          else resolve(row ? row.description : null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  class VisitAttemptSQLite {
  static create(attemptData) {
    return new Promise((resolve, reject) => {
      const { user_id, scenario_id, district, house_number, apartment = '', found, address_id = null, room_id = null } = attemptData;
      const apt = String(apartment ?? '').trim();

      db.run(
        `INSERT INTO visit_attempts (user_id, scenario_id, room_id, district, house_number, apartment, found, address_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [user_id, scenario_id, room_id, district, house_number, apt, found, address_id],
        function(err) {
          if (err) reject(err);
          else resolve({ 
            id: this.lastID, 
            user_id, 
            scenario_id, 
            room_id,
            district, 
            house_number, 
            found, 
            address_id 
          });
        }
      );
    });
  }

  static getByScenario(scenarioId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT va.*, u.username, a.description as address_description
         FROM visit_attempts va
         LEFT JOIN users u ON va.user_id = u.id
         LEFT JOIN addresses a ON va.address_id = a.id
         WHERE va.scenario_id = ? AND (va.room_id IS NULL OR NOT EXISTS (SELECT 1 FROM rooms r WHERE r.id = va.room_id AND r.is_test = 1))
         ORDER BY va.attempted_at DESC`,
        [scenarioId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  // Новый метод: получение попыток пользователя по сценарию (описание адреса из базы сценария)
  static getByUserAndScenario(userId, scenarioId, roomId = null) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT 
           va.*,
           vl.id as visited_location_id
         FROM visit_attempts va
         LEFT JOIN visited_locations vl ON va.address_id = vl.address_id 
           AND va.user_id = vl.user_id 
           AND va.scenario_id = vl.scenario_id
         WHERE va.user_id = ? AND va.scenario_id = ? ${roomId !== null ? 'AND va.room_id = ?' : ''}
         ORDER BY va.attempted_at DESC
         LIMIT 100`;
      const params = roomId !== null ? [userId, scenarioId, roomId] : [userId, scenarioId];
      db.all(sql, params, async (err, rows) => {
        if (err) return reject(err);
        if (!rows || rows.length === 0) return resolve([]);
        for (const row of rows) {
          if (row.found && row.address_id && row.scenario_id) {
            row.address_description = await getDescriptionFromScenarioDb(row.scenario_id, row.address_id);
          }
        }
        resolve(rows);
      });
    });
  }

  // Статистика поездок пользователя
  static getStatsByUser(userId, scenarioId, roomId = null) {
    return new Promise((resolve, reject) => {
      try {
        const sql = `SELECT 
             COUNT(*) as total_trips,
             SUM(CASE WHEN found = 1 THEN 1 ELSE 0 END) as successful_trips,
             SUM(CASE WHEN found = 0 THEN 1 ELSE 0 END) as failed_trips
           FROM visit_attempts 
           WHERE user_id = ? AND scenario_id = ? ${roomId !== null ? 'AND room_id = ?' : ''}`;
        const params = roomId !== null ? [userId, scenarioId, roomId] : [userId, scenarioId];
        
        db.get(
          sql,
          params,
          (err, row) => {
            if (err) {
              console.error('Error in getStatsByUser:', err);
              resolve({ total_trips: 0, successful_trips: 0, failed_trips: 0 });
            } else {
              resolve(row || { total_trips: 0, successful_trips: 0, failed_trips: 0 });
            }
          }
        );
      } catch (error) {
        console.error('Error in getStatsByUser:', error);
        resolve({ total_trips: 0, successful_trips: 0, failed_trips: 0 });
      }
    });
  }

  // Статистика поездок по комнате (для всех пользователей в комнате)
  static getStatsByRoom(roomId, scenarioId) {
    return new Promise((resolve, reject) => {
      try {
        const sql = `SELECT 
             COUNT(*) as total_trips,
             SUM(CASE WHEN found = 1 THEN 1 ELSE 0 END) as successful_trips,
             SUM(CASE WHEN found = 0 THEN 1 ELSE 0 END) as failed_trips
           FROM visit_attempts 
           WHERE room_id = ? AND scenario_id = ?`;
        const params = [roomId, scenarioId];
        
        db.get(
          sql,
          params,
          (err, row) => {
            if (err) {
              console.error('Error in getStatsByRoom:', err);
              resolve({ total_trips: 0, successful_trips: 0, failed_trips: 0 });
            } else {
              resolve(row || { total_trips: 0, successful_trips: 0, failed_trips: 0 });
            }
          }
        );
      } catch (error) {
        console.error('Error in getStatsByRoom:', error);
        resolve({ total_trips: 0, successful_trips: 0, failed_trips: 0 });
      }
    });
  }
  }

  VisitAttempt = VisitAttemptSQLite;
}

VisitAttempt.getStatsByScenario = async function (scenarioId, scope = 'games') {
  const { query } = require('../config/database');
  const { rows } = await query(`SELECT v.district, COUNT(*) AS total_attempts,
      COUNT(CASE WHEN v.found = TRUE THEN 1 END) AS found_count,
      COUNT(CASE WHEN v.found = FALSE THEN 1 END) AS not_found_count
    FROM visit_attempts v LEFT JOIN rooms r ON r.id = v.room_id
    WHERE v.scenario_id = $1 AND ($2 = 'all'
      OR ($2 = 'test' AND r.is_test = TRUE)
      OR ($2 = 'games' AND COALESCE(r.is_test, FALSE) = FALSE))
    GROUP BY v.district ORDER BY total_attempts DESC, v.district`, [scenarioId, scope]);
  return rows;
};

module.exports = VisitAttempt;
