const express = require('express');
const { authenticateToken, adminRequired } = require('../middleware/auth');
const {
    createQuestion,
    getQuestionsByScenario,
    updateQuestion,
    deleteQuestion,
    createAnswer,
    getUserAnswers,
    getAnswersByRoom
} = require('../controllers/questionController');

const router = express.Router();

// Публичные маршруты (для игроков)
router.get('/scenario/:scenario_id', getQuestionsByScenario);
router.post('/answer', authenticateToken, createAnswer);
router.get('/my-answers', authenticateToken, getUserAnswers);

// Админские маршруты
router.use(authenticateToken);
router.use(adminRequired);

router.get('/', getQuestionsByScenario); // GET /admin/questions?scenario_id=1
router.post('/', createQuestion);
router.put('/:id', updateQuestion);
router.delete('/:id', deleteQuestion);
router.get('/room/:room_id/answers', getAnswersByRoom);

module.exports = router;
