const express = require('express');
const { authenticateToken, superAdminRequired } = require('../middleware/auth');
const { nuclearResetPostgreSQL } = require('../scripts/nuclear_reset_postgresql');

const router = express.Router();

// Все маршруты требуют аутентификации и супер-админских прав
router.use(authenticateToken);
router.use(superAdminRequired);

// Ядерный сброс базы данных
router.post('/reset', async (req, res) => {
    try {
        console.log('💥 Запуск ядерного сброса через API...');
        
        // Запускаем ядерный сброс
        await nuclearResetPostgreSQL();
        
        res.json({ 
            success: true, 
            message: 'Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.' 
        });
        
    } catch (error) {
        console.error('Ошибка при ядерном сбросе:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при выполнении ядерного сброса: ' + error.message 
        });
    }
});

module.exports = router;
