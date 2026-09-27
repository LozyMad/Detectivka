const express = require('express');
const multer = require('multer');
const fs = require('fs');
const Scenario = require('../models/scenario');
const Address = require('../models/address');
const Room = require('../models/room');
const applications = require('../services/scenarioApplications');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 30 } });

async function adminAddress(req, res, next) {
  try {
    if (!req.user?.is_admin) return res.status(403).json({ error: 'Нет доступа' });
    const scenarioId = applications.positiveId(req.params.scenarioId);
    const addressId = applications.positiveId(req.params.addressId);
    const available = await Scenario.getAvailableForAdmin(req.user.id, req.user.admin_level);
    if (!available.some(item => Number(item.id) === scenarioId)) return res.status(403).json({ error: 'Нет доступа к сценарию' });
    if (!await Address.getById(scenarioId, addressId)) return res.status(404).json({ error: 'Адрес не найден' });
    next();
  } catch (error) {
    if (error.message === 'Неверный идентификатор') return res.status(400).json({ error: error.message });
    next(error);
  }
}

async function playerAddress(req, res, next) {
  try {
    const roomUser = req.roomUser;
    if (!roomUser) return res.status(403).json({ error: 'Доступно только игроку комнаты' });
    const scenarioId = applications.positiveId(req.params.scenarioId);
    const addressId = applications.positiveId(req.params.addressId);
    const room = await Room.getById(roomUser.room_id);
    if (!room || Number(room.scenario_id) !== scenarioId) return res.status(403).json({ error: 'Нет доступа к сценарию' });
    const DB_TYPE = process.env.DB_TYPE || 'sqlite';
    let visited;
    if (DB_TYPE === 'postgresql') {
      const { query } = require('../config/database');
      const result = await query(
        'SELECT 1 FROM visit_attempts WHERE user_id = $1 AND room_id = $2 AND scenario_id = $3 AND address_id = $4 AND found = TRUE LIMIT 1',
        [roomUser.id, roomUser.room_id, scenarioId, addressId]
      );
      visited = result.rows.length > 0;
    } else {
      const { db } = require('../config/database');
      visited = await new Promise((resolve, reject) => db.get(
        'SELECT 1 FROM visit_attempts WHERE user_id = ? AND room_id = ? AND scenario_id = ? AND address_id = ? AND found = 1 LIMIT 1',
        [roomUser.id, roomUser.room_id, scenarioId, addressId],
        (error, row) => error ? reject(error) : resolve(!!row)
      ));
    }
    if (!visited) return res.status(403).json({ error: 'Сначала посетите этот адрес' });
    next();
  } catch (error) {
    if (error.message === 'Неверный идентификатор') return res.status(400).json({ error: error.message });
    next(error);
  }
}

router.get('/admin/scenarios/:scenarioId/addresses/:addressId', authenticateToken, adminAddress, async (req, res, next) => {
  try { res.json({ applications: await applications.list(req.params.scenarioId, req.params.addressId) }); }
  catch (error) { next(error); }
});

router.post('/admin/scenarios/:scenarioId/addresses/:addressId/:number', authenticateToken, adminAddress,
  (req, res, next) => upload.array('files')(req, res, error => {
    if (error) return res.status(400).json({ error: 'До 30 файлов, каждый не больше 20 МБ' });
    next();
  }), async (req, res, next) => {
    try {
      const application = await applications.save(req.params.scenarioId, req.params.addressId, req.params.number, req.files);
      res.status(201).json({ application });
    } catch (error) {
      if (/^(Неверный|Выберите|В одном|Размер|Разрешены)/.test(error.message)) return res.status(400).json({ error: error.message });
      next(error);
    }
  });

router.delete('/admin/scenarios/:scenarioId/addresses/:addressId/:number', authenticateToken, adminAddress, async (req, res, next) => {
  try { await applications.remove(req.params.scenarioId, req.params.addressId, req.params.number); res.json({ ok: true }); }
  catch (error) { next(error); }
});

router.get('/game/available', authenticateToken, async (req, res, next) => {
  try {
    const roomUser = req.roomUser;
    if (!roomUser) return res.status(403).json({ error: 'Доступно только игроку комнаты' });
    const room = await Room.getById(roomUser.room_id);
    if (!room) return res.status(404).json({ error: 'Комната не найдена' });
    let rows;
    if ((process.env.DB_TYPE || 'sqlite') === 'postgresql') {
      const { query } = require('../config/database');
      rows = (await query(
        'SELECT DISTINCT address_id FROM visit_attempts WHERE user_id = $1 AND room_id = $2 AND scenario_id = $3 AND found = TRUE AND address_id IS NOT NULL',
        [roomUser.id, roomUser.room_id, room.scenario_id]
      )).rows;
    } else {
      const { db } = require('../config/database');
      rows = await new Promise((resolve, reject) => db.all(
        'SELECT DISTINCT address_id FROM visit_attempts WHERE user_id = ? AND room_id = ? AND scenario_id = ? AND found = 1 AND address_id IS NOT NULL',
        [roomUser.id, roomUser.room_id, room.scenario_id],
        (error, result) => error ? reject(error) : resolve(result)
      ));
    }
    const found = await Promise.all(rows.map(async row => {
      const [address, attached] = await Promise.all([
        Address.getById(room.scenario_id, row.address_id),
        applications.list(room.scenario_id, row.address_id)
      ]);
      return {
        address_id: row.address_id,
        district: address?.district || '',
        house_number: address?.house_number || '',
        apartment: address?.apartment || '',
        applications: attached.map(app => ({ number: app.number, file_count: app.files.length }))
      };
    }));
    res.json({ scenario_id: room.scenario_id, addresses: found });
  } catch (error) { next(error); }
});

router.get('/game/scenarios/:scenarioId/addresses/:addressId/:number', authenticateToken, playerAddress, async (req, res, next) => {
  try {
    const application = await applications.get(req.params.scenarioId, req.params.addressId, req.params.number);
    if (!application) return res.status(404).json({ error: 'Приложение не найдено' });
    res.json({ application });
  } catch (error) { next(error); }
});

router.get('/game/scenarios/:scenarioId/addresses/:addressId/:number/files/:fileId', authenticateToken, playerAddress, async (req, res, next) => {
  try {
    const file = await applications.getFile(req.params.scenarioId, req.params.addressId, req.params.number, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'Файл не найден' });
    res.setHeader('Content-Type', file.type);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    const stream = fs.createReadStream(file.path);
    stream.on('error', next);
    stream.pipe(res);
  } catch (error) { next(error); }
});

module.exports = router;
