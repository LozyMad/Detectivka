const { db } = require('../config/database');

const QuestionAnswer = {
    create: ({ question_id, user_id, room_user_id, answer_text }) => {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO question_answers (question_id, user_id, room_user_id, answer_text) VALUES (?, ?, ?, ?)`,
                [question_id, user_id, room_user_id, answer_text],
                function(err) {
                    if (err) return reject(err);
                    resolve({ 
                        id: this.lastID, 
                        question_id, 
                        user_id, 
                        room_user_id, 
                        answer_text 
                    });
                }
            );
        });
    },



    getByQuestionAndUser: (question_id, user_id, room_user_id = null) => {
        return new Promise((resolve, reject) => {
            let query = `SELECT * FROM question_answers WHERE question_id = ? AND `;
            let params = [question_id];
            
            if (user_id) {
                query += `user_id = ?`;
                params.push(user_id);
            } else if (room_user_id) {
                query += `room_user_id = ?`;
                params.push(room_user_id);
            }
            
            db.get(query, params, (err, row) => (err ? reject(err) : resolve(row)));
        });
    },

    update: (id, { answer_text }) => {
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE question_answers SET answer_text = ? WHERE id = ?`,
                [answer_text, id],
                function(err) {
                    if (err) return reject(err);
                    resolve({ id, answer_text });
                }
            );
        });
    },

    delete: (id) => {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM question_answers WHERE id = ?`, [id], function(err) {
                if (err) return reject(err);
                resolve({ deletedId: id });
            });
        });
    }
};

module.exports = QuestionAnswer;
