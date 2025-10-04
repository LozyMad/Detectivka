const { query } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function nuclearReset() {
    console.log('💥 ЯДЕРНЫЙ СБРОС: ПОЛНОЕ УНИЧТОЖЕНИЕ ВСЕХ ДАННЫХ И ID...');
    console.log('⚠️  ВНИМАНИЕ: Это удалит ВСЕ данные и сбросит ВСЕ ID!');
    
    try {
        // 1. Удаляем все файлы сценариев SQLite
        console.log('\n🗑️  Уничтожаем все файлы сценариев SQLite...');
        const scenariosDir = path.join(__dirname, '../scenarios');
        
        if (fs.existsSync(scenariosDir)) {
            const files = fs.readdirSync(scenariosDir);
            for (const file of files) {
                if (file.endsWith('.db')) {
                    fs.unlinkSync(path.join(scenariosDir, file));
                    console.log(`   💥 Уничтожен файл: ${file}`);
                }
            }
        }

        // 2. Удаляем все таблицы (в правильном порядке из-за внешних ключей)
        console.log('\n💥 Уничтожаем все таблицы...');
        
        // Удаляем таблицы с внешними ключами сначала
        await query('DROP TABLE IF EXISTS address_choices');
        console.log('   💥 Таблица address_choices уничтожена');
        
        await query('DROP TABLE IF EXISTS addresses');
        console.log('   💥 Таблица addresses уничтожена');
        
        await query('DROP TABLE IF EXISTS rooms');
        console.log('   💥 Таблица rooms уничтожена');
        
        await query('DROP TABLE IF EXISTS users');
        console.log('   💥 Таблица users уничтожена');
        
        await query('DROP TABLE IF EXISTS scenarios');
        console.log('   💥 Таблица scenarios уничтожена');

        // 3. Пересоздаем таблицы с нуля (ID начнутся с 1)
        console.log('\n🏗️  Пересоздаем таблицы с нуля...');
        
        // Таблица scenarios
        await query(`
            CREATE TABLE scenarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                is_active BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('   ✅ Таблица scenarios пересоздана');

        // Таблица users
        await query(`
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                admin_level TEXT DEFAULT 'user',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('   ✅ Таблица users пересоздана');

        // Таблица rooms
        await query(`
            CREATE TABLE rooms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                scenario_id INTEGER,
                max_players INTEGER DEFAULT 4,
                current_players INTEGER DEFAULT 0,
                status TEXT DEFAULT 'waiting',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (scenario_id) REFERENCES scenarios (id)
            )
        `);
        console.log('   ✅ Таблица rooms пересоздана');

        // Таблица addresses
        await query(`
            CREATE TABLE addresses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scenario_id INTEGER NOT NULL,
                district TEXT NOT NULL,
                house_number TEXT NOT NULL,
                description TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (scenario_id) REFERENCES scenarios (id)
            )
        `);
        console.log('   ✅ Таблица addresses пересоздана');

        // Таблица address_choices
        await query(`
            CREATE TABLE address_choices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                address_id INTEGER NOT NULL,
                choice_text TEXT NOT NULL,
                response_text TEXT,
                choice_order INTEGER DEFAULT 1,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (address_id) REFERENCES addresses (id)
            )
        `);
        console.log('   ✅ Таблица address_choices пересоздана');

        // 4. Создаем суперадмина с ID 1
        console.log('\n👑 Создаем суперадмина с ID 1...');
        const bcrypt = require('bcryptjs');
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        
        await query(
            'INSERT INTO users (id, username, password, is_admin, admin_level) VALUES (?, ?, ?, ?, ?)',
            [1, 'admin', hashedPassword, true, 'superadmin']
        );
        console.log('   ✅ Суперадмин создан с ID 1');

        // 5. Проверяем результат
        console.log('\n📊 ФИНАЛЬНАЯ ПРОВЕРКА:');
        const stats = await Promise.all([
            query('SELECT COUNT(*) as count FROM users'),
            query('SELECT COUNT(*) as count FROM scenarios'),
            query('SELECT COUNT(*) as count FROM addresses'),
            query('SELECT COUNT(*) as count FROM rooms'),
            query('SELECT COUNT(*) as count FROM address_choices')
        ]);

        console.log(`👥 Пользователей: ${stats[0].rows[0].count}`);
        console.log(`🎭 Сценариев: ${stats[1].rows[0].count}`);
        console.log(`🏠 Адресов: ${stats[2].rows[0].count}`);
        console.log(`🏠 Комнат: ${stats[3].rows[0].count}`);
        console.log(`🎯 Выборов: ${stats[4].rows[0].count}`);

        // Показываем суперадмина
        const admin = await query('SELECT id, username, admin_level FROM users WHERE id = 1');
        console.log(`👑 Суперадмин: ID ${admin.rows[0].id}, Логин: ${admin.rows[0].username}, Роль: ${admin.rows[0].admin_level}`);

        console.log('\n🎉 ЯДЕРНЫЙ СБРОС ЗАВЕРШЕН!');
        console.log('💥 ВСЕ данные уничтожены, ВСЕ ID сброшены!');
        console.log('🚀 Система готова для создания новой игры с ID начиная с 1!');
        console.log('📋 Данные для входа: admin / admin123');

    } catch (error) {
        console.error('❌ Ошибка при ядерном сбросе:', error);
    }
}

module.exports = { nuclearReset };

// Если скрипт запущен напрямую, выполняем сброс
if (require.main === module) {
    nuclearReset().catch(console.error);
}
