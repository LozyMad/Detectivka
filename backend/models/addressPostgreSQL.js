const { queryScenario, ensureTables } = require('../config/scenarioPostgreSQL');
const { query } = require('../config/database');

const Address = {
    create: async (addressData) => {
        const { scenario_id, district, house_number, description } = addressData;
        
        // Убеждаемся что таблицы созданы
        await ensureTables(scenario_id);
        
        // Создаем в сценарий-специфичной таблице
        const result = await queryScenario(
            scenario_id,
            `INSERT INTO scenario_${scenario_id}.addresses (district, house_number, description) 
             VALUES ($1, $2, $3) RETURNING *`,
            [district, house_number, description]
        );
        
        const address = result.rows[0];
        
        // Также создаем в главной таблице для совместимости
        await query(
            `INSERT INTO addresses (scenario_id, district, house_number, description) 
             VALUES ($1, $2, $3, $4)`,
            [scenario_id, district, house_number, description]
        );
        
        return { ...address, scenario_id };
    },

    findByScenarioAndAddress: async (scenario_id, district, house_number) => {
        await ensureTables(scenario_id);
        
        const result = await queryScenario(
            scenario_id,
            `SELECT * FROM scenario_${scenario_id}.addresses 
             WHERE district = $1 AND house_number = $2`,
            [district, house_number]
        );
        
        return result.rows[0] || null;
    },

    getByScenario: async (scenario_id) => {
        await ensureTables(scenario_id);
        
        const result = await queryScenario(
            scenario_id,
            `SELECT * FROM scenario_${scenario_id}.addresses ORDER BY district, house_number`
        );
        
        return result.rows;
    },

    getById: async (scenario_id, id) => {
        await ensureTables(scenario_id);
        
        const result = await queryScenario(
            scenario_id,
            `SELECT * FROM scenario_${scenario_id}.addresses WHERE id = $1`,
            [id]
        );
        
        return result.rows[0] || null;
    },

    update: async (scenario_id, id, addressData) => {
        const { district, house_number, description } = addressData;
        
        // Обновляем в сценарий-специфичной таблице
        const result = await queryScenario(
            scenario_id,
            `UPDATE scenario_${scenario_id}.addresses 
             SET district = $1, house_number = $2, description = $3 
             WHERE id = $4 RETURNING *`,
            [district, house_number, description, id]
        );
        
        // Также обновляем в главной таблице
        await query(
            `UPDATE addresses 
             SET district = $1, house_number = $2, description = $3 
             WHERE scenario_id = $4 AND id = $5`,
            [district, house_number, description, scenario_id, id]
        );
        
        return result.rows[0] || null;
    },

    delete: async (scenario_id, id) => {
        // Удаляем из сценарий-специфичной таблицы
        const result = await queryScenario(
            scenario_id,
            `DELETE FROM scenario_${scenario_id}.addresses WHERE id = $1 RETURNING *`,
            [id]
        );
        
        // Также удаляем из главной таблицы
        await query(
            `DELETE FROM addresses WHERE scenario_id = $1 AND id = $2`,
            [scenario_id, id]
        );
        
        return result.rows[0] || null;
    },

    // Методы для работы с интерактивными выборами
    createChoice: async (scenario_id, choiceData) => {
        const { address_id, choice_text, response_text, choice_order } = choiceData;
        
        const result = await queryScenario(
            scenario_id,
            `INSERT INTO scenario_${scenario_id}.address_choices 
             (address_id, choice_text, response_text, choice_order, is_active) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [address_id, choice_text, response_text, choice_order || 1, true]
        );
        
        return result.rows[0];
    },

    getChoices: async (scenario_id, address_id) => {
        const result = await queryScenario(
            scenario_id,
            `SELECT * FROM scenario_${scenario_id}.address_choices 
             WHERE address_id = $1 AND is_active = true 
             ORDER BY choice_order`,
            [address_id]
        );
        
        return result.rows;
    },

    updateChoice: async (scenario_id, choice_id, choiceData) => {
        const { choice_text, response_text, choice_order, is_active } = choiceData;
        
        const result = await queryScenario(
            scenario_id,
            `UPDATE scenario_${scenario_id}.address_choices 
             SET choice_text = $1, response_text = $2, choice_order = $3, is_active = $4,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $5 RETURNING *`,
            [choice_text, response_text, choice_order, is_active, choice_id]
        );
        
        return result.rows[0] || null;
    },

    deleteChoice: async (scenario_id, choice_id) => {
        const result = await queryScenario(
            scenario_id,
            `DELETE FROM scenario_${scenario_id}.address_choices WHERE id = $1 RETURNING *`,
            [choice_id]
        );
        
        return result.rows[0] || null;
    },

    hasChoices: async (scenario_id, address_id) => {
        const result = await queryScenario(
            scenario_id,
            `SELECT COUNT(*) as count FROM scenario_${scenario_id}.address_choices 
             WHERE address_id = $1 AND is_active = true`,
            [address_id]
        );
        
        return parseInt(result.rows[0].count) > 0;
    },

    // Алиас для совместимости
    findByScenario: async (scenarioId) => {
        // Читаем из главной таблицы addresses
        const result = await query('SELECT * FROM addresses WHERE scenario_id = $1 ORDER BY id', [scenarioId]);
        return result.rows;
    }
};

module.exports = Address;
