const { db } = require('../config/database');

class VisitAttempt {
  static create(attemptData) {
    return new Promise((resolve, reject) => {
      const { user_id, scenario_id, district, house_number, found, address_id = null, room_id = null } = attemptData;

      db.run(
        `INSERT INTO visit_attempts (user_id, scenario_id, room_id, district, house_number, found, address_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [user_id, scenario_id, room_id, district, house_number, found, address_id],
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
         WHERE va.scenario_id = ?
         ORDER BY va.attempted_at DESC`,
        [scenarioId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  static getStatsByScenario(scenarioId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT 
           district,
           COUNT(*) as total_attempts,
           SUM(CASE WHEN found = 1 THEN 1 ELSE 0 END) as found_count,
           SUM(CASE WHEN found = 0 THEN 1 ELSE 0 END) as not_found_count
         FROM visit_attempts 
         WHERE scenario_id = ?
         GROUP BY district
         ORDER BY total_attempts DESC`,
        [scenarioId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  // Новый метод: получение попыток пользователя по сценарию
  static getByUserAndScenario(userId, scenarioId, roomId = null) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT 
           va.*,
           a.description as address_description
         FROM visit_attempts va
         LEFT JOIN addresses a ON va.address_id = a.id
         WHERE va.user_id = ? AND va.scenario_id = ? ${roomId !== null ? 'AND va.room_id = ?' : ''}
         ORDER BY va.attempted_at DESC
         LIMIT 100`;
      const params = roomId !== null ? [userId, scenarioId, roomId] : [userId, scenarioId];
      db.all(
        sql,
        params,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
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

module.exports = VisitAttempt;