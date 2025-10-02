// Определяем тип базы данных из переменной окружения
const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let AdminPermission;

if (DB_TYPE === 'postgresql') {
  // Используем PostgreSQL версию
  AdminPermission = require('./adminPermissionPostgreSQL');
} else {
  // Используем SQLite версию (оригинальная логика)
  const { db } = require('../config/database');

  AdminPermission = {
  // Предоставить разрешение админу на сценарий
  grant: (admin_id, scenario_id, granted_by) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR IGNORE INTO admin_scenario_permissions (admin_id, scenario_id, granted_by) 
         VALUES (?, ?, ?)`,
        [admin_id, scenario_id, granted_by],
        function(err) {
          if (err) return reject(err);
          resolve({ id: this.lastID, admin_id, scenario_id, granted_by });
        }
      );
    });
  },

  // Отозвать разрешение админа на сценарий
  revoke: (admin_id, scenario_id) => {
    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM admin_scenario_permissions WHERE admin_id = ? AND scenario_id = ?`,
        [admin_id, scenario_id],
        function(err) {
          if (err) return reject(err);
          resolve({ deletedCount: this.changes });
        }
      );
    });
  },

  // Получить все разрешения для админа
  getByAdminId: (admin_id) => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT asp.*, s.name as scenario_name, s.description as scenario_description,
                g.username as granted_by_username
         FROM admin_scenario_permissions asp
         JOIN scenarios s ON asp.scenario_id = s.id
         JOIN users g ON asp.granted_by = g.id
         WHERE asp.admin_id = ?
         ORDER BY asp.granted_at DESC`,
        [admin_id],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  },

  // Получить всех админов с разрешениями на сценарий
  getByScenarioId: (scenario_id) => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT asp.*, u.username as admin_username, g.username as granted_by_username
         FROM admin_scenario_permissions asp
         JOIN users u ON asp.admin_id = u.id
         JOIN users g ON asp.granted_by = g.id
         WHERE asp.scenario_id = ?
         ORDER BY asp.granted_at DESC`,
        [scenario_id],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  },

  // Проверить, есть ли у админа разрешение на сценарий
  hasPermission: (admin_id, scenario_id) => {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT 1 FROM admin_scenario_permissions 
         WHERE admin_id = ? AND scenario_id = ?`,
        [admin_id, scenario_id],
        (err, row) => {
          if (err) return reject(err);
          resolve(!!row);
        }
      );
    });
  },

  // Получить все разрешения (для супер-админа)
  getAll: () => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT asp.*, u.username as admin_username, s.name as scenario_name,
                g.username as granted_by_username
         FROM admin_scenario_permissions asp
         JOIN users u ON asp.admin_id = u.id
         JOIN scenarios s ON asp.scenario_id = s.id
         JOIN users g ON asp.granted_by = g.id
         ORDER BY asp.granted_at DESC`,
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  }
  };
}

module.exports = AdminPermission;


