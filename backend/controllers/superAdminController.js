const User = require('../models/user');
const Scenario = require('../models/scenario');
const AdminPermission = require('../models/adminPermission');

// Создать нового админа
const createAdmin = async (req, res) => {
  try {
    const { username, password, admin_level = 'admin' } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (admin_level !== 'admin' && admin_level !== 'super_admin') {
      return res.status(400).json({ error: 'Invalid admin level' });
    }

    const newAdmin = await User.create({
      username,
      password,
      is_admin: true,
      admin_level
    });

    res.status(201).json({ 
      message: 'Admin created successfully', 
      admin: { id: newAdmin.id, username: newAdmin.username, admin_level: newAdmin.admin_level }
    });
  } catch (error) {
    console.error('Create admin error:', error);
    if (error.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};

// Получить всех админов
const getAdmins = async (req, res) => {
  try {
    const admins = await User.findAllAdmins();
    res.json({ admins });
  } catch (error) {
    console.error('Get admins error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Создать сценарий
const createScenario = async (req, res) => {
  try {
    const { name, description, questions = [] } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }

    const newScenario = await Scenario.create({
      name,
      description,
      is_active: false,
      created_by: req.user.id
    });

    // Создаем вопросы для сценария, если они предоставлены
    if (questions && questions.length > 0) {
      const Question = require('../models/question');
      for (const questionText of questions) {
        if (questionText && questionText.trim()) {
          await Question.create({
            scenario_id: newScenario.id,
            question_text: questionText.trim()
          });
        }
      }
    }

    res.status(201).json({ 
      message: 'Scenario created successfully', 
      scenario: newScenario 
    });
  } catch (error) {
    console.error('Create scenario error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Предоставить разрешение админу на сценарий
const grantScenarioPermission = async (req, res) => {
  try {
    const { admin_id, scenario_id } = req.body;

    if (!admin_id || !scenario_id) {
      return res.status(400).json({ error: 'Admin ID and Scenario ID are required' });
    }

    // Проверяем, что админ существует и не является супер-админом
    const admin = await User.findById(admin_id);
    if (!admin || !admin.is_admin || admin.admin_level === 'super_admin') {
      return res.status(400).json({ error: 'Invalid admin or cannot grant permissions to super admin' });
    }

    // Проверяем, что сценарий существует
    const scenario = await Scenario.getById(scenario_id);
    if (!scenario) {
      return res.status(400).json({ error: 'Scenario not found' });
    }

    const permission = await AdminPermission.grant(admin_id, scenario_id, req.user.id);

    res.json({ 
      message: 'Permission granted successfully', 
      permission 
    });
  } catch (error) {
    console.error('Grant permission error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Отозвать разрешение админа на сценарий
const revokeScenarioPermission = async (req, res) => {
  try {
    const { admin_id, scenario_id } = req.body;

    if (!admin_id || !scenario_id) {
      return res.status(400).json({ error: 'Admin ID and Scenario ID are required' });
    }

    const result = await AdminPermission.revoke(admin_id, scenario_id);

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Permission not found' });
    }

    res.json({ message: 'Permission revoked successfully' });
  } catch (error) {
    console.error('Revoke permission error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Получить все разрешения
const getAllPermissions = async (req, res) => {
  try {
    const permissions = await AdminPermission.getAll();
    res.json({ permissions });
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Получить разрешения конкретного админа
const getAdminPermissions = async (req, res) => {
  try {
    const { admin_id } = req.params;
    const permissions = await AdminPermission.getByAdminId(admin_id);
    res.json({ permissions });
  } catch (error) {
    console.error('Get admin permissions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Получить админов с разрешениями на конкретный сценарий
const getScenarioPermissions = async (req, res) => {
  try {
    const { scenario_id } = req.params;
    const permissions = await AdminPermission.getByScenarioId(scenario_id);
    res.json({ permissions });
  } catch (error) {
    console.error('Get scenario permissions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createAdmin,
  getAdmins,
  createScenario,
  grantScenarioPermission,
  revokeScenarioPermission,
  getAllPermissions,
  getAdminPermissions,
  getScenarioPermissions
};

