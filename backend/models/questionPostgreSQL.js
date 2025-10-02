const { query } = require('../config/database');

const Question = {
    create: async (questionData) => {
        const { scenario_id, question_text, question_order = 1, is_active = true } = questionData;
        
        const result = await query(
            `INSERT INTO questions (scenario_id, question_text, question_order, is_active) 
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [scenario_id, question_text, question_order, is_active]
        );
        
        return result.rows[0];
    },

    getByScenario: async (scenario_id) => {
        const result = await query(
            `SELECT * FROM questions 
             WHERE scenario_id = $1 AND is_active = true 
             ORDER BY question_order`,
            [scenario_id]
        );
        
        return result.rows;
    },

    getById: async (id) => {
        const result = await query(
            `SELECT * FROM questions WHERE id = $1`,
            [id]
        );
        
        return result.rows[0] || null;
    },

    update: async (id, questionData) => {
        const { question_text, question_order, is_active } = questionData;
        
        const result = await query(
            `UPDATE questions 
             SET question_text = $1, question_order = $2, is_active = $3 
             WHERE id = $4 RETURNING *`,
            [question_text, question_order, is_active, id]
        );
        
        return result.rows[0] || null;
    },

    delete: async (id) => {
        const result = await query(
            `DELETE FROM questions WHERE id = $1 RETURNING *`,
            [id]
        );
        
        return result.rows[0] || null;
    },

    // Получить все вопросы для всех сценариев (для экспорта)
    getAll: async () => {
        const result = await query(
            `SELECT * FROM questions ORDER BY scenario_id, question_order`
        );
        
        return result.rows;
    }
};

module.exports = Question;
