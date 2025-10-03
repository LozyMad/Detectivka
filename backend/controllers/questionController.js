const Question = require('../models/question');
const QuestionAnswer = require('../models/questionAnswer');

// Создание вопроса
const createQuestion = async (req, res) => {
    try {
        const { scenario_id, question_text } = req.body;
        
        if (!scenario_id || !question_text) {
            return res.status(400).json({ error: 'Scenario ID and question text required' });
        }
        
        // Проверяем доступ к сценарию (если не супер-админ)
        if (req.user.admin_level !== 'super_admin') {
            const AdminPermission = require('../models/adminPermission');
            const hasPermission = await AdminPermission.hasPermission(req.user.id, scenario_id);
            if (!hasPermission) {
                return res.status(403).json({ error: 'Access denied to this scenario' });
            }
        }
        
        const question = await Question.create({ scenario_id, question_text });
        res.status(201).json({ 
            message: 'Question created successfully',
            question 
        });
    } catch (error) {
        console.error('Create question error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Получение вопросов по сценарию
const getQuestionsByScenario = async (req, res) => {
    try {
        // Поддерживаем как параметр URL, так и query параметр
        const scenario_id = req.params.scenario_id || req.query.scenario_id;
        
        if (!scenario_id) {
            return res.status(400).json({ error: 'Scenario ID required' });
        }
        
        const questions = await Question.getByScenario(scenario_id);
        res.json({ questions });
    } catch (error) {
        console.error('Get questions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Обновление вопроса
const updateQuestion = async (req, res) => {
    try {
        const { id } = req.params;
        const { question_text } = req.body;
        
        if (!question_text) {
            return res.status(400).json({ error: 'Question text required' });
        }
        
        const question = await Question.update(id, { question_text });
        res.json({ 
            message: 'Question updated successfully',
            question 
        });
    } catch (error) {
        console.error('Update question error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Удаление вопроса
const deleteQuestion = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await Question.delete(id);
        res.json({ 
            message: 'Question deleted successfully',
            question: result 
        });
    } catch (error) {
        console.error('Delete question error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Создание ответа на вопрос
const createAnswer = async (req, res) => {
    try {
        const { question_id, answer_text } = req.body;
        
        if (!question_id || !answer_text) {
            return res.status(400).json({ error: 'Question ID and answer text required' });
        }
        
        // Определяем тип пользователя
        const user_id = req.user ? req.user.id : null;
        const room_user_id = req.roomUser ? req.roomUser.id : null;
        
        if (!user_id && !room_user_id) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        // Проверяем, не отвечал ли уже пользователь на этот вопрос
        const existingAnswer = await QuestionAnswer.getByQuestionAndUser(question_id, user_id, room_user_id);
        if (existingAnswer) {
            return res.status(400).json({ error: 'You have already answered this question' });
        }
        
        const answer = await QuestionAnswer.create({ 
            question_id, 
            user_id, 
            room_user_id, 
            answer_text 
        });
        
        res.status(201).json({ 
            message: 'Answer created successfully',
            answer 
        });
    } catch (error) {
        console.error('Create answer error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Получение ответов пользователя
const getUserAnswers = async (req, res) => {
    try {
        const user_id = req.user ? req.user.id : null;
        const room_user_id = req.roomUser ? req.roomUser.id : null;
        
        if (!user_id && !room_user_id) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        const answers = await QuestionAnswer.getByUser(user_id, room_user_id);
        res.json({ answers });
    } catch (error) {
        console.error('Get user answers error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};


// Получение ответов по комнате (для админа)
const getAnswersByRoom = async (req, res) => {
    try {
        const { room_id } = req.params;
        
        // Получаем информацию о комнате
        const Room = require('../models/room');
        const room = await Room.getById(room_id);
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Проверяем доступ к комнате (если не супер-админ)
        if (req.user.admin_level !== 'super_admin') {
            if (room.created_by !== req.user.id) {
                return res.status(403).json({ error: 'Access denied to this room' });
            }
        }

        // Получаем всех пользователей комнаты
        const RoomUser = require('../models/roomUser');
        const roomUsers = await RoomUser.getByRoomId(room_id);

        // Получаем вопросы для сценария комнаты
        const questions = await Question.getByScenario(room.scenario_id);

        // Получаем ответы и статистику поездок для каждого пользователя
        const answersByUser = [];
        
        for (const roomUser of roomUsers) {
            const userAnswers = [];
            
            for (const question of questions) {
                const answer = await QuestionAnswer.getByQuestionAndUser(question.id, null, roomUser.id);
                userAnswers.push({
                    question_id: question.id,
                    question_text: question.question_text,
                    answer_text: answer ? answer.answer_text : null,
                    answered_at: answer ? answer.answered_at : null
                });
            }
            
            // Получаем статистику поездок для пользователя
            const VisitAttempt = require('../models/visitAttempt');
            let tripStats;
            try {
                // Ищем поездки по room_id, так как user_id может быть разным
                tripStats = await VisitAttempt.getStatsByRoom(room.id, room.scenario_id);
            } catch (error) {
                console.error('Error getting trip stats for user:', roomUser.id, error);
                tripStats = { total_trips: 0, successful_trips: 0, failed_trips: 0 };
            }
            
            answersByUser.push({
                room_user_id: roomUser.id,
                username: roomUser.username,
                answers: userAnswers,
                trip_stats: {
                    total_trips: tripStats?.total_trips || 0,
                    successful_trips: tripStats?.successful_trips || 0,
                    failed_trips: tripStats?.failed_trips || 0
                }
            });
        }

        res.json({
            room: {
                id: room.id,
                name: room.name,
                scenario_name: room.scenario_name
            },
            users: answersByUser
        });
    } catch (error) {
        console.error('Get answers by room error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    createQuestion,
    getQuestionsByScenario,
    updateQuestion,
    deleteQuestion,
    createAnswer,
    getUserAnswers,
    getAnswersByRoom
};
