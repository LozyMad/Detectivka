const { db } = require('../config/database');

const Scenario = {
    create: (scenarioData) => {
        return new Promise((resolve, reject) => {
            const { name, description, is_active = false, created_by } = scenarioData;
            
            db.run(
                `INSERT INTO scenarios (name, description, is_active, created_by) VALUES (?, ?, ?, ?)`,
                [name, description, is_active, created_by],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, name, description, is_active, created_by });
                }
            );
        });
    },

    getAll: () => {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT s.*, u.username as created_by_username 
                 FROM scenarios s 
                 LEFT JOIN users u ON s.created_by = u.id 
                 ORDER BY s.created_at DESC`,
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    },

    getActive: () => {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM scenarios WHERE is_active = TRUE LIMIT 1`,
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    },

    getById: (id) => {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM scenarios WHERE id = ?`,
                [id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    },

    update: (id, scenarioData) => {
        return new Promise((resolve, reject) => {
            const { name, description, is_active } = scenarioData;
            
            db.run(
                `UPDATE scenarios SET name = ?, description = ?, is_active = ? WHERE id = ?`,
                [name, description, is_active, id],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id, name, description, is_active });
                }
            );
        });
    },

    delete: (id) => {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM scenarios WHERE id = ?`, [id], function(err) {
                if (err) reject(err);
                else resolve({ deletedId: id });
            });
        });
    },

    // Получить сценарии, доступные админу (с разрешениями или созданные им)
    getAvailableForAdmin: (admin_id, admin_level) => {
        return new Promise((resolve, reject) => {
            let query;
            let params;

            if (admin_level === 'super_admin') {
                // Супер-админ видит все сценарии
                query = `SELECT s.*, u.username as created_by_username 
                         FROM scenarios s 
                         LEFT JOIN users u ON s.created_by = u.id 
                         ORDER BY s.created_at DESC`;
                params = [];
            } else {
                // Обычный админ видит только сценарии с разрешениями или созданные им
                query = `SELECT DISTINCT s.*, u.username as created_by_username 
                         FROM scenarios s 
                         LEFT JOIN users u ON s.created_by = u.id 
                         LEFT JOIN admin_scenario_permissions asp ON s.id = asp.scenario_id 
                         WHERE s.created_by = ? OR asp.admin_id = ?
                         ORDER BY s.created_at DESC`;
                params = [admin_id, admin_id];
            }

            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
};

module.exports = Scenario;