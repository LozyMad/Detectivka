const express = require('express');
const router = express.Router();
const choiceController = require('../controllers/choiceController');
const { authenticateToken } = require('../middleware/auth');

// ===== АДМИНСКИЕ МАРШРУТЫ =====

// Получить все варианты выбора для адреса
router.get('/admin/scenarios/:scenario_id/addresses/:address_id/choices', 
    authenticateToken, 
    choiceController.getAddressChoices
);

// Создать новый вариант выбора
router.post('/admin/scenarios/:scenario_id/addresses/:address_id/choices', 
    authenticateToken, 
    choiceController.createAddressChoice
);

// Обновить вариант выбора
router.put('/admin/scenarios/:scenario_id/choices/:choice_id', 
    authenticateToken, 
    choiceController.updateAddressChoice
);

// Удалить вариант выбора
router.delete('/admin/scenarios/:scenario_id/choices/:choice_id', 
    authenticateToken, 
    choiceController.deleteAddressChoice
);

// Проверить, есть ли у адреса интерактивные выборы
router.get('/admin/scenarios/:scenario_id/addresses/:address_id/has-choices', 
    authenticateToken, 
    choiceController.checkAddressHasChoices
);

// ===== ИГРОВЫЕ МАРШРУТЫ =====

// Получить варианты выбора для игрока
router.get('/game/scenarios/:scenario_id/addresses/:address_id/choices', 
    authenticateToken,
    choiceController.getGameChoices
);

// Сделать выбор игроком
router.post('/game/make-choice', 
    authenticateToken,
    choiceController.makePlayerChoice
);

// Получить историю выборов игрока
router.get('/game/players/:room_user_id/choice-history', 
    authenticateToken,
    choiceController.getPlayerChoiceHistory
);

// Получить выбор игрока для конкретного адреса
router.get('/game/players/:room_user_id/scenarios/:scenario_id/addresses/:address_id/choice', 
    authenticateToken,
    choiceController.getPlayerChoiceForAddress
);

module.exports = router;
