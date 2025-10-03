const { query } = require('../config/database');
const { ensureTables } = require('../config/scenarioPostgreSQL');

const Scenario = {
    create: async (scenarioData) => {
        const { name, description, is_active = false, created_by } = scenarioData;
        
        const result = await query(
            `INSERT INTO scenarios (name, description, is_active, created_by) 
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [name, description, is_active, created_by]
        );
        
        const scenario = result.rows[0];
        
        // Создаем таблицы для нового сценария
        await ensureTables(scenario.id);
        
        return scenario;
    },

    getAll: async () => {
        const result = await query(
            `SELECT s.*, u.username as created_by_username 
             FROM scenarios s 
             LEFT JOIN users u ON s.created_by = u.id 
             ORDER BY s.created_at DESC`
        );
        
        return result.rows;
    },

    getById: async (id) => {
        const result = await query(
            `SELECT s.*, u.username as created_by_username 
             FROM scenarios s 
             LEFT JOIN users u ON s.created_by = u.id 
             WHERE s.id = $1`,
            [id]
        );
        
        return result.rows[0] || null;
    },

    getActive: async () => {
        const result = await query(
            `SELECT * FROM scenarios WHERE is_active = true LIMIT 1`
        );
        
        return result.rows[0] || null;
    },

    update: async (id, scenarioData) => {
        const { name, description, is_active } = scenarioData;
        
        const result = await query(
            `UPDATE scenarios 
             SET name = $1, description = $2, is_active = $3 
             WHERE id = $4 RETURNING *`,
            [name, description, is_active, id]
        );
        
        return result.rows[0] || null;
    },

    delete: async (id) => {
        // Сначала удаляем связанные записи в правильном порядке
        // 1. Удаляем записи из game_choices (используем scenario_id)
        await query(`DELETE FROM game_choices WHERE scenario_id = $1`, [id]);
        
        // 2. Удаляем записи из question_answers (если есть room_user_id)
        await query(`DELETE FROM question_answers WHERE room_user_id IN (SELECT id FROM room_users WHERE room_id IN (SELECT id FROM rooms WHERE scenario_id = $1))`, [id]);
        
        // 3. Удаляем пользователей комнат этого сценария
        await query(`DELETE FROM room_users WHERE room_id IN (SELECT id FROM rooms WHERE scenario_id = $1)`, [id]);
        
        // 4. Удаляем записи из visit_attempts
        await query(`DELETE FROM visit_attempts WHERE room_id IN (SELECT id FROM rooms WHERE scenario_id = $1)`, [id]);
        
        // 5. Удаляем записи из visited_locations в схеме сценария
        try {
            await query(`DELETE FROM scenario_${id}.visited_locations`);
        } catch (error) {
            console.log('Visited locations table does not exist for scenario', id);
        }
        
        // 6. Удаляем комнаты этого сценария
        await query(`DELETE FROM rooms WHERE scenario_id = $1`, [id]);
        
        // 7. Удаляем адреса этого сценария из основной таблицы
        await query(`DELETE FROM addresses WHERE scenario_id = $1`, [id]);
        
        // 8. Удаляем вопросы этого сценария
        await query(`DELETE FROM questions WHERE scenario_id = $1`, [id]);
        
        // 9. Удаляем разрешения для этого сценария
        await query(`DELETE FROM admin_permissions WHERE scenario_id = $1`, [id]);
        
        // 10. Удаляем схему сценария (если существует)
        try {
            await query(`DROP SCHEMA IF EXISTS scenario_${id} CASCADE`);
        } catch (error) {
            console.log('Schema scenario_' + id + ' does not exist or already dropped');
        }
        
        // 11. Теперь можно безопасно удалить сценарий
        const result = await query(
            `DELETE FROM scenarios WHERE id = $1 RETURNING *`,
            [id]
        );
        
        return result.rows[0] || null;
    },

    setActive: async (id) => {
        // Сначала деактивируем все сценарии
        await query(`UPDATE scenarios SET is_active = false`);
        
        // Затем активируем выбранный
        const result = await query(
            `UPDATE scenarios SET is_active = true WHERE id = $1 RETURNING *`,
            [id]
        );
        
        return result.rows[0] || null;
    },

    // Получить сценарии доступные админу
    getByAdmin: async (adminId, adminLevel) => {
        if (adminLevel === 'super_admin') {
            return await Scenario.getAll();
        }
        
        const result = await query(
            `SELECT DISTINCT s.*, u.username as created_by_username 
             FROM scenarios s 
             LEFT JOIN users u ON s.created_by = u.id 
             INNER JOIN admin_permissions ap ON s.id = ap.scenario_id 
             WHERE ap.admin_id = $1 
             ORDER BY s.created_at DESC`,
            [adminId]
        );
        
        return result.rows;
    },

    // Алиас для совместимости
    getAvailableForAdmin: async (adminId, adminLevel) => {
        return await Scenario.getByAdmin(adminId, adminLevel);
    }
};

module.exports = Scenario;
