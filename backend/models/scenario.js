// Определяем тип базы данных из переменной окружения
const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let Scenario;

if (DB_TYPE === 'postgresql') {
  // Используем PostgreSQL версию
  Scenario = require('./scenarioPostgreSQL');
} else {
  // Используем SQLite версию (оригинальная логика)
  const { db } = require('../config/database');

  Scenario = {
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
    },

    // Копировать сценарий со всеми адресами и выборами
    copy: (sourceId, newName, createdBy) => {
        return new Promise(async (resolve, reject) => {
            try {
                // Получаем исходный сценарий
                const sourceScenario = await Scenario.getById(sourceId);
                if (!sourceScenario) {
                    throw new Error('Source scenario not found');
                }

                // Создаем новый сценарий
                const newScenario = await Scenario.create({
                    name: newName,
                    description: sourceScenario.description,
                    is_active: false, // Копия всегда неактивна
                    created_by: createdBy
                });

                // Получаем все адреса из исходного сценария
                const Address = require('./address');
                const sourceAddresses = await Address.findByScenario(sourceId);

                // Копируем адреса и их выборы
                for (const sourceAddress of sourceAddresses) {
                    // Создаем новый адрес
                    const newAddress = await Address.create({
                        scenario_id: newScenario.id,
                        district: sourceAddress.district,
                        house_number: sourceAddress.house_number,
                        description: sourceAddress.description
                    });

                    // Получаем выборы для исходного адреса
                    const sourceChoices = await Address.getChoices(sourceId, sourceAddress.id);

                    // Копируем выборы
                    for (const sourceChoice of sourceChoices) {
                        await Address.createChoice(newScenario.id, {
                            address_id: newAddress.id,
                            choice_text: sourceChoice.choice_text,
                            response_text: sourceChoice.response_text,
                            choice_order: sourceChoice.choice_order
                        });
                    }
                }

                resolve(newScenario);
            } catch (error) {
                reject(error);
            }
        });
    }
  };
}

module.exports = Scenario;