const VisitAttempt = require('../models/visitAttempt');
const Scenario = require('../models/scenario');
const Address = require('../models/address');
const AddressBook = require('../models/addressBook');
const { query } = require('../config/database');

const getUserAttempts = async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.roomUser ? req.roomUser.id : null);
        
        if (!userId) {
            return res.json({ attempts: [] });
        }
        
        // Получаем текущий сценарий: для игрока комнаты — сценарий комнаты
        let activeScenario;
        
        if (req.roomUser) {
            const Room = require('../models/room');
            const room = await Room.getById(req.roomUser.room_id);
            if (!room) {
                return res.json({ attempts: [] });
            }
            activeScenario = { id: room.scenario_id };
        } else activeScenario = await Scenario.getActive();
        
        if (!activeScenario) {
            return res.json({ attempts: [] });
        }

        const attempts = await VisitAttempt.getByUserAndScenario(
            userId,
            activeScenario.id,
            req.roomUser ? req.roomUser.room_id : null
        );

        // Fetch the player's choices once, instead of one HTTP request per visited address.
        const choiceResponses = new Map();
        let choicesIncluded = !req.roomUser;
        if (req.roomUser && process.env.DB_TYPE === 'postgresql') {
            try {
                const result = await query(`SELECT address_id, response_text FROM game_choices
                    WHERE room_user_id = $1 AND scenario_id = $2 ORDER BY created_at DESC`,
                    [req.roomUser.id, activeScenario.id]);
                for (const choice of result.rows) {
                    if (!choiceResponses.has(Number(choice.address_id))) {
                        choiceResponses.set(Number(choice.address_id), choice.response_text);
                    }
                }
                choicesIncluded = true;
            } catch (error) {
                console.error('Get attempts choices:', error.message);
            }
        }

        try {
            await AddressBook.ensureSeeded();
        } catch (e) {
            console.error('Address book ensureSeeded:', e);
        }

        const namesCache = new Map();

        for (const a of attempts) {
            if (choicesIncluded) a.choice_response = a.found ? choiceResponses.get(Number(a.address_id)) || null : null;
            a.has_choices = false;
            a.is_internet_cafe = false;
            a.location_names = [];

            const cacheKey = `${a.district}|${a.house_number}|${String(a.apartment ?? '').trim()}`;
            if (namesCache.has(cacheKey)) {
                a.location_names = namesCache.get(cacheKey);
            } else {
                try {
                    const names = await AddressBook.findNamesByAddress({
                        district: a.district,
                        house_number: a.house_number,
                        apartment: a.apartment
                    });
                    namesCache.set(cacheKey, names);
                    a.location_names = names;
                } catch (e) {
                    namesCache.set(cacheKey, []);
                    a.location_names = [];
                }
            }

            if (a.found && a.address_id) {
                try {
                    const hasCh = await Address.hasChoices(activeScenario.id, a.address_id);
                    a.has_choices = !!hasCh;
                } catch (e) {
                    a.has_choices = false;
                }
                try {
                    const addr = await Address.getById(activeScenario.id, a.address_id);
                    a.is_internet_cafe = !!(addr && (addr.is_internet_cafe === true || addr.is_internet_cafe === 1 || addr.is_internet_cafe === '1'));
                } catch (e) {
                    a.is_internet_cafe = false;
                }
            }
        }

        res.json({ attempts, choices_included: choicesIncluded });
    } catch (error) {
        console.error('Get user attempts error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    getUserAttempts
};
