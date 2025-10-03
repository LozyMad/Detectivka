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
        // Сначала удаляем связанные записи в правильном порядке
        // 1. Удаляем записи из game_choices (используем room_user_id)
        await query(`DELETE FROM game_choices WHERE room_user_id IN (SELECT id FROM room_users WHERE room_id = $1)`, [id]);
        
        // 2. Удаляем записи из question_answers (если есть room_user_id)
        await query(`DELETE FROM question_answers WHERE room_user_id IN (SELECT id FROM room_users WHERE room_id = $1)`, [id]);
        
        // 3. Удаляем пользователей комнаты
        await query(`DELETE FROM room_users WHERE room_id = $1`, [id]);
        
        // 4. Удаляем записи из visit_attempts
        await query(`DELETE FROM visit_attempts WHERE room_id = $1`, [id]);
        
        // 5. Удаляем записи из visited_locations в схеме сценария
        try {
            const roomResult = await query(`SELECT scenario_id FROM rooms WHERE id = $1`, [id]);
            if (roomResult.rows.length > 0) {
                const scenarioId = roomResult.rows[0].scenario_id;
                await query(`DELETE FROM scenario_${scenarioId}.visited_locations WHERE room_id = $1`, [id]);
            }
        } catch (error) {
            console.log('Visited locations table does not exist for room', id);
        }
        
        // 6. Теперь можно безопасно удалить комнату
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
    },

    // Методы управления игрой
    startGame: async (roomId) => {
        const now = new Date();
        const endTime = new Date(now.getTime() + 3600 * 1000); // по умолчанию 1 час
        
        const result = await query(
            `UPDATE rooms 
             SET game_start_time = $1, game_end_time = $2, state = 'running'
             WHERE id = $3 RETURNING *`,
            [now.toISOString(), endTime.toISOString(), roomId]
        );
        
        return result.rows[0] || { id: roomId, game_start_time: now.toISOString(), game_end_time: endTime.toISOString() };
    },

    pauseGame: async (roomId) => {
        const result = await query(
            `UPDATE rooms SET state = 'paused' WHERE id = $1 RETURNING *`,
            [roomId]
        );
        
        return result.rows[0] || { id: roomId, state: 'paused' };
    },

    resumeGame: async (roomId) => {
        const result = await query(
            `UPDATE rooms SET state = 'running' WHERE id = $1 RETURNING *`,
            [roomId]
        );
        
        return result.rows[0] || { id: roomId, state: 'running' };
    },

    stopGame: async (roomId) => {
        const result = await query(
            `UPDATE rooms SET state = 'finished', game_end_time = $1 WHERE id = $2 RETURNING *`,
            [new Date().toISOString(), roomId]
        );
        
        return result.rows[0] || { id: roomId, state: 'finished' };
    },

    // Алиас для совместимости
    listByAdmin: async (adminId, adminLevel) => {
        if (adminLevel === 'super_admin') {
            return await Room.getAll();
        }
        return await Room.getByCreator(adminId);
    }
};

module.exports = Room;
