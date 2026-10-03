const { query } = require('../config/database');

const Room = {
    create: async (roomData) => {
        const { name, scenario_id, created_by, duration_seconds = 3600, is_test = false } = roomData;
        
        const result = await query(
            `INSERT INTO rooms (name, scenario_id, created_by, duration_seconds, is_test, state, game_start_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name, scenario_id, created_by, is_test ? 0 : duration_seconds, is_test,
                is_test ? 'running' : 'pending', is_test ? new Date().toISOString() : null]
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

    updateTestScenario: async (roomId, scenarioId) => {
        const result = await query(
            `UPDATE rooms SET scenario_id = $1 WHERE id = $2 AND is_test = TRUE RETURNING id`,
            [scenarioId, roomId]
        );
        return result.rows.length > 0;
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
        
        // 5. Удаляем посещения тестовой комнаты во всех сценариях, между которыми её переключали
        try {
            const roomResult = await query(`SELECT scenario_id, is_test FROM rooms WHERE id = $1`, [id]);
            if (roomResult.rows.length > 0) {
                const room = roomResult.rows[0];
                const scenarioIds = room.is_test
                    ? (await query(`SELECT id FROM scenarios`)).rows.map(scenario => scenario.id)
                    : [room.scenario_id];
                for (const scenarioId of scenarioIds) {
                    await query(`DELETE FROM scenario_${scenarioId}.visited_locations WHERE room_id = $1`, [id]);
                }
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
        const room = await Room.getById(roomId);
        if (!room) throw new Error('Room not found');

        const durationSeconds = room.duration_seconds || 3600;
        const now = new Date();
        const endTime = new Date(now.getTime() + durationSeconds * 1000);

        const result = await query(
            `UPDATE rooms 
             SET game_start_time = $1, game_end_time = $2, paused_at = NULL,
                 halfway_paused = FALSE, state = 'running'
             WHERE id = $3 AND state IN ('pending', 'finished') RETURNING *`,
            [now.toISOString(), endTime.toISOString(), roomId]
        );

        if (!result.rows[0]) throw new Error('Room cannot be started in its current state');
        return result.rows[0];
    },

    pauseGame: async (roomId, pausedAt = new Date().toISOString(), automatic = false) => {
        const result = await query(
            `UPDATE rooms SET state = 'paused', paused_at = $2,
             halfway_paused = CASE WHEN $3 THEN TRUE ELSE halfway_paused END
             WHERE id = $1 AND state = 'running' AND (NOT $3 OR halfway_paused = FALSE) RETURNING *`,
            [roomId, pausedAt, automatic]
        );

        return result.rows[0] || null;
    },

    resumeGame: async (roomId) => {
        const room = await Room.getById(roomId);
        if (!room || room.state !== 'paused') return null;
        const now = new Date();
        const pausedAt = new Date(room.paused_at || now);
        const remainingMs = Math.max(0, new Date(room.game_end_time) - pausedAt);
        const endTime = new Date(now.getTime() + remainingMs);
        const result = await query(
            `UPDATE rooms SET state = 'running', game_end_time = $2, paused_at = NULL
             WHERE id = $1 AND state = 'paused' RETURNING *`,
            [roomId, endTime.toISOString()]
        );

        return result.rows[0] || null;
    },

    finishIfRunning: async (roomId, now = new Date().toISOString()) => {
        const result = await query(
            `UPDATE rooms SET state = 'finished'
             WHERE id = $1 AND state = 'running' AND game_end_time <= $2 RETURNING id`,
            [roomId, now]
        );
        return result.rows.length > 0;
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
