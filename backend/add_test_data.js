const { query } = require('./config/database');

async function addTestData() {
    try {
        console.log('Adding test data...');
        
        // Добавляем вопрос
        await query('INSERT INTO questions (scenario_id, question_text) VALUES (12, $1)', ['Как зовут детектива?']);
        console.log('Question added');
        
        // Добавляем адрес
        await query('INSERT INTO addresses (scenario_id, district, house_number, description) VALUES (12, $1, $2, $3)', ['С', '1', 'Дом детектива']);
        console.log('Address added');
        
        // Проверяем данные
        const questions = await query('SELECT * FROM questions WHERE scenario_id = 12');
        console.log('Questions:', questions.rows);
        
        const addresses = await query('SELECT * FROM addresses WHERE scenario_id = 12');
        console.log('Addresses:', addresses.rows);
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

addTestData();

