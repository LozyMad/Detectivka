const express = require('express');
const { 
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
} = require('../controllers/adminController');
const { authenticateToken, adminRequired } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);
router.use(adminRequired);

// User routes
router.post('/users', createUser);
router.get('/users', getUsers);
router.delete('/users/:user_id', deleteUser);

// Scenario routes
router.post('/scenarios', createScenario);
router.get('/scenarios', getScenarios);
router.put('/scenarios/:id', updateScenario);
router.delete('/scenarios/:id', deleteScenario);
router.get('/statistics/:scenario_id', getStatistics);

// Address routes
router.post('/addresses', createAddress);
router.get('/addresses/:scenario_id', getAddresses);
router.delete('/addresses/:scenario_id/:id', deleteAddress);

module.exports = router;