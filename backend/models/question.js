const { db } = require('../config/database');

const Question = {
    create: ({ scenario_id, question_text }) => {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO questions (scenario_id, question_text) VALUES (?, ?)`,
                [scenario_id, question_text],
                function(err) {
                    if (err) return reject(err);
                    resolve({ id: this.lastID, scenario_id, question_text });
                }
            );
        });
    },

    getByScenario: (scenario_id) => {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT * FROM questions WHERE scenario_id = ? ORDER BY created_at ASC`,
                [scenario_id],
                (err, rows) => (err ? reject(err) : resolve(rows))
            );
        });
    },


    update: (id, { question_text }) => {
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE questions SET question_text = ? WHERE id = ?`,
                [question_text, id],
                function(err) {
                    if (err) return reject(err);
                    resolve({ id, question_text });
                }
            );
        });
    },

    delete: (id) => {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM questions WHERE id = ?`, [id], function(err) {
                if (err) return reject(err);
                resolve({ deletedId: id });
            });
        });
    },

};

module.exports = Question;
