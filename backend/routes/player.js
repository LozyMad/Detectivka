const express = require('express');
const {cabinet,localMode,SESSION_MS} = require('../services/playerRuntime');
const {authenticateToken,adminRequired} = require('../middleware/auth');
const router = express.Router();
const COOKIE = 'detectum_account';
const attempts = new Map();
const wrap = handler => (req,res,next) => Promise.resolve().then(()=>handler(req,res)).catch(next);
const token = req => {
  const match=(req.headers.cookie||'').split(';').map(p=>p.trim()).find(p=>p.startsWith(COOKIE+'='));
  try{return match?decodeURIComponent(match.slice(COOKIE.length+1)):'';}catch(_){return '';}
};
const setSession = (res,value) => res.cookie(COOKIE,value,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/api/player',maxAge:SESSION_MS});
const clearSession = res => res.clearCookie(COOKIE,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/api/player'});
router.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(!['GET','HEAD'].includes(req.method)){
    if(req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({error:'Запрос с другого сайта запрещён'});
    if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.get('host'))return res.status(403).json({error:'Запрос с другого сайта запрещён'});}catch(_){return res.status(403).json({error:'Некорректный источник запроса'});}}
    if(!req.is('application/json'))return res.status(415).json({error:'Ожидается JSON'});
  }
  next();
});
const throttle = (req,res,next)=>{
  const key=req.ip+req.path;const time=Date.now();const record=attempts.get(key);
  if(!record||record.until<time)attempts.set(key,{until:time+60000,count:1});else if(++record.count>20){res.set('Retry-After','60');return res.status(429).json({error:'Слишком много попыток. Подождите минуту'});}
  if(attempts.size>5000)for(const [k,v]of attempts)if(v.until<time)attempts.delete(k);
  next();
};
const localOnly = (req,res,next)=>{if(!localMode||!['localhost','127.0.0.1','::1','[::1]'].includes(req.hostname))return res.status(503).json({error:'Тестовая операция доступна только на localhost'});next();};
const auth = (req,res,next)=>cabinet.authenticate(token(req)).then(account=>{req.player=account;next();}).catch(next);
const authResult = async(res,result)=>{setSession(res,result.token);res.json({account:result.account});};
router.use('/admin/manage',require('./playerAdmin'));
router.get('/catalog',wrap(async(req,res)=>{let account;try{account=await cabinet.authenticate(token(req));}catch(error){if(error.status!==401)throw error;}res.json({products:await cabinet.catalog(account?.id),bundles:await cabinet.bundles(),local_mode:localMode});}));
router.post('/register',throttle,wrap(async(req,res)=>{const result=await cabinet.register(req.body||{});res.status(201);await authResult(res,result);}));
router.post('/login',throttle,wrap(async(req,res)=>authResult(res,await cabinet.login(req.body||{}))));
router.post('/logout',wrap(async(req,res)=>{await cabinet.logout(token(req));clearSession(res);res.json({ok:true});}));
router.post('/forgot-password',throttle,localOnly,wrap(async(req,res)=>res.json(await cabinet.requestReset(req.body||{}))));
router.post('/reset-password',throttle,wrap(async(req,res)=>{const result=await cabinet.resetPassword(req.body||{});clearSession(res);res.json(result);}));
router.get('/admin/reviews',authenticateToken,adminRequired,wrap(async(req,res)=>res.json({reviews:(await cabinet.scoring.reviews(req.user,req.query)).items})));
router.post('/admin/reviews/:id',authenticateToken,adminRequired,(req,res)=>res.status(400).json({error:'Обновите страницу проверки: теперь нужно оценить каждый ответ от 0 до 5 и опубликовать гонорар.'}));
router.post('/invite/join',throttle,wrap(async(req,res)=>{
  let account=null;try{account=await cabinet.authenticate(token(req));}catch(error){if(error.status!==401)throw error;}
  res.json(await cabinet.shared.join(req.body?.invite_token,account));
}));
router.use(auth);
router.get('/session',wrap(async(req,res)=>res.json({account:req.player,local_mode:localMode})));
router.get('/profile',wrap(async(req,res)=>res.json({account:req.player,...await cabinet.profile(req.player.id)})));
router.patch('/account',throttle,wrap(async(req,res)=>authResult(res,await cabinet.updateAccount(req.player.id,req.body||{}))));
router.post('/orders',localOnly,wrap(async(req,res)=>res.status(201).json({order:await cabinet.purchase(req.player.id,req.body||{})})));
router.post('/games',wrap(async(req,res)=>{const run=await cabinet.start(req.player.id,req.body||{});res.status(201).json(await cabinet.enter(req.player.id,run.id));}));
router.post('/games/join',throttle,wrap(async(req,res)=>{const run=await cabinet.join(req.player.id,req.body||{});res.json(await cabinet.enter(req.player.id,run.id));}));
router.post('/games/:id/enter',wrap(async(req,res)=>res.json(await cabinet.enter(req.player.id,req.params.id))));
router.post('/games/:id/control',wrap(async(req,res)=>res.json({game:await cabinet.control(req.player.id,req.params.id,req.body?.action,{confirmed:req.body?.confirmed===true})})));
router.get('/games/:id/result',wrap(async(req,res)=>res.json(await cabinet.result(req.player.id,req.params.id))));
router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const conflict=error.code==='23505'||String(error.code).startsWith('SQLITE_CONSTRAINT');if(!error.status&&!conflict)console.error('[Player cabinet]',error);res.status(error.status||(conflict?409:500)).json({...((error.code==='ROOM_FINISHED')?{code:error.code}:{}),error:error.status?error.message:conflict?'Эти данные уже используются':'Не удалось выполнить действие. Попробуйте ещё раз'});});
module.exports=router;
