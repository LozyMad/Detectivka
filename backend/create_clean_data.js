const { query } = require('./config/database');

async function createCleanData() {
    try {
        console.log('Creating clean data...');
        
        // Создаем сценарий
        await query('INSERT INTO scenarios (name, description, is_active) VALUES ($1, $2, $3)', ['Тестовый сценарий', 'Описание тестового сценария', true]);
        console.log('Scenario created');
        
        // Получаем ID сценария
        const scenarioResult = await query('SELECT id FROM scenarios WHERE name = $1', ['Тестовый сценарий']);
        const scenarioId = scenarioResult.rows[0].id;
        console.log('Scenario ID:', scenarioId);
        
        // Создаем вопросы
        await query('INSERT INTO questions (scenario_id, question_text) VALUES ($1, $2)', [scenarioId, 'Как зовут детектива?']);
        await query('INSERT INTO questions (scenario_id, question_text) VALUES ($1, $2)', [scenarioId, 'Где произошло преступление?']);
        console.log('Questions created');
        
        // Создаем адреса
        await query('INSERT INTO addresses (scenario_id, district, house_number, description) VALUES ($1, $2, $3, $4)', [scenarioId, 'С', '1', 'Дом детектива']);
        await query('INSERT INTO addresses (scenario_id, district, house_number, description) VALUES ($1, $2, $3, $4)', [scenarioId, 'С', '2', 'Место преступления']);
        console.log('Addresses created');
        
        // Проверяем данные
        const questions = await query('SELECT * FROM questions WHERE scenario_id = $1', [scenarioId]);
        console.log('Questions:', questions.rows);
        
        const addresses = await query('SELECT * FROM addresses WHERE scenario_id = $1', [scenarioId]);
        console.log('Addresses:', addresses.rows);
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

createCleanData();

