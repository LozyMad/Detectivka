const jwt = require('jsonwebtoken');
const User = require('../models/user');
const Room = require('../models/room');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, async (err, payload) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    // Admin/staff token
    if (payload.id) {
      const userData = await User.findById(payload.id);
      if (!userData) {
        return res.status(403).json({ error: 'User not found' });
      }
      req.user = userData;
      return next();
    }

    // Room user token
    if (payload.room_user_id && payload.room_id) {
      req.roomUser = { id: payload.room_user_id, room_id: payload.room_id, username: payload.username, scenario_id: payload.scenario_id };
      return next();
    }

    return res.status(403).json({ error: 'Invalid token payload' });
  });
};

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin, admin_level: user.admin_level },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Проверка, что пользователь является супер-админом
const superAdminRequired = (req, res, next) => {
  if (!req.user || !req.user.is_admin || req.user.admin_level !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
};

// Проверка, что пользователь является админом (любого уровня)
const adminRequired = (req, res, next) => {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Проверка, что пользователь имеет доступ к сценарию
const scenarioAccessRequired = async (req, res, next) => {
  try {
    const AdminPermission = require('../models/adminPermission');
    const { scenario_id } = req.params;
    
    if (!scenario_id) {
      return res.status(400).json({ error: 'Scenario ID required' });
    }

    // Супер-админ имеет доступ ко всем сценариям
    if (req.user.admin_level === 'super_admin') {
      return next();
    }

    // Проверяем, есть ли у админа разрешение на этот сценарий
    const hasPermission = await AdminPermission.hasPermission(req.user.id, scenario_id);
    
    if (!hasPermission) {
      return res.status(403).json({ error: 'Access denied to this scenario' });
    }

    next();
  } catch (error) {
    console.error('Scenario access check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  authenticateToken,
  generateToken,
  superAdminRequired,
  adminRequired,
  scenarioAccessRequired
};