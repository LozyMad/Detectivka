const express = require('express');
const {
  visitLocation,
  getActiveScenario,
  getVisitedLocations,
  roomEventsStream
} = require('../controllers/gameController');
const { getUserAttempts } = require('../controllers/statsController');
const { authenticateToken, authenticateTokenQuery } = require('../middleware/auth');

const router = express.Router();

// SSE: токен в query (EventSource не шлёт заголовки), регистрируем до authenticateToken
router.get('/room/:roomId/events', authenticateTokenQuery, roomEventsStream);

router.use(authenticateToken);

router.post('/visit', visitLocation);
router.get('/scenario', getActiveScenario);
router.get('/visited', getVisitedLocations);
router.get('/attempts', getUserAttempts);

module.exports = router;