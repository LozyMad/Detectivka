const { getScenarioDb } = require('../config/scenarioDatabase');

const Address = {
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
    }
};

module.exports = Address;