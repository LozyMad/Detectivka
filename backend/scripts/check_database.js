const { query } = require('../config/database');

async function checkDatabase() {
    console.log('📊 ПРОВЕРКА СОСТОЯНИЯ БАЗЫ ДАННЫХ...');
    
    try {
        // Получаем статистику
        const [usersCount, scenariosCount, addressesCount, roomsCount] = await Promise.all([
            query('SELECT COUNT(*) as count FROM users'),
            query('SELECT COUNT(*) as count FROM scenarios'),
            query('SELECT COUNT(*) as count FROM addresses'),
            query('SELECT COUNT(*) as count FROM rooms')
        ]);
        
        console.log('\n📈 СТАТИСТИКА:');
        console.log(`👥 Пользователей: ${usersCount.rows[0].count}`);
        console.log(`🎭 Сценариев: ${scenariosCount.rows[0].count}`);
        console.log(`🏠 Адресов: ${addressesCount.rows[0].count}`);
        console.log(`🏠 Комнат: ${roomsCount.rows[0].count}`);
        
        // Показываем пользователей
        const users = await query('SELECT id, username, admin_level, is_admin FROM users');
        console.log('\n👤 ПОЛЬЗОВАТЕЛИ:');
        if (users.rows.length === 0) {
            console.log('   (нет пользователей)');
        } else {
            users.rows.forEach(user => {
                console.log(`   ID: ${user.id}, Логин: ${user.username}, Роль: ${user.admin_level}, Админ: ${user.is_admin}`);
            });
        }
        
        console.log('\n✅ Проверка завершена!');
        
    } catch (error) {
        console.error('❌ Ошибка при проверке базы данных:', error);
    }
}

module.exports = { checkDatabase };

// Если скрипт запущен напрямую, выполняем проверку
if (require.main === module) {
    checkDatabase().catch(console.error);
}
