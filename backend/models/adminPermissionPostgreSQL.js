const { query } = require('../config/database');

const AdminPermission = {
    create: async (permissionData) => {
        const { admin_id, scenario_id } = permissionData;
        
        const result = await query(
            `INSERT INTO admin_permissions (admin_id, scenario_id) 
             VALUES ($1, $2) RETURNING *`,
            [admin_id, scenario_id]
        );
        
        return result.rows[0];
    },

    delete: async (admin_id, scenario_id) => {
        const result = await query(
            `DELETE FROM admin_permissions 
             WHERE admin_id = $1 AND scenario_id = $2 RETURNING *`,
            [admin_id, scenario_id]
        );
        
        return result.rows[0] || null;
    },

    getByAdmin: async (admin_id) => {
        const result = await query(
            `SELECT ap.*, s.name as scenario_name 
             FROM admin_permissions ap 
             LEFT JOIN scenarios s ON ap.scenario_id = s.id 
             WHERE ap.admin_id = $1`,
            [admin_id]
        );
        
        return result.rows;
    },

    getByScenario: async (scenario_id) => {
        const result = await query(
            `SELECT ap.*, u.username as admin_username 
             FROM admin_permissions ap 
             LEFT JOIN users u ON ap.admin_id = u.id 
             WHERE ap.scenario_id = $1`,
            [scenario_id]
        );
        
        return result.rows;
    },

    getAll: async () => {
        const result = await query(
            `SELECT ap.*, u.username as admin_username, s.name as scenario_name 
             FROM admin_permissions ap 
             LEFT JOIN users u ON ap.admin_id = u.id 
             LEFT JOIN scenarios s ON ap.scenario_id = s.id 
             ORDER BY ap.created_at DESC`
        );
        
        return result.rows;
    },

    hasPermission: async (admin_id, scenario_id) => {
        const result = await query(
            `SELECT COUNT(*) as count FROM admin_permissions 
             WHERE admin_id = $1 AND scenario_id = $2`,
            [admin_id, scenario_id]
        );
        
        return parseInt(result.rows[0].count) > 0;
    }
};

module.exports = AdminPermission;
