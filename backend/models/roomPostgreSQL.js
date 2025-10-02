const { query } = require('../config/database');

const Room = {
    create: async (roomData) => {
        const { name, scenario_id, created_by, duration_seconds = 3600 } = roomData;
        
        const result = await query(
            `INSERT INTO rooms (name, scenario_id, created_by, duration_seconds, state) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name, scenario_id, created_by, duration_seconds, 'pending']
        );
        
        return result.rows[0];
    },

    getById: async (id) => {
        const result = await query(
            `SELECT r.*, s.name as scenario_name 
             FROM rooms r 
             LEFT JOIN scenarios s ON r.scenario_id = s.id 
             WHERE r.id = $1`,
            [id]
        );
        
        return result.rows[0] || null;
    },

    getAll: async () => {
        const result = await query(
            `SELECT r.*, s.name as scenario_name, u.username as creator_name
             FROM rooms r 
             LEFT JOIN scenarios s ON r.scenario_id = s.id 
             LEFT JOIN users u ON r.created_by = u.id 
             ORDER BY r.created_at DESC`
        );
        
        return result.rows;
    },

    getByCreator: async (created_by) => {
        const result = await query(
            `SELECT r.*, s.name as scenario_name 
             FROM rooms r 
             LEFT JOIN scenarios s ON r.scenario_id = s.id 
             WHERE r.created_by = $1 
             ORDER BY r.created_at DESC`,
            [created_by]
        );
        
        return result.rows;
    },

    update: async (id, roomData) => {
        const { name, scenario_id, duration_seconds, state } = roomData;
        
        const result = await query(
            `UPDATE rooms 
             SET name = $1, scenario_id = $2, duration_seconds = $3, state = $4 
             WHERE id = $5 RETURNING *`,
            [name, scenario_id, duration_seconds, state, id]
        );
        
        return result.rows[0] || null;
    },

    updateState: async (id, state, game_start_time = null, game_end_time = null) => {
        let sql = `UPDATE rooms SET state = $1`;
        let params = [state, id];
        let paramIndex = 2;
        
        if (game_start_time !== null) {
            sql += `, game_start_time = $${paramIndex}`;
            params.splice(-1, 0, game_start_time);
            paramIndex++;
        }
        
        if (game_end_time !== null) {
            sql += `, game_end_time = $${paramIndex}`;
            params.splice(-1, 0, game_end_time);
            paramIndex++;
        }
        
        sql += ` WHERE id = $${paramIndex} RETURNING *`;
        
        const result = await query(sql, params);
        return result.rows[0] || null;
    },

    delete: async (id) => {
        const result = await query(
            `DELETE FROM rooms WHERE id = $1 RETURNING *`,
            [id]
        );
        
        return result.rows[0] || null;
    },

    // Получить комнаты по сценарию
    getByScenario: async (scenario_id) => {
        const result = await query(
            `SELECT r.*, s.name as scenario_name, u.username as creator_name
             FROM rooms r 
             LEFT JOIN scenarios s ON r.scenario_id = s.id 
             LEFT JOIN users u ON r.created_by = u.id 
             WHERE r.scenario_id = $1 
             ORDER BY r.created_at DESC`,
            [scenario_id]
        );
        
        return result.rows;
    },

    // Получить активные комнаты
    getActive: async () => {
        const result = await query(
            `SELECT r.*, s.name as scenario_name, u.username as creator_name
             FROM rooms r 
             LEFT JOIN scenarios s ON r.scenario_id = s.id 
             LEFT JOIN users u ON r.created_by = u.id 
             WHERE r.state IN ('running', 'paused') 
             ORDER BY r.created_at DESC`
        );
        
        return result.rows;
    },

    // Получить статистику комнат
    getStats: async () => {
        const result = await query(`
            SELECT 
                COUNT(*) as total_rooms,
                COUNT(CASE WHEN state = 'pending' THEN 1 END) as pending_rooms,
                COUNT(CASE WHEN state = 'running' THEN 1 END) as running_rooms,
                COUNT(CASE WHEN state = 'paused' THEN 1 END) as paused_rooms,
                COUNT(CASE WHEN state = 'finished' THEN 1 END) as finished_rooms
            FROM rooms
        `);
        
        return result.rows[0];
    }
};

module.exports = Room;
