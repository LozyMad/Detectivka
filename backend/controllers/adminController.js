const User = require('../models/user');
const Scenario = require('../models/scenario');
const Address = require('../models/address');
const VisitAttempt = require('../models/visitAttempt');
const { createScenarioDb, deleteScenarioDb } = require('../config/scenarioDatabase');

// User management
const createUser = async (req, res) => {
  try {
    const { username, password, is_admin = false } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await User.create({ username, password, is_admin });
    res.status(201).json({ 
      message: 'User created successfully',
      user: { id: user.id, username: user.username, is_admin: user.is_admin }
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') {
      return res.status(400).json({ error: 'Username already exists' });
    }
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getUsers = async (req, res) => {
  try {
    const users = await User.findAll();
    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { user_id } = req.params;
    
    // Проверяем, что пользователь не удаляет сам себя
    if (parseInt(user_id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    
    const result = await User.delete(user_id);
    res.json({ message: 'User deleted successfully', user: result });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Scenario management
const createScenario = async (req, res) => {
  try {
    const { name, description, is_active = false } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Scenario name required' });
    }

    // If setting as active, deactivate all other scenarios
    if (is_active) {
      const { db } = require('../config/database');
      await new Promise((resolve, reject) => {
        db.run(`UPDATE scenarios SET is_active = FALSE`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    const scenario = await Scenario.create({
      name,
      description,
      is_active,
      created_by: req.user.id
    });
    // Create per-scenario database file and tables
    createScenarioDb(scenario.id);
    
    // Автоматический экспорт сценариев после создания
    try {
      const backupController = require('./backupController');
      await backupController.exportScenarios({}, { json: () => {} });
    } catch (exportError) {
      console.error('Auto-export error:', exportError);
      // Не прерываем создание сценария из-за ошибки экспорта
    }
    
    res.status(201).json({ 
      message: 'Scenario created successfully',
      scenario 
    });
  } catch (error) {
    console.error('Create scenario error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Добавьте эту функцию
const getStatistics = async (req, res) => {
  try {
    const { scenario_id } = req.params;
    const stats = await VisitAttempt.getStatsByScenario(scenario_id);
    res.json({ stats });
  } catch (error) {
    console.error('Get statistics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getScenarios = async (req, res) => {
  try {
    // Обычный админ видит только доступные ему сценарии
    const scenarios = await Scenario.getAvailableForAdmin(req.user.id, req.user.admin_level);
    res.json({ scenarios });
  } catch (error) {
    console.error('Get scenarios error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateScenario = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, is_active } = req.body;

    // If setting as active, deactivate all other scenarios
    if (is_active) {
      const { db } = require('../config/database');
      await new Promise((resolve, reject) => {
        db.run(`UPDATE scenarios SET is_active = FALSE WHERE id != ?`, [id], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    const scenario = await Scenario.update(id, { name, description, is_active });
    res.json({ 
      message: 'Scenario updated successfully',
      scenario 
    });
  } catch (error) {
    console.error('Update scenario error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteScenario = async (req, res) => {
  try {
    const { id } = req.params;
    await Scenario.delete(id);
    // Delete per-scenario database file
    deleteScenarioDb(id);
    res.json({ message: 'Scenario deleted successfully' });
  } catch (error) {
    console.error('Delete scenario error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Address management
const createAddress = async (req, res) => {
  try {
    const { scenario_id, district, house_number, description } = req.body;

    if (!scenario_id || !district || !house_number || !description) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const validDistricts = ['С', 'Ю', 'З', 'В', 'Ц', 'СВ', 'СЗ', 'ЮВ', 'ЮЗ'];
    if (!validDistricts.includes(district)) {
      return res.status(400).json({ error: 'Invalid district' });
    }

    const address = await Address.create({
      scenario_id,
      district,
      house_number,
      description
    });

    res.status(201).json({ 
      message: 'Address created successfully',
      address 
    });
  } catch (error) {
    console.error('Create address error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getAddresses = async (req, res) => {
  try {
    const { scenario_id } = req.params;
    const addresses = await Address.findByScenario(scenario_id);
    res.json({ addresses });
  } catch (error) {
    console.error('Get addresses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteAddress = async (req, res) => {
  try {
    const { scenario_id, id } = req.params;
    await Address.delete(scenario_id, id);
    res.json({ message: 'Address deleted successfully' });
  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createUser,
  getUsers,
  deleteUser,
  createScenario,
  getScenarios,
  updateScenario,
  deleteScenario,
  createAddress,
  getAddresses,
  deleteAddress,
  getStatistics
};
