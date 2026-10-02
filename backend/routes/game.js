const express = require('express');
const {
  visitLocation,
  getActiveScenario,
  getVisitedLocations,
  roomEventsStream
} = require('../controllers/gameController');
const { getUserAttempts } = require('../controllers/statsController');
const { getAddressBookSections, getAddressBookEntries } = require('../controllers/addressBookController');
const { authenticateToken, authenticateTokenQuery } = require('../middleware/auth');

const router = express.Router();

// SSE: токен в query (EventSource не шлёт заголовки), регистрируем до authenticateToken
router.get('/room/:roomId/events', authenticateTokenQuery, roomEventsStream);

router.use(authenticateToken);

router.post('/visit', visitLocation);
router.get('/scenario', getActiveScenario);
router.get('/visited', getVisitedLocations);
router.get('/attempts', getUserAttempts);

// Адресная книга для игроков (только чтение)
router.get('/address-book/sections', getAddressBookSections);
router.get('/address-book/entries', getAddressBookEntries);

module.exports = router;