const express = require('express');
const Room = require('../models/room');
const Address = require('../models/address');
const AddressBook = require('../models/addressBook');
const Board = require('../models/investigationBoard');
const { db, query } = require('../config/database');

const router = express.Router();
const postgres = process.env.DB_TYPE === 'postgresql';
const colors = new Set(['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'mint']);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const positiveId = value => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

router.use(wrap(async (req, res, next) => {
  if (!req.roomUser) return res.status(403).json({ error: 'Доска доступна игрокам комнаты' });
  const room = await Room.getById(req.roomUser.room_id);
  if (!room) return res.status(404).json({ error: 'Игровая комната не найдена' });
  const memberSql = postgres
    ? 'SELECT id FROM room_users WHERE id = $1 AND room_id = $2'
    : 'SELECT id FROM room_users WHERE id = ? AND room_id = ?';
  const memberParams = [req.roomUser.id, room.id];
  const member = postgres
    ? (await query(memberSql, memberParams)).rows[0]
    : await new Promise((resolve, reject) => db.get(memberSql, memberParams,
      (error, row) => error ? reject(error) : resolve(row)));
  if (!member) return res.status(403).json({ error: 'Игрок не состоит в этой комнате' });
  req.boardRoom = { id: room.id, scenarioId: room.scenario_id };
  next();
}));

function context(req) {
  return [req.boardRoom.id, req.boardRoom.scenarioId];
}

function noteFields(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.comment !== 'string' || body.comment.length > 4000) return null;
  if (!colors.has(body.color)) return null;
  return { comment: body.comment.trim(), color: body.color };
}

async function hasVisited(req, addressId) {
  const values = [req.roomUser.id, req.boardRoom.id, req.boardRoom.scenarioId, addressId];
  const sql = postgres
    ? 'SELECT 1 FROM visit_attempts WHERE user_id = $1 AND room_id = $2 AND scenario_id = $3 AND address_id = $4 AND found = TRUE LIMIT 1'
    : 'SELECT 1 FROM visit_attempts WHERE user_id = ? AND room_id = ? AND scenario_id = ? AND address_id = ? AND found = 1 LIMIT 1';
  if (postgres) return (await query(sql, values)).rows.length > 0;
  return new Promise((resolve, reject) => db.get(sql, values, (error, row) => error ? reject(error) : resolve(!!row)));
}

router.get('/', wrap(async (req, res) => {
  res.json(await Board.list(...context(req)));
}));

router.post('/notes', wrap(async (req, res) => {
  const body = req.body || {};
  const addressId = positiveId(body.address_id);
  const fields = noteFields(body);
  if (!addressId || !fields) return res.status(400).json({ error: 'Проверьте адрес, цвет и длину заметки (до 4000 символов)' });
  const [roomId, scenarioId] = context(req);
  const existing = await Board.findByAddress(roomId, scenarioId, addressId);
  if (existing) return res.status(409).json({ error: 'Это место уже на доске', note: existing });
  if (!await hasVisited(req, addressId)) return res.status(403).json({ error: 'Сначала посетите это место в игре' });
  const address = await Address.getById(scenarioId, addressId);
  if (!address) return res.status(404).json({ error: 'Место не найдено в сценарии' });
  let names = [];
  try {
    await AddressBook.ensureSeeded();
    names = await AddressBook.findNamesByAddress(address);
  } catch (error) {
    console.error('Board address book lookup:', error);
  }
  const title = names.length ? names.join(' / ') : `Место: район ${address.district}, дом ${address.house_number}`;
  const addressLabel = `Район ${address.district}, дом ${address.house_number}${address.apartment ? `, кв./офис ${address.apartment}` : ''}`;
  try {
    const note = await Board.createNote({ room_id: roomId, scenario_id: scenarioId, address_id: addressId,
      title, address_label: addressLabel, ...fields });
    res.status(201).json({ note });
  } catch (error) {
    if (error.code === '23505' || error.code === 'SQLITE_CONSTRAINT') {
      const note = await Board.findByAddress(roomId, scenarioId, addressId);
      return res.status(409).json({ error: 'Это место уже на доске', note });
    }
    throw error;
  }
}));

router.post('/notes/free', wrap(async (req, res) => {
  const fields = noteFields(req.body);
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!fields || !title || title.length > 120) {
    return res.status(400).json({ error: 'Укажите название до 120 символов, цвет и текст до 4000 символов' });
  }
  const [roomId, scenarioId] = context(req);
  const note = await Board.createFreeNote({ room_id: roomId, scenario_id: scenarioId, title, ...fields });
  res.status(201).json({ note });
}));

router.patch('/notes/:id', wrap(async (req, res) => {
  const id = positiveId(req.params.id);
  const fields = noteFields(req.body);
  if (!id || !fields) return res.status(400).json({ error: 'Некорректные данные заметки' });
  const existing = await Board.getNote(...context(req), id);
  if (!existing) return res.status(404).json({ error: 'Стикер не найден' });
  if (Number(existing.address_id) < 0) {
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    if (!title || title.length > 120) return res.status(400).json({ error: 'Название должно быть от 1 до 120 символов' });
    fields.title = title;
  }
  const note = await Board.updateNote(...context(req), id, fields);
  if (!note) return res.status(404).json({ error: 'Стикер не найден' });
  res.json({ note });
}));

router.patch('/notes/:id/position', wrap(async (req, res) => {
  const id = positiveId(req.params.id);
  const { x, y } = req.body || {};
  if (!id || typeof x !== 'number' || typeof y !== 'number' ||
      !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 20000 || y > 20000) {
    return res.status(400).json({ error: 'Некорректные координаты' });
  }
  const note = await Board.moveNote(...context(req), id, Math.round(x), Math.round(y));
  if (!note) return res.status(404).json({ error: 'Стикер не найден' });
  res.json({ note });
}));

router.delete('/notes/:id', wrap(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный стикер' });
  if (!await Board.deleteNote(...context(req), id)) return res.status(404).json({ error: 'Стикер не найден' });
  res.json({ ok: true });
}));

router.post('/links', wrap(async (req, res) => {
  const body = req.body || {};
  const first = positiveId(body.first_id);
  const second = positiveId(body.second_id);
  if (!first || !second || first === second) return res.status(400).json({ error: 'Выберите два разных стикера' });
  const [noteA, noteB] = [Math.min(first, second), Math.max(first, second)];
  const scope = context(req);
  const [a, b] = await Promise.all([Board.getNote(...scope, noteA), Board.getNote(...scope, noteB)]);
  if (!a || !b) return res.status(404).json({ error: 'Стикер не найден на этой доске' });
  const existing = await Board.findLink(...scope, noteA, noteB);
  if (existing) return res.status(409).json({ error: 'Эти стикеры уже соединены', link: existing });
  try {
    const link = await Board.createLink(...scope, noteA, noteB);
    res.status(201).json({ link });
  } catch (error) {
    if (error.code === '23505' || error.code === 'SQLITE_CONSTRAINT') {
      const link = await Board.findLink(...scope, noteA, noteB);
      return res.status(409).json({ error: 'Эти стикеры уже соединены', link });
    }
    throw error;
  }
}));

router.delete('/links/:id', wrap(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректная связь' });
  if (!await Board.deleteLink(...context(req), id)) return res.status(404).json({ error: 'Нить не найдена' });
  res.json({ ok: true });
}));

module.exports = router;
