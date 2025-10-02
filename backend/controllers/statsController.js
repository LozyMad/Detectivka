const VisitAttempt = require('../models/visitAttempt');
const Scenario = require('../models/scenario');

const getUserAttempts = async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.roomUser ? req.roomUser.id : null);
        
        console.log('getUserAttempts - userId:', userId);
        console.log('getUserAttempts - req.user:', req.user);
        console.log('getUserAttempts - req.roomUser:', req.roomUser);
        
        // Получаем текущий сценарий: для игрока комнаты — сценарий комнаты
        let activeScenario = await Scenario.getActive();
        if (req.roomUser) {
            const Room = require('../models/room');
            const room = await Room.getById(req.roomUser.room_id);
            console.log('getUserAttempts - room:', room);
            if (!room) return res.json({ attempts: [] });
            activeScenario = { id: room.scenario_id };
        }
        console.log('getUserAttempts - activeScenario:', activeScenario);
        if (!activeScenario) {
            return res.json({ attempts: [] });
        }

        // Получаем все попытки пользователя для активного сценария
        const { db } = require('../config/database');
        // If token is room user, filter attempts by room_id as well
        const VisitAttempt = require('../models/visitAttempt');
        const attempts = await VisitAttempt.getByUserAndScenario(
            userId,
            activeScenario.id,
            req.roomUser ? req.roomUser.room_id : null
        );
        
        console.log('getUserAttempts - attempts found:', attempts.length);
        console.log('getUserAttempts - attempts:', attempts);

        res.json({ attempts });
    } catch (error) {
        console.error('Get user attempts error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    getUserAttempts
};