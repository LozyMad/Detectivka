const express = require('express');
const { 
  visitLocation, 
  getActiveScenario,
  getVisitedLocations
} = require('../controllers/gameController');
const { getUserAttempts } = require('../controllers/statsController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);

router.post('/visit', visitLocation);
router.get('/scenario', getActiveScenario);
router.get('/visited', getVisitedLocations);
router.get('/attempts', getUserAttempts); // Добавляем новый маршрут

module.exports = router;