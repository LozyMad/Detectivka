'use strict';

const express = require('express');
const { isIP } = require('net');
const { enquiries } = require('../config/database');
const { authenticateToken, superAdminRequired } = require('../middleware/auth');
const { normalizeSubmission, EnquiryError } = require('../services/enquiryStore');

function clientAddress(req) {
  const direct = req.socket?.remoteAddress || req.ip || 'unknown';
  // The deployed reverse proxy is local. Trust its last forwarded address only;
  // clients connecting directly cannot select their own rate-limit bucket.
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(direct)) {
    const forwarded = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].split(',').pop().trim() : '';
    if (isIP(forwarded)) return forwarded;
  }
  return direct;
}

function createSubmissionLimiter({ limit = 8, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const buckets = new Map();
  return req => {
    const timestamp = now();
    for (const [key, bucket] of buckets) if (bucket.expires <= timestamp) buckets.delete(key);
    const key = clientAddress(req);
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= 10000) return false;
      bucket = { count: 0, expires: timestamp + windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) return false;
    bucket.count++;
    return true;
  };
}

function createEnquiryRoutes({ store = enquiries, limiter = createSubmissionLimiter() } = {}) {
  const publicRouter = express.Router();
  const adminRouter = express.Router();

  function failure(res, error, fallback) {
    if (error instanceof EnquiryError) return res.status(error.status).json({ error: error.message, ...(error.fields ? { fields: error.fields } : {}) });
    console.error('[Enquiries]', error.code || error.name || 'Storage error');
    return res.status(503).json({ error: fallback });
  }

  publicRouter.post('/corporate', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.is('application/json')) return res.status(415).json({ error: 'Отправьте заявку через форму на сайте.' });
    try {
      const values = normalizeSubmission(req.body);
      const previous = await store.findSubmission(values.submission_id, values.payload_hash);
      if (previous) return res.json({ ok: true, id: previous.id });
      if (!limiter(req)) {
        res.setHeader('Retry-After', '900');
        return res.status(429).json({ error: 'Слишком много заявок за короткое время. Попробуйте позже или напишите в @detectum.' });
      }
      const saved = await store.submit(values);
      return res.status(saved.created ? 201 : 200).json({ ok: true, id: saved.id });
    } catch (error) {
      return failure(res, error, 'Не удалось сохранить заявку. Попробуйте ещё раз или напишите в @detectum.');
    }
  });

  adminRouter.use(authenticateToken, superAdminRequired);
  adminRouter.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  adminRouter.get('/summary', async (req, res) => {
    try { res.json(await store.summary()); }
    catch (error) { failure(res, error, 'Не удалось загрузить число заявок. Попробуйте ещё раз.'); }
  });
  adminRouter.get('/', async (req, res) => {
    try { res.json(await store.list(req.query)); }
    catch (error) { failure(res, error, 'Не удалось загрузить заявки. Попробуйте ещё раз.'); }
  });
  adminRouter.get('/:id', async (req, res) => {
    try { res.json({ enquiry: await store.get(req.params.id) }); }
    catch (error) { failure(res, error, 'Не удалось загрузить заявку. Попробуйте ещё раз.'); }
  });
  adminRouter.patch('/:id', async (req, res) => {
    try { res.json({ enquiry: await store.update(req.params.id, req.body, req.user.username) }); }
    catch (error) { failure(res, error, 'Не удалось сохранить изменения. Попробуйте ещё раз.'); }
  });

  return { publicRouter, adminRouter };
}

module.exports = { ...createEnquiryRoutes(), createEnquiryRoutes, createSubmissionLimiter, clientAddress };
