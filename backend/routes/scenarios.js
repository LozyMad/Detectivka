const express = require('express');
const router = express.Router();
const Scenario = require('../models/scenario');
const { getBannerFile } = require('../services/scenarioBanner');

// Публичный endpoint для получения списка сценариев
router.get('/', async (req, res) => {
  try {
    const scenarios = await Scenario.getAll();
    res.json({ scenarios });
  } catch (error) {
    console.error('Get scenarios error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Публичный endpoint для получения активного сценария
router.get('/active', async (req, res) => {
  try {
    const activeScenario = await Scenario.getActive();
    if (!activeScenario) {
      return res.status(404).json({ error: 'No active scenario found' });
    }
    res.json({ scenario: activeScenario });
  } catch (error) {
    console.error('Get active scenario error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Публичный endpoint для получения сценария по ID
router.get('/:id/banner', async (req, res) => {
  try {
    const scenario = await Scenario.getById(req.params.id);
    const banner = scenario && getBannerFile(req.params.id);
    if (!banner) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    res.type(banner.extension === 'jpg' ? 'jpeg' : banner.extension);
    res.sendFile(banner.file);
  } catch (error) {
    console.error('Get scenario banner error:', error);
    res.status(500).end();
  }
});

// Публичный endpoint для получения сценария по ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const scenario = await Scenario.getById(id);
    if (!scenario) {
      return res.status(404).json({ error: 'Scenario not found' });
    }
    res.json({ scenario });
  } catch (error) {
    console.error('Get scenario by id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;


