const Address = require('../models/address');
const { db } = require('../config/database');

// ===== АДМИНСКИЕ МЕТОДЫ =====

// Получить все варианты выбора для адреса
const getAddressChoices = async (req, res) => {
    try {
        const { scenario_id, address_id } = req.params;
        
        const choices = await Address.getChoices(scenario_id, address_id);
        
        res.json({
            success: true,
            choices
        });
    } catch (error) {
        console.error('Get address choices error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Создать новый вариант выбора
const createAddressChoice = async (req, res) => {
    try {
        const { scenario_id, address_id } = req.params;
        const { choice_text, response_text, choice_order } = req.body;
        
        if (!choice_text || !response_text) {
            return res.status(400).json({ 
                error: 'Choice text and response text are required' 
            });
        }
        
        const choice = await Address.createChoice(scenario_id, {
            address_id,
            choice_text,
            response_text,
            choice_order
        });
        
        res.status(201).json({
            success: true,
            message: 'Choice created successfully',
            choice
        });
    } catch (error) {
        console.error('Create address choice error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Обновить вариант выбора
const updateAddressChoice = async (req, res) => {
    try {
        const { scenario_id, choice_id } = req.params;
        const { choice_text, response_text, choice_order, is_active } = req.body;
        
        const result = await Address.updateChoice(scenario_id, choice_id, {
            choice_text,
            response_text,
            choice_order,
            is_active
        });
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Choice not found' });
        }
        
        res.json({
            success: true,
            message: 'Choice updated successfully'
        });
    } catch (error) {
        console.error('Update address choice error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Удалить вариант выбора
const deleteAddressChoice = async (req, res) => {
    try {
        const { scenario_id, choice_id } = req.params;
        
        await Address.deleteChoice(scenario_id, choice_id);
        
        res.json({
            success: true,
            message: 'Choice deleted successfully'
        });
    } catch (error) {
        console.error('Delete address choice error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Проверить, есть ли у адреса интерактивные выборы
const checkAddressHasChoices = async (req, res) => {
    try {
        const { scenario_id, address_id } = req.params;
        
        const hasChoices = await Address.hasChoices(scenario_id, address_id);
        
        res.json({
            success: true,
            hasChoices
        });
    } catch (error) {
        console.error('Check address choices error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ===== ИГРОВЫЕ МЕТОДЫ =====

// Получить варианты выбора для игрока (только активные)
const getGameChoices = async (req, res) => {
    try {
        const { scenario_id, address_id } = req.params;
        
        const choices = await Address.getChoices(scenario_id, address_id);
        
        // Возвращаем только активные варианты без response_text (чтобы не спойлерить)
        const gameChoices = choices.map(choice => ({
            id: choice.id,
            choice_text: choice.choice_text,
            choice_order: choice.choice_order
        }));
        
        res.json({
            success: true,
            choices: gameChoices
        });
    } catch (error) {
        console.error('Get game choices error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Сделать выбор игроком
const makePlayerChoice = async (req, res) => {
    try {
        const { room_user_id, scenario_id, address_id, choice_id, visited_location_id } = req.body;
        
        if (!room_user_id || !scenario_id || !address_id || !choice_id) {
            return res.status(400).json({ 
                error: 'Missing required fields' 
            });
        }
        
        // Получаем информацию о выборе из базы сценария
        const choices = await Address.getChoices(scenario_id, address_id);
        console.log('Available choices for address:', choices);
        const selectedChoice = choices.find(c => c.id === choice_id);
        console.log('Selected choice:', selectedChoice);
        
        if (!selectedChoice) {
            return res.status(404).json({ error: 'Choice not found' });
        }
        
        // Проверяем, не делал ли игрок уже выбор для этого адреса
        const existingChoice = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM game_choices 
                 WHERE room_user_id = ? AND scenario_id = ? AND address_id = ?`,
                [room_user_id, scenario_id, address_id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
        
        if (existingChoice) {
            return res.status(400).json({ 
                error: 'Choice already made for this address' 
            });
        }
        
        // Сохраняем выбор игрока
        const gameChoice = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO game_choices 
                 (room_user_id, scenario_id, address_id, choice_id, choice_text, response_text, visited_location_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [room_user_id, scenario_id, address_id, choice_id, 
                 selectedChoice.choice_text, selectedChoice.response_text, visited_location_id],
                function(err) {
                    if (err) reject(err);
                    else resolve({
                        id: this.lastID,
                        room_user_id,
                        scenario_id,
                        address_id,
                        choice_id,
                        choice_text: selectedChoice.choice_text,
                        response_text: selectedChoice.response_text,
                        visited_location_id
                    });
                }
            );
        });
        
        res.status(201).json({
            success: true,
            message: 'Choice made successfully',
            choice: gameChoice,
            response: selectedChoice.response_text
        });
    } catch (error) {
        console.error('Make player choice error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Получить историю выборов игрока
const getPlayerChoiceHistory = async (req, res) => {
    try {
        const { room_user_id } = req.params;
        
        const choices = await new Promise((resolve, reject) => {
            db.all(
                `SELECT gc.*, s.name as scenario_name 
                 FROM game_choices gc
                 JOIN scenarios s ON gc.scenario_id = s.id
                 WHERE gc.room_user_id = ?
                 ORDER BY gc.created_at DESC`,
                [room_user_id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
        
        res.json({
            success: true,
            choices
        });
    } catch (error) {
        console.error('Get player choice history error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Получить выбор игрока для конкретного адреса
const getPlayerChoiceForAddress = async (req, res) => {
    try {
        const { room_user_id, scenario_id, address_id } = req.params;
        
        const choice = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM game_choices 
                 WHERE room_user_id = ? AND scenario_id = ? AND address_id = ?`,
                [room_user_id, scenario_id, address_id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
        
        console.log('Retrieved player choice:', choice);
        
        res.json({
            success: true,
            choice
        });
    } catch (error) {
        console.error('Get player choice for address error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    // Админские методы
    getAddressChoices,
    createAddressChoice,
    updateAddressChoice,
    deleteAddressChoice,
    checkAddressHasChoices,
    
    // Игровые методы
    getGameChoices,
    makePlayerChoice,
    getPlayerChoiceHistory,
    getPlayerChoiceForAddress
};
