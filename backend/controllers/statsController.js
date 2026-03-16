const VisitAttempt = require('../models/visitAttempt');
const Scenario = require('../models/scenario');
const Address = require('../models/address');

const getUserAttempts = async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.roomUser ? req.roomUser.id : null);
        
        if (!userId) {
            return res.json({ attempts: [] });
        }
        
        // Получаем текущий сценарий: для игрока комнаты — сценарий комнаты
        let activeScenario = await Scenario.getActive();
        
        if (req.roomUser) {
            const Room = require('../models/room');
            const room = await Room.getById(req.roomUser.room_id);
            if (!room) {
                return res.json({ attempts: [] });
            }
            activeScenario = { id: room.scenario_id };
        }
        
        if (!activeScenario) {
            return res.json({ attempts: [] });
        }

        const attempts = await VisitAttempt.getByUserAndScenario(
            userId,
            activeScenario.id,
            req.roomUser ? req.roomUser.room_id : null
        );

        for (const a of attempts) {
            a.has_choices = false;
            if (a.found && a.address_id) {
                try {
                    const hasCh = await Address.hasChoices(activeScenario.id, a.address_id);
                    a.has_choices = !!hasCh;
                } catch (e) {
                    a.has_choices = false;
                }
            }
        }

        res.json({ attempts });
    } catch (error) {
        console.error('Get user attempts error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    getUserAttempts
};