const VisitAttempt = require('../models/visitAttempt');
const Scenario = require('../models/scenario');

const getUserAttempts = async (req, res) => {
    try {
        console.log('=== getUserAttempts START ===');
        console.log('req.user:', req.user);
        console.log('req.roomUser:', req.roomUser);
        
        const userId = req.user ? req.user.id : (req.roomUser ? req.roomUser.id : null);
        console.log('userId:', userId);
        
        if (!userId) {
            console.log('No userId found, returning empty attempts');
            return res.json({ attempts: [] });
        }
        
        // Получаем текущий сценарий: для игрока комнаты — сценарий комнаты
        let activeScenario = await Scenario.getActive();
        console.log('activeScenario from getActive():', activeScenario);
        
        if (req.roomUser) {
            console.log('Processing room user, room_id:', req.roomUser.room_id);
            const Room = require('../models/room');
            const room = await Room.getById(req.roomUser.room_id);
            console.log('room found:', room);
            if (!room) {
                console.log('Room not found, returning empty attempts');
                return res.json({ attempts: [] });
            }
            activeScenario = { id: room.scenario_id };
            console.log('activeScenario from room:', activeScenario);
        }
        
        if (!activeScenario) {
            console.log('No activeScenario found, returning empty attempts');
            return res.json({ attempts: [] });
        }

        // Получаем все попытки пользователя для активного сценария
        console.log('Calling VisitAttempt.getByUserAndScenario with:', {
            userId,
            scenarioId: activeScenario.id,
            roomId: req.roomUser ? req.roomUser.room_id : null
        });
        
        const VisitAttempt = require('../models/visitAttempt');
        const attempts = await VisitAttempt.getByUserAndScenario(
            userId,
            activeScenario.id,
            req.roomUser ? req.roomUser.room_id : null
        );
        
        console.log('attempts found:', attempts.length);
        console.log('=== getUserAttempts END ===');

        res.json({ attempts });
    } catch (error) {
        console.error('Get user attempts error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    getUserAttempts
};