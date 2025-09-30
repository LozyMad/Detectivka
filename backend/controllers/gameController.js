const Scenario = require('../models/scenario');
const Address = require('../models/address');
const VisitedLocation = require('../models/visitedLocation');
const VisitAttempt = require('../models/visitAttempt');

const visitLocation = async (req, res) => {
  try {
    const { district, house_number } = req.body;
    // Support both admin-user gameplay (legacy) and room-user gameplay
    const userId = req.user ? req.user.id : (req.roomUser ? req.roomUser.id : null);
    const roomContext = req.roomUser || null;

    if (!district || !house_number) {
      return res.status(400).json({ error: 'District and house number required' });
    }

    const validDistricts = ['С', 'Ю', 'З', 'В', 'Ц', 'СВ', 'СЗ', 'ЮВ', 'ЮЗ'];
    if (!validDistricts.includes(district)) {
      return res.status(400).json({ error: 'Invalid district' });
    }

    let activeScenario = await Scenario.getActive();
    // For room users, enforce room scenario and start time
    if (roomContext) {
      const Room = require('../models/room');
      const room = await Room.getById(roomContext.room_id);
      if (!room) return res.status(403).json({ error: 'Room not found' });
      
      // Check game state
      if (room.state === 'pending') return res.status(403).json({ error: 'Game has not started yet' });
      if (room.state === 'paused') return res.status(403).json({ error: 'Game is paused' });
      if (room.state === 'finished') return res.status(403).json({ error: 'Game time is over' });
      
      // Check if game time is over
      if (room.state === 'running' && room.game_end_time) {
        const now = new Date();
        const endTime = new Date(room.game_end_time);
        if (now > endTime) return res.status(403).json({ error: 'Game time is over' });
      }
      
      // Force scenario to room's scenario
      activeScenario = { id: room.scenario_id };
    } else if (!activeScenario) {
      return res.status(400).json({ error: 'No active scenario found' });
    }

    const address = await Address.findByScenarioAndAddress(
      activeScenario.id, 
      district, 
      house_number
    );

    // ФИКСИРУЕМ ВСЕ ПОПЫТКИ (даже неудачные)
    await VisitAttempt.create({
      user_id: userId,
      scenario_id: activeScenario.id,
      room_id: roomContext ? roomContext.room_id : null,
      district: district,
      house_number: house_number,
      found: !!address,
      address_id: address ? address.id : null
    });

    if (!address) {
      return res.status(404).json({ 
        success: false,
        error: 'Location not found in this scenario',
        location: {
          district: district,
          house_number: house_number
        }
      });
    }

    // Отмечаем локацию как посещенную (только для найденных адресов)
    const visitResult = await VisitedLocation.visitLocation(
      userId, 
      activeScenario.id, 
      address.id,
      roomContext ? roomContext.room_id : null
    );

    res.json({
      success: true,
      description: address.description,
      location: {
        district: address.district,
        house_number: address.house_number
      },
      alreadyVisited: visitResult.alreadyVisited,
      visitedAt: visitResult.alreadyVisited ? visitResult.visit.visited_at : new Date().toISOString()
    });
  } catch (error) {
    console.error('Visit location error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getActiveScenario = async (req, res) => {
  try {
    const activeScenario = await Scenario.getActive();
    res.json({ scenario: activeScenario });
  } catch (error) {
    console.error('Get active scenario error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getVisitedLocations = async (req, res) => {
  try {
    // Support both admin-user gameplay (legacy) and room-user gameplay
    const userId = req.user ? req.user.id : (req.roomUser ? req.roomUser.id : null);
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    let activeScenario = await Scenario.getActive();
    // For room users, enforce room scenario
    if (req.roomUser) {
      const Room = require('../models/room');
      const room = await Room.getById(req.roomUser.room_id);
      if (!room) return res.status(403).json({ error: 'Room not found' });
      // Force scenario to room's scenario
      activeScenario = { id: room.scenario_id };
    } else if (!activeScenario) {
      return res.json({ visitedLocations: [] });
    }

    const visitedLocations = await VisitedLocation.getVisitedLocations(
      userId, 
      activeScenario.id,
      req.roomUser ? req.roomUser.room_id : null
    );

    res.json({ visitedLocations });
  } catch (error) {
    console.error('Get visited locations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  visitLocation,
  getActiveScenario,
  getVisitedLocations
};