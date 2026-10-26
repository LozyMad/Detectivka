'use strict';
const express = require('express');
const { authenticateToken, adminRequired } = require('../middleware/auth');
const { cabinet } = require('../services/playerRuntime');
const router = express.Router();
const wrap = handler => (req,res,next) => Promise.resolve().then(() => handler(req,res)).catch(next);
const attempts = new Map();
router.use((req,res,next) => {
  res.set('Cache-Control','no-store');
  if (!['GET','HEAD'].includes(req.method)) {
    if (!req.is('application/json')) return res.status(415).json({error:'Ожидается JSON'});
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({error:'Запрос с другого сайта запрещён'});
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.get('host')) return res.status(403).json({error:'Запрос с другого сайта запрещён'}); }
      catch (_) { return res.status(403).json({error:'Некорректный источник запроса'}); }
    }
  }
  next();
});
router.get('/public/:publicId',wrap(async(req,res) => res.json(await cabinet.houses.publicInfo(req.params.publicId))));
router.post('/public/:publicId/join',(req,res,next) => {
  const time=Date.now(), key=req.ip+':'+req.params.publicId+':'+String(req.body?.room_id), old=attempts.get(key);
  if (!old || old.until<time) attempts.set(key,{until:time+60000,count:1});
  else if (++old.count>15) {res.set('Retry-After','60');return res.status(429).json({error:'Слишком много попыток. Подождите минуту'});}
  if (attempts.size>5000) for(const [id,value] of attempts) if(value.until<time) attempts.delete(id);
  next();
},wrap(async(req,res) => res.json(await cabinet.houses.join(req.params.publicId,req.body))));
router.use(authenticateToken,adminRequired);
router.get('/',wrap(async(req,res) => res.json(await cabinet.houses.list(req.user,req.query.archived==='true'))));
router.post('/',wrap(async(req,res) => res.status(201).json(await cabinet.houses.create(req.user,req.body))));
router.get('/:id',wrap(async(req,res) => res.json(await cabinet.houses.detail(req.user,req.params.id))));
router.patch('/:id',wrap(async(req,res) => res.json(await cabinet.houses.update(req.user,req.params.id,req.body))));
router.post('/:id/archive',wrap(async(req,res) => res.json(await cabinet.houses.archive(req.user,req.params.id,req.body))));
router.delete('/:id',wrap(async(req,res) => res.json(await cabinet.houses.remove(req.user,req.params.id,req.body))));
router.post('/:id/control',wrap(async(req,res) => res.json(await cabinet.houses.control(req.user,req.params.id,req.body))));
router.post('/:id/teams',wrap(async(req,res) => res.status(201).json(await cabinet.houses.addTeam(req.user,req.params.id,req.body))));
router.patch('/:id/teams/:roomId',wrap(async(req,res) => res.json(await cabinet.houses.editTeam(req.user,req.params.id,Number(req.params.roomId),req.body))));
router.delete('/:id/teams/:roomId',wrap(async(req,res) => res.json(await cabinet.houses.removeTeam(req.user,req.params.id,Number(req.params.roomId),req.body))));
router.use((error,req,res,next) => {
  if(res.headersSent)return next(error);
  const conflict=error.code==='23505'||String(error.code).startsWith('SQLITE_CONSTRAINT');
  if(!error.status&&!conflict)console.error('[Game houses]',error);
  res.status(error.status||(conflict?409:500)).json({error:error.status?error.message:conflict?'Эти данные уже используются':'Не удалось выполнить действие. Попробуйте ещё раз'});
});
module.exports = router;
