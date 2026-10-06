'use strict';

const { randomUUID, createHash } = require('crypto');

const STATUSES = ['new', 'in_progress', 'agreed', 'closed'];
const FORMATS = ['undecided', 'online', 'offline'];
const CONSENT_VERSION = 'corporate-2026-10-05-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class EnquiryError extends Error {
  constructor(message, status = 400, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

function normalizeSubmission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new EnquiryError('Проверьте поля заявки.');
  const fields = {};
  const text = (name, max, required = false) => {
    if (body[name] != null && typeof body[name] !== 'string') fields[name] = 'Введите текст.';
    const value = typeof body[name] === 'string' ? body[name].trim() : '';
    if (required && !value) fields[name] = 'Заполните это поле.';
    if (value.length > max || /[\x00-\x1f\x7f]/.test(value)) fields[name] = `Введите не больше ${max} символов без переносов строк.`;
    return value;
  };
  const company = text('company', 160, true);
  const phone = text('phone', 40, true);
  const telegram = text('telegram', 100);
  const email = text('email', 254, true);
  const digits = phone.replace(/\D/g, '');
  if (phone && (!/^[+\d\s().-]+$/.test(phone) || digits.length < 7 || digits.length > 15)) fields.phone = 'Укажите телефон: от 7 до 15 цифр, можно с кодом страны.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Проверьте адрес электронной почты.';
  const rawParticipants = body.participants;
  const participants = rawParticipants == null || rawParticipants === '' ? null
    : typeof rawParticipants === 'number' || (typeof rawParticipants === 'string' && /^\d+$/.test(rawParticipants)) ? Number(rawParticipants) : NaN;
  if (participants !== null && (!Number.isSafeInteger(participants) || participants < 2 || participants > 100000)) fields.participants = 'Укажите целое число участников от 2 до 100 000.';
  const format = body.format == null ? 'undecided' : body.format;
  if (!FORMATS.includes(format)) fields.format = 'Выберите формат игры.';
  if (body.consent !== true) fields.consent = 'Необходимо ваше согласие на обработку персональных данных.';
  else if (body.consent_version !== CONSENT_VERSION) fields.consent = 'Обновите страницу и ознакомьтесь с действующей редакцией согласия.';
  if (typeof body.submission_id !== 'string' || !UUID.test(body.submission_id)) throw new EnquiryError('Обновите страницу и попробуйте отправить заявку ещё раз.');
  if (Object.keys(fields).length) throw new EnquiryError('Проверьте поля заявки.', 400, fields);
  const values = { company, participants, format, phone, telegram, email, consent_version: CONSENT_VERSION };
  return { ...values, submission_id: body.submission_id.toLowerCase(), payload_hash: createHash('sha256').update(JSON.stringify(values)).digest('hex') };
}

function searchText(item) {
  return [item.id || '', item.company, item.phone, item.phone.replace(/\D/g, ''), item.telegram, item.email, item.notes || '', 'корпоратив'].join(' ').toLocaleLowerCase('ru-RU');
}

function publicAdminItem(row) {
  if (!row) return null;
  const { submission_key, payload_hash, search_text, ...item } = row;
  return item;
}

