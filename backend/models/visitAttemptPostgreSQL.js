const { query } = require('../config/database');

class VisitAttempt {
    static async create(attemptData) {
        const { user_id, scenario_id, room_id, district, house_number, found, address_id } = attemptData;
        
        const result = await query(
            `INSERT INTO visit_attempts (user_id, scenario_id, room_id, district, house_number, found, address_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [user_id, scenario_id, room_id, district, house_number, found, address_id]
        );
        
        return result.rows[0];
    }

    static async getByUserAndScenario(userId, scenarioId, roomId = null) {
        let sql = `SELECT 
            va.*,
            a.description as address_description,
            vl.id as visited_location_id
          FROM visit_attempts va
          LEFT JOIN addresses a ON va.address_id = a.id
          LEFT JOIN visited_locations vl ON va.address_id = vl.address_id 
            AND va.user_id = vl.user_id 
            AND va.scenario_id = vl.scenario_id
          WHERE va.user_id = $1 AND va.scenario_id = $2`;
        
        let params = [userId, scenarioId];
        
        if (roomId !== null) {
            sql += ' AND va.room_id = $3';
            params.push(roomId);
        }
        
        sql += ' ORDER BY va.attempted_at DESC LIMIT 100';
        
        const result = await query(sql, params);
        return result.rows;
    }

    static async getByScenario(scenarioId) {
        const result = await query(
            `SELECT va.*, u.username 
             FROM visit_attempts va 
             LEFT JOIN users u ON va.user_id = u.id 
             WHERE va.scenario_id = $1 
             ORDER BY va.attempted_at DESC`,
            [scenarioId]
        );
        
        return result.rows;
    }

    static async getStats(scenarioId) {
        const result = await query(`
            SELECT 
                COUNT(*) as total_attempts,
                COUNT(CASE WHEN found = true THEN 1 END) as successful_attempts,
                COUNT(DISTINCT user_id) as unique_users,
                COUNT(DISTINCT district) as districts_visited
            FROM visit_attempts 
            WHERE scenario_id = $1
        `, [scenarioId]);
        
        return result.rows[0];
    }
}

module.exports = VisitAttempt;
