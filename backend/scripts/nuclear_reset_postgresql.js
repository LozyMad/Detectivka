const { query, getClient } = require('../config/postgresql');

async function nuclearResetPostgreSQL() {
    console.log('💥 ЯДЕРНЫЙ СБРОС PostgreSQL: ПОЛНОЕ УНИЧТОЖЕНИЕ ВСЕХ ДАННЫХ И ID...');
    console.log('⚠️  ВНИМАНИЕ: Это удалит ВСЕ данные и сбросит ВСЕ ID!');
    
    const client = await getClient();
    
    try {
        await client.query('BEGIN');
        
        // 1. Удаляем все данные из всех таблиц (в правильном порядке из-за внешних ключей)
        console.log('\n💥 Уничтожаем все данные...');
        
        // Удаляем таблицы с внешними ключами сначала
        await client.query('DELETE FROM game_choices');
        console.log('   💥 game_choices очищена');
        
        await client.query('DELETE FROM question_answers');
        console.log('   💥 question_answers очищена');
        
        await client.query('DELETE FROM visited_locations');
        console.log('   💥 visited_locations очищена');
        
        await client.query('DELETE FROM visit_attempts');
        console.log('   💥 visit_attempts очищена');
        
        await client.query('DELETE FROM room_users');
        console.log('   💥 room_users очищена');
        
        await client.query('DELETE FROM rooms');
        console.log('   💥 rooms очищена');
        
        await client.query('DELETE FROM questions');
        console.log('   💥 questions очищена');
        
        await client.query('DELETE FROM addresses');
        console.log('   💥 addresses очищена');

        await client.query('DELETE FROM address_book_entries');
        console.log('   💥 address_book_entries очищена');
        
        await client.query('DELETE FROM admin_permissions');
        console.log('   💥 admin_permissions очищена');
        
        await client.query('DELETE FROM scenarios');
        console.log('   💥 scenarios очищена');
        
        // Удаляем всех пользователей кроме суперадмина
        await client.query('DELETE FROM users WHERE admin_level != $1', ['super_admin']);
        console.log('   💥 users очищена (кроме суперадмина)');

        // 2. Сбрасываем последовательности (автоинкремент) для всех таблиц
        console.log('\n🔄 Сбрасываем автоинкремент ID...');
        
        const sequences = [
            'users_id_seq',
            'scenarios_id_seq', 
            'rooms_id_seq',
            'room_users_id_seq',
            'addresses_id_seq',
            'address_book_entries_id_seq',
            'questions_id_seq',
            'question_answers_id_seq',
            'visited_locations_id_seq',
            'visit_attempts_id_seq',
            'game_choices_id_seq',
            'admin_permissions_id_seq'
        ];
        
        for (const seq of sequences) {
            try {
                await client.query(`SELECT setval('${seq}', 1, false)`);
                console.log(`   ✅ ${seq} сброшена`);
            } catch (err) {
                // Игнорируем ошибки если последовательность не существует
                console.log(`   ⚠️  ${seq} не найдена (пропускаем)`);
            }
        }

        // 3. Проверяем что суперадмин остался
        console.log('\n🔍 Проверяем суперадмина...');
        const adminResult = await client.query('SELECT id, username, admin_level FROM users WHERE admin_level = $1', ['super_admin']);
        
        if (adminResult.rows.length > 0) {
            console.log('✅ Суперадмин сохранен:', adminResult.rows[0]);
        } else {
            console.log('❌ ОШИБКА: Суперадмин не найден! Создаем...');
            
            const bcrypt = require('bcryptjs');
            const hashedPassword = bcrypt.hashSync('admin123', 10);
            
            await client.query(
                'INSERT INTO users (id, username, password, is_admin, admin_level) VALUES ($1, $2, $3, $4, $5)',
                [1, 'admin', hashedPassword, true, 'super_admin']
            );
            console.log('✅ Суперадмин создан с ID 1');
        }

        // 4. Проверяем результат
        console.log('\n📊 ФИНАЛЬНАЯ ПРОВЕРКА:');
        const stats = await Promise.all([
            client.query('SELECT COUNT(*) as count FROM users'),
            client.query('SELECT COUNT(*) as count FROM scenarios'),
            client.query('SELECT COUNT(*) as count FROM addresses'),
            client.query('SELECT COUNT(*) as count FROM rooms'),
            client.query('SELECT COUNT(*) as count FROM game_choices')
        ]);

        console.log(`👥 Пользователей: ${stats[0].rows[0].count}`);
        console.log(`🎭 Сценариев: ${stats[1].rows[0].count}`);
        console.log(`🏠 Адресов: ${stats[2].rows[0].count}`);
        console.log(`🏠 Комнат: ${stats[3].rows[0].count}`);
        console.log(`🎯 Выборов: ${stats[4].rows[0].count}`);

        // Показываем суперадмина
        const admin = await client.query('SELECT id, username, admin_level FROM users WHERE admin_level = $1', ['super_admin']);
        console.log(`👑 Суперадмин: ID ${admin.rows[0].id}, Логин: ${admin.rows[0].username}, Роль: ${admin.rows[0].admin_level}`);

        await client.query('COMMIT');
        
        console.log('\n🎉 ЯДЕРНЫЙ СБРОС PostgreSQL ЗАВЕРШЕН!');
        console.log('💥 ВСЕ данные уничтожены, ВСЕ ID сброшены!');
        console.log('🚀 Система готова для создания новой игры с ID начиная с 1!');
        console.log('📋 Данные для входа: admin / admin123');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка при ядерном сбросе PostgreSQL:', error);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { nuclearResetPostgreSQL };

// Если скрипт запущен напрямую, выполняем сброс
if (require.main === module) {
    nuclearResetPostgreSQL().catch(console.error);
}
