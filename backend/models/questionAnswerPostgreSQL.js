const { query } = require('../config/database');

const QuestionAnswer = {
    create: async ({ question_id, user_id, room_user_id, answer_text }) => {
        const result = await query(
            `INSERT INTO question_answers (question_id, user_id, room_user_id, answer_text) 
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [question_id, user_id, room_user_id, answer_text]
        );
        
        return result.rows[0];
    },

    getByQuestionAndUser: async (question_id, user_id, room_user_id = null) => {
        let sql = `SELECT * FROM question_answers WHERE question_id = $1 AND `;
        let params = [question_id];
        
        if (user_id) {
            sql += `user_id = $2`;
            params.push(user_id);
        } else if (room_user_id) {
            sql += `room_user_id = $2`;
            params.push(room_user_id);
        }
        
        const result = await query(sql, params);
        return result.rows[0] || null;
    },

    getByUser: async (user_id, room_user_id) => {
        let sql = `SELECT qa.*, q.question_text, s.name as scenario_name 
                   FROM question_answers qa
                   LEFT JOIN questions q ON qa.question_id = q.id
                   LEFT JOIN scenarios s ON q.scenario_id = s.id
                   WHERE `;
        let params = [];
        
        if (user_id) {
            sql += `qa.user_id = $1`;
            params.push(user_id);
        } else if (room_user_id) {
            sql += `qa.room_user_id = $1`;
            params.push(room_user_id);
        }
        
        sql += ` ORDER BY qa.answered_at DESC`;
        
        const result = await query(sql, params);
        return result.rows;
    },

    update: async (id, { answer_text }) => {
        const result = await query(
            `UPDATE question_answers SET answer_text = $1 WHERE id = $2 RETURNING *`,
            [answer_text, id]
        );
        
        return result.rows[0] || null;
    },

    delete: async (id) => {
        const result = await query(
            `DELETE FROM question_answers WHERE id = $1 RETURNING *`,
            [id]
        );
        
        return result.rows[0] || null;
    },

    // Получить все ответы (для экспорта)
    getAll: async () => {
        const result = await query(
            `SELECT qa.*, q.question_text, s.name as scenario_name,
                    u.username as user_username, ru.username as room_user_username
             FROM question_answers qa
             LEFT JOIN questions q ON qa.question_id = q.id
             LEFT JOIN scenarios s ON q.scenario_id = s.id
             LEFT JOIN users u ON qa.user_id = u.id
             LEFT JOIN room_users ru ON qa.room_user_id = ru.id
             ORDER BY qa.answered_at DESC`
        );
        
        return result.rows;
    }
};

module.exports = QuestionAnswer;
