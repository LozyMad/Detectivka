// Определяем тип базы данных из переменной окружения
const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let Address;

if (DB_TYPE === 'postgresql') {
  // Используем PostgreSQL версию
  Address = require('./addressPostgreSQL');
} else {
  // Используем SQLite версию (оригинальная логика)
  const { getScenarioDb } = require('../config/scenarioDatabase');

  Address = {
    create: (addressData) => {
        return new Promise((resolve, reject) => {
            const { scenario_id, district, house_number, description } = addressData;
            const db = getScenarioDb(scenario_id);

            db.run(
                `INSERT INTO addresses (district, house_number, description) VALUES (?, ?, ?)`,
                [district, house_number, description],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, scenario_id, district, house_number, description });
                }
            );
        });
    },

    findByScenarioAndAddress: (scenario_id, district, house_number) => {
        return new Promise((resolve, reject) => {
            const db = getScenarioDb(scenario_id);
            db.get(
                `SELECT * FROM addresses WHERE district = ? AND house_number = ?`,
                [district, house_number],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    },

    findByScenario: (scenario_id) => {
        return new Promise((resolve, reject) => {
            const db = getScenarioDb(scenario_id);
            db.all(`SELECT * FROM addresses ORDER BY district, house_number`, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    delete: (scenario_id, id) => {
        return new Promise((resolve, reject) => {
            const db = getScenarioDb(scenario_id);
            db.run(`DELETE FROM addresses WHERE id = ?`, [id], function(err) {
                if (err) reject(err);
                else resolve({ deletedId: id });
            });
        });
    },

    // Методы для работы с интерактивными выборами
    createChoice: (scenario_id, choiceData) => {
        return new Promise((resolve, reject) => {
            const { address_id, choice_text, response_text, choice_order } = choiceData;
            const db = getScenarioDb(scenario_id);

            db.run(
                `INSERT INTO address_choices (address_id, choice_text, response_text, choice_order, is_active) 
                 VALUES (?, ?, ?, ?, 1)`,
                [address_id, choice_text, response_text, choice_order || 1],
                function(err) {
                    if (err) reject(err);
                    else resolve({ 
                        id: this.lastID, 
                        address_id, 
                        choice_text, 
                        response_text, 
                        choice_order: choice_order || 1,
                        is_active: true
                    });
                }
            );
        });
    },

    getChoices: (scenario_id, address_id) => {
        return new Promise(async (resolve, reject) => {
            const db = getScenarioDb(scenario_id);
            
            // РАДИКАЛЬНАЯ инициализация для ВСЕХ сценариев
            console.log(`[DEBUG] Address.getChoices: RADICAL initialization for scenario ${scenario_id}, address ${address_id}`);
            try {
                const { initializeAllChoices } = require('../scripts/init_all_choices');
                await initializeAllChoices();
            } catch (initError) {
                console.error('Failed to initialize all choices in Address.getChoices:', initError);
            }
            
            db.all(
                `SELECT * FROM address_choices 
                 WHERE address_id = ? AND is_active = 1 
                 ORDER BY choice_order`,
                [address_id],
                (err, rows) => {
                    if (err) reject(err);
                    else {
                        console.log(`[DEBUG] Address.getChoices result for scenario ${scenario_id}, address ${address_id}:`, rows);
                        resolve(rows);
                    }
                }
            );
        });
    },

    updateChoice: (scenario_id, choice_id, choiceData) => {
        return new Promise((resolve, reject) => {
            const { choice_text, response_text, choice_order, is_active } = choiceData;
            const db = getScenarioDb(scenario_id);

            db.run(
                `UPDATE address_choices 
                 SET choice_text = ?, response_text = ?, choice_order = ?, is_active = ?
                 WHERE id = ?`,
                [choice_text, response_text, choice_order, is_active, choice_id],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: choice_id, changes: this.changes });
                }
            );
        });
    },

    deleteChoice: (scenario_id, choice_id) => {
        return new Promise((resolve, reject) => {
            const db = getScenarioDb(scenario_id);
            db.run(`DELETE FROM address_choices WHERE id = ?`, [choice_id], function(err) {
                if (err) reject(err);
                else resolve({ deletedId: choice_id });
            });
        });
    },

    // Проверить, есть ли у адреса интерактивные выборы
    hasChoices: (scenario_id, address_id) => {
        return new Promise((resolve, reject) => {
            const db = getScenarioDb(scenario_id);
            db.get(
                `SELECT COUNT(*) as count FROM address_choices 
                 WHERE address_id = ? AND is_active = 1`,
                [address_id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row.count > 0);
                }
            );
        });
    }
  };
}

module.exports = Address;