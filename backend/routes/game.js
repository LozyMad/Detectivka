const express = require('express');
const {
  visitLocation,
  getActiveScenario,
  getVisitedLocations,
  roomEventsStream
} = require('../controllers/gameController');
const { getUserAttempts } = require('../controllers/statsController');
const { getAddressBookSections, getAddressBookEntries } = require('../controllers/addressBookController');
const { authenticateToken, authenticateTokenQuery, authenticateResultToken } = require('../middleware/auth');
const investigationBoard = require('./investigationBoard');

const router = express.Router();

// SSE: токен в query (EventSource не шлёт заголовки), регистрируем до authenticateToken
router.get('/room/:roomId/events', authenticateTokenQuery, roomEventsStream);

router.get('/shared/result', authenticateResultToken, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  Promise.resolve().then(() => require('../services/playerRuntime').cabinet.shared.result(req.roomUser))
    .then(result => res.json(result)).catch(error => error.status
      ? res.status(error.status).json({error: error.message, ...(error.data || {})}) : next(error));
});

router.use(authenticateToken);

router.use('/shared', require('./sharedGame'));
router.use('/board', investigationBoard);

router.post('/visit', visitLocation);
router.get('/scenario', getActiveScenario);
router.get('/visited', getVisitedLocations);
router.get('/attempts', getUserAttempts);

// Адресная книга для игроков (только чтение)
router.get('/address-book/sections', getAddressBookSections);
router.get('/address-book/entries', getAddressBookEntries);

module.exports = router;