function createEnquiryStore({ query, dialect = 'sqlite', now = () => new Date().toISOString() }) {
  let initialization;
  const marks = (count, start = 1) => Array.from({ length: count }, (_, index) => dialect === 'postgresql' ? `$${index + start}` : '?').join(', ');
  const mark = index => dialect === 'postgresql' ? `$${index}` : '?';
  const tableSql = (name, ifNotExists = true) => `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${name} (
    id TEXT PRIMARY KEY,
    submission_key TEXT UNIQUE NOT NULL,
    payload_hash TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'corporate',
    source TEXT NOT NULL DEFAULT '/corporate',
    company TEXT NOT NULL,
    participants INTEGER CHECK(participants >= 2 AND participants <= 100000),
    format TEXT NOT NULL CHECK(format IN ('undecided', 'online', 'offline')),
    phone TEXT NOT NULL,
    telegram TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'in_progress', 'agreed', 'closed')),
    notes TEXT NOT NULL DEFAULT '',
    search_text TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    consent_version TEXT NOT NULL DEFAULT '',
    consented_at TEXT NOT NULL DEFAULT ''
  )`;

  async function migrate() {
    if (dialect === 'postgresql') {
      await query(`ALTER TABLE site_enquiries ALTER COLUMN participants DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS consent_version TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS consented_at TEXT NOT NULL DEFAULT ''`);
      return;
    }
    const columns = (await query('PRAGMA table_info(site_enquiries)')).rows;
    const names = new Set(columns.map(column => column.name));
    if (columns.find(column => column.name === 'participants')?.notnull) {
      // SQLite requires rebuilding the table to remove NOT NULL. Copy every
      // original column in one transaction; historical consent stays unknown.
      const original = ['id', 'submission_key', 'payload_hash', 'kind', 'source', 'company', 'participants', 'format', 'phone', 'telegram', 'email', 'status', 'notes', 'search_text', 'revision', 'updated_by', 'created_at', 'updated_at'];
      const all = [...original, 'consent_version', 'consented_at'];
      const selected = all.map(name => names.has(name) ? name : "''");
      await query('BEGIN IMMEDIATE');
      try {
        await query(tableSql('site_enquiries_migrated', false));
        await query(`INSERT INTO site_enquiries_migrated (${all.join(', ')}) SELECT ${selected.join(', ')} FROM site_enquiries`);
        await query('DROP TABLE site_enquiries');
        await query('ALTER TABLE site_enquiries_migrated RENAME TO site_enquiries');
        await query('COMMIT');
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }
    } else {
      for (const name of ['consent_version', 'consented_at']) {
        if (!names.has(name)) await query(`ALTER TABLE site_enquiries ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`);
      }
    }
  }

  async function init() {
    if (!initialization) {
      initialization = (async () => {
        await query(tableSql('site_enquiries'));
        await migrate();
        await query('CREATE INDEX IF NOT EXISTS idx_site_enquiries_created ON site_enquiries(created_at, id)');
        await query('CREATE INDEX IF NOT EXISTS idx_site_enquiries_status ON site_enquiries(status, created_at)');
      })().catch(error => { initialization = null; throw error; });
    }
    return initialization;
  }

  async function findSubmission(submissionId, hash) {
    await init();
    const result = await query(`SELECT id, payload_hash FROM site_enquiries WHERE submission_key = ${mark(1)}`, [submissionId]);
    const row = result.rows[0];
    if (row && row.payload_hash !== hash) throw new EnquiryError('Данные заявки изменились. Отправьте новую заявку.', 409);
    return row ? { id: row.id, created: false } : null;
  }

  async function submit(values) {
    await init();
    const id = randomUUID();
    const timestamp = now();
    const result = await query(`INSERT INTO site_enquiries
      (id, submission_key, payload_hash, company, participants, format, phone, telegram, email, search_text, created_at, updated_at, consent_version, consented_at)
      VALUES (${marks(14)}) ON CONFLICT (submission_key) DO NOTHING RETURNING id`,
    [id, values.submission_id, values.payload_hash, values.company, values.participants, values.format, values.phone, values.telegram, values.email, searchText({ ...values, id }), timestamp, timestamp, values.consent_version, timestamp]);
    if (result.rows.length) return { id, created: true };
    return findSubmission(values.submission_id, values.payload_hash);
  }

  async function get(id) {
    if (typeof id !== 'string' || !UUID.test(id)) throw new EnquiryError('Неверный номер заявки.');
    await init();
    const result = await query(`SELECT * FROM site_enquiries WHERE id = ${mark(1)}`, [id]);
    const row = publicAdminItem(result.rows[0]);
    if (!row) throw new EnquiryError('Заявка не найдена.', 404);
    return row;
  }

  async function list(filters = {}) {
    await init();
    const status = filters.status || '';
    if (status && !STATUSES.includes(status)) throw new EnquiryError('Выберите статус заявки.');
    const q = typeof filters.q === 'string' ? filters.q.trim() : '';
    if (q.length > 160) throw new EnquiryError('Сократите поисковый запрос до 160 символов.');
    const page = filters.page == null ? 1 : Number(filters.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new EnquiryError('Неверная страница списка.');
    const pageSize = 25;
    const params = [];
    const clauses = [];
    if (status) { params.push(status); clauses.push(`status = ${mark(params.length)}`); }
    if (q) {
      params.push(`%${q.toLocaleLowerCase('ru-RU').replace(/[\\%_]/g, '\\$&')}%`);
      clauses.push(`search_text LIKE ${mark(params.length)} ESCAPE '\\'`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [totalResult, countResult] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM site_enquiries ${where}`, params),
      query('SELECT status, COUNT(*) AS count FROM site_enquiries GROUP BY status')
    ]);
    const total = Number(totalResult.rows[0].total);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const effectivePage = Math.min(page, pages);
    const listParams = [...params, pageSize, (effectivePage - 1) * pageSize];
    const rows = await query(`SELECT * FROM site_enquiries ${where} ORDER BY created_at DESC, id DESC LIMIT ${mark(params.length + 1)} OFFSET ${mark(params.length + 2)}`, listParams);
    const counts = Object.fromEntries(STATUSES.map(value => [value, 0]));
    for (const row of countResult.rows) counts[row.status] = Number(row.count);
    return { items: rows.rows.map(publicAdminItem), total, page: effectivePage, pageSize, pages, counts };
  }

  async function update(id, body, username) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !STATUSES.includes(body.status)) throw new EnquiryError('Выберите статус заявки.');
    if (typeof body.notes !== 'string' || body.notes.length > 5000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.notes)) throw new EnquiryError('Заметка должна быть текстом до 5 000 символов.');
    if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw new EnquiryError('Обновите карточку заявки перед сохранением.');
    const original = await get(id);
    const notes = body.notes.trim();
    const result = await query(`UPDATE site_enquiries SET status = ${mark(1)}, notes = ${mark(2)}, search_text = ${mark(3)}, updated_at = ${mark(4)}, updated_by = ${mark(5)}, revision = revision + 1 WHERE id = ${mark(6)} AND revision = ${mark(7)} RETURNING *`,
      [body.status, notes, searchText({ ...original, notes }), now(), String(username || ''), id, body.revision]);
    if (!result.rows.length) throw new EnquiryError('Заявка уже изменена другим администратором. Обновите карточку и проверьте изменения.', 409);
    return publicAdminItem(result.rows[0]);
  }

  async function summary() {
    await init();
    const result = await query('SELECT status, COUNT(*) AS count FROM site_enquiries GROUP BY status');
    const counts = Object.fromEntries(STATUSES.map(value => [value, 0]));
    for (const row of result.rows) counts[row.status] = Number(row.count);
    return { counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
  }

  return { init, findSubmission, submit, list, get, update, summary };
}

module.exports = { createEnquiryStore, normalizeSubmission, EnquiryError, STATUSES, CONSENT_VERSION };
