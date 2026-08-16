const Address = require('../models/address');
const InternetPage = require('../models/internetPage');
const Scenario = require('../models/scenario');

function isCafeFlag(value) {
  return value === true || value === 1 || value === '1';
}

async function resolveScenarioId(req) {
  if (req.roomUser) {
    const Room = require('../models/room');
    const room = await Room.getById(req.roomUser.room_id);
    if (!room) return null;
    return room.scenario_id;
  }
  const active = await Scenario.getActive();
  return active ? active.id : null;
}

async function resolveUserContext(req) {
  const userId = req.user ? req.user.id : (req.roomUser ? req.roomUser.id : null);
  const roomId = req.roomUser ? req.roomUser.room_id : null;
  return { userId, roomId };
}

// ===== ИГРОК =====

const getCafePages = async (req, res) => {
  try {
    const cafeAddressId = parseInt(req.params.addressId, 10);
    if (!cafeAddressId) {
      return res.status(400).json({ error: 'Invalid cafe address id' });
    }

    const scenarioId = await resolveScenarioId(req);
    if (!scenarioId) {
      return res.status(400).json({ error: 'No active scenario' });
    }

    const { userId, roomId } = await resolveUserContext(req);
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const cafeAddress = await Address.getById(scenarioId, cafeAddressId);
    if (!cafeAddress || !isCafeFlag(cafeAddress.is_internet_cafe)) {
      return res.status(404).json({ error: 'Internet cafe not found' });
    }

    const pages = await InternetPage.getUnlockedForPlayer(
      scenarioId,
      cafeAddressId,
      userId,
      roomId
    );

    res.json({
      success: true,
      empty_message: 'Вам нечего искать в сети интернет',
      pages
    });
  } catch (error) {
    console.error('Get cafe pages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getCafePageContent = async (req, res) => {
  try {
    const pageId = parseInt(req.params.pageId, 10);
    if (!pageId) {
      return res.status(400).json({ error: 'Invalid page id' });
    }

    const scenarioId = await resolveScenarioId(req);
    if (!scenarioId) {
      return res.status(400).json({ error: 'No active scenario' });
    }

    const { userId, roomId } = await resolveUserContext(req);
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const page = await InternetPage.getById(scenarioId, pageId);
    if (!page || (page.is_active === false || page.is_active === 0)) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const cafeAddress = await Address.getById(scenarioId, page.cafe_address_id);
    if (!cafeAddress || !isCafeFlag(cafeAddress.is_internet_cafe)) {
      return res.status(404).json({ error: 'Internet cafe not found' });
    }

    const unlocked = await InternetPage.hasVisitedAddress(
      scenarioId,
      userId,
      page.unlock_address_id,
      roomId
    );
    if (!unlocked) {
      return res.status(403).json({ error: 'Page is locked' });
    }

    res.json({
      success: true,
      page: {
        id: page.id,
        title: page.title,
        content_html: page.content_html
      }
    });
  } catch (error) {
    console.error('Get cafe page content error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ===== АДМИН =====

const getAdminPages = async (req, res) => {
  try {
    const { scenario_id } = req.params;
    const pages = await InternetPage.getByScenario(scenario_id);
    res.json({ success: true, pages });
  } catch (error) {
    console.error('Get admin internet pages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createAdminPage = async (req, res) => {
  try {
    const { scenario_id } = req.params;
    const {
      title,
      content_html,
      unlock_address_id,
      cafe_address_id,
      page_order,
      is_active
    } = req.body;

    if (!title || !content_html || !unlock_address_id || !cafe_address_id) {
      return res.status(400).json({
        error: 'title, content_html, unlock_address_id and cafe_address_id are required'
      });
    }

    const cafeAddress = await Address.getById(scenario_id, cafe_address_id);
    if (!cafeAddress || !isCafeFlag(cafeAddress.is_internet_cafe)) {
      return res.status(400).json({ error: 'cafe_address_id must be an internet cafe address' });
    }

    const unlockAddress = await Address.getById(scenario_id, unlock_address_id);
    if (!unlockAddress) {
      return res.status(400).json({ error: 'unlock_address_id not found' });
    }

    const page = await InternetPage.create(scenario_id, {
      title,
      content_html,
      unlock_address_id,
      cafe_address_id,
      page_order,
      is_active
    });

    res.status(201).json({ success: true, page });
  } catch (error) {
    console.error('Create internet page error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateAdminPage = async (req, res) => {
  try {
    const { scenario_id, page_id } = req.params;
    const {
      title,
      content_html,
      unlock_address_id,
      cafe_address_id,
      page_order,
      is_active
    } = req.body;

    if (!title || !content_html || !unlock_address_id || !cafe_address_id) {
      return res.status(400).json({
        error: 'title, content_html, unlock_address_id and cafe_address_id are required'
      });
    }

    const cafeAddress = await Address.getById(scenario_id, cafe_address_id);
    if (!cafeAddress || !isCafeFlag(cafeAddress.is_internet_cafe)) {
      return res.status(400).json({ error: 'cafe_address_id must be an internet cafe address' });
    }

    const result = await InternetPage.update(scenario_id, page_id, {
      title,
      content_html,
      unlock_address_id,
      cafe_address_id,
      page_order,
      is_active
    });

    if (!result || (result.changes !== undefined && result.changes === 0)) {
      return res.status(404).json({ error: 'Page not found' });
    }

    res.json({ success: true, message: 'Page updated' });
  } catch (error) {
    console.error('Update internet page error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteAdminPage = async (req, res) => {
  try {
    const { scenario_id, page_id } = req.params;
    await InternetPage.delete(scenario_id, page_id);
    res.json({ success: true, message: 'Page deleted' });
  } catch (error) {
    console.error('Delete internet page error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getCafePages,
  getCafePageContent,
  getAdminPages,
  createAdminPage,
  updateAdminPage,
  deleteAdminPage
};
