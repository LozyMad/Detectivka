const bcrypt = require('bcryptjs');
const { query } = require('../config/database');

async function createSuperAdmin() {
    console.log('👑 СОЗДАНИЕ СУПЕРАДМИНА...');
    
    try {
        // Проверяем, есть ли уже суперадмин
        const existingAdmin = await query('SELECT * FROM users WHERE admin_level = "superadmin"');
        
        if (existingAdmin.rows.length > 0) {
            console.log('✅ Суперадмин уже существует:', existingAdmin.rows[0].username);
            return;
        }
        
        // Создаем суперадмина
        const username = 'admin';
        const password = 'admin123';
        const hashedPassword = bcrypt.hashSync(password, 10);
        
        await query(
            'INSERT INTO users (username, password, is_admin, admin_level) VALUES (?, ?, ?, ?)',
            [username, hashedPassword, true, 'superadmin']
        );
        
        console.log('✅ Суперадмин создан успешно!');
        console.log('📋 Данные для входа:');
        console.log('   👤 Логин: admin');
        console.log('   🔑 Пароль: admin123');
        console.log('   🎭 Роль: superadmin');
        
    } catch (error) {
        console.error('❌ Ошибка при создании суперадмина:', error);
    }
}

module.exports = { createSuperAdmin };

// Если скрипт запущен напрямую, выполняем создание
if (require.main === module) {
    createSuperAdmin().catch(console.error);
}
