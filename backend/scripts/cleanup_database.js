const { query } = require('../config/database');
const db = require('../config/scenarioDatabase');

async function cleanupDatabase() {
    console.log('🧹 НАЧИНАЕМ ПОЛНУЮ ОЧИСТКУ БАЗЫ ДАННЫХ...');
    console.log('⚠️  ВНИМАНИЕ: Это удалит ВСЕ данные кроме суперадмина!');
    
    try {
        // 1. Удаляем все комнаты
        console.log('\n🗑️  Удаляем все комнаты...');
        await query('DELETE FROM rooms');
        console.log('✅ Комнаты удалены');

        // 2. Удаляем всех игроков кроме суперадмина
        console.log('\n🗑️  Удаляем всех игроков кроме суперадмина...');
        const result = await query('DELETE FROM users WHERE admin_level != "superadmin"');
        console.log(`✅ Удалено ${result.rowCount} игроков`);

        // 3. Удаляем все сценарии
        console.log('\n🗑️  Удаляем все сценарии...');
        await query('DELETE FROM scenarios');
        console.log('✅ Сценарии удалены');

        // 4. Удаляем все адреса
        console.log('\n🗑️  Удаляем все адреса...');
        await query('DELETE FROM addresses');
        console.log('✅ Адреса удалены');

        // 5. Удаляем все файлы сценариев SQLite
        console.log('\n🗑️  Удаляем файлы сценариев SQLite...');
        const fs = require('fs');
        const path = require('path');
        const scenariosDir = path.join(__dirname, '../scenarios');
        
        if (fs.existsSync(scenariosDir)) {
            const files = fs.readdirSync(scenariosDir);
            for (const file of files) {
                if (file.endsWith('.db')) {
                    fs.unlinkSync(path.join(scenariosDir, file));
                    console.log(`   ✅ Удален файл: ${file}`);
                }
            }
        }

        // 6. Проверяем что суперадмин остался
        console.log('\n🔍 Проверяем суперадмина...');
        const adminResult = await query('SELECT id, username, admin_level FROM users WHERE admin_level = "superadmin"');
        if (adminResult.rows.length > 0) {
            console.log('✅ Суперадмин сохранен:', adminResult.rows[0]);
        } else {
            console.log('❌ ОШИБКА: Суперадмин не найден!');
        }

        // 7. Проверяем что все остальное удалено
        console.log('\n📊 Финальная статистика:');
        const stats = await Promise.all([
            query('SELECT COUNT(*) as count FROM users'),
            query('SELECT COUNT(*) as count FROM scenarios'),
            query('SELECT COUNT(*) as count FROM addresses'),
            query('SELECT COUNT(*) as count FROM rooms')
        ]);

        console.log(`👥 Пользователей: ${stats[0].rows[0].count}`);
        console.log(`🎭 Сценариев: ${stats[1].rows[0].count}`);
        console.log(`🏠 Адресов: ${stats[2].rows[0].count}`);
        console.log(`🏠 Комнат: ${stats[3].rows[0].count}`);

        console.log('\n🎉 ПОЛНАЯ ОЧИСТКА ЗАВЕРШЕНА!');
        console.log('✅ База данных очищена, суперадмин сохранен');
        console.log('🚀 Теперь можно создавать новую игру с нуля!');

    } catch (error) {
        console.error('❌ Ошибка при очистке базы данных:', error);
    }
}

module.exports = { cleanupDatabase };

// Если скрипт запущен напрямую, выполняем очистку
if (require.main === module) {
    cleanupDatabase().catch(console.error);
}
