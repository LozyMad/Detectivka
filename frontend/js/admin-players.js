'use strict';
(() => {
  const byId=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status={pending:'Ожидает старта',running:'Идёт игра',paused:'На паузе',finished:'Завершена'};
  const actions={grant_access:'Выдан доступ',add_attempts:'Добавлены попытки',start:'Игра запущена',pause:'Таймер приостановлен',resume:'Игра продолжена',add_time:'Добавлено время',finish:'Комната завершена'};
  const date=value=>value?new Date(value).toLocaleString('ru-RU'):'—';
  const clock=seconds=>seconds==null?'Не запущен':`${Math.floor(Math.max(0,seconds)/3600)}:${String(Math.floor(Math.max(0,seconds)%3600/60)).padStart(2,'0')}:${String(Math.max(0,seconds)%60).padStart(2,'0')}`;
  const badge=r=>`<span class="pa-badge ${escape(r.state)}">${escape(status[r.state]||r.state)}</span>`;
  let initialized=false,view='players',page=1,pages=1,selected=null,listSequence=0,detailSequence=0,searchTimer;
  const pending=new Map();
  async function request(path,options={}){
    const response=await window.gameNetwork.fetch('/api/player/admin/manage'+path,{...options,headers:{'Authorization':'Bearer '+localStorage.getItem('token'),...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
    const data=await response.json();
    if(!response.ok){if(response.status===401||(response.status===403&&String(data.code||'').startsWith('AUTH_'))){localStorage.removeItem('token');localStorage.removeItem('user');location.href='/admin-login?session=expired';}throw new Error(data.error||'Не удалось выполнить действие');}return data;
  }
  function message(id,text){byId(id).textContent=text||'';byId(id).hidden=!text;}
  function journal(items){return items.length?items.map(j=>`<div class="pa-journal"><strong>${escape(actions[j.action]||j.action)}</strong><p>${escape(j.reason)}</p><small>${escape(j.admin_name)} · ${escape(date(j.created_at))}${j.room_id?' · комната №'+escape(j.room_id):''}${j.payload.amount?' · +'+escape(j.payload.amount)+' попыток':''}${j.payload.minutes?' · +'+escape(j.payload.minutes)+' мин':''}</small></div>`).join(''):'<p class="pa-muted">Действий пока нет.</p>';}
  function roomRows(items){return items.map(r=>`<div class="pa-row ${selected?.type==='rooms'&&String(selected.id)===String(r.id)?'selected':''}"><div><strong>${escape(r.name)}</strong><small>№${escape(r.id)} · ${escape(r.title)}</small><small>${escape(r.owner_name||'Создана организатором')}${r.attempt_number?' · попытка '+escape(r.attempt_number):''}</small>${badge(r)}<small>${r.state==='pending'?'Длительность: '+Math.round(r.duration_seconds/60)+' мин':'Таймер: <span data-pa-seconds="'+escape(r.remaining_seconds)+'" data-pa-running="'+(r.state==='running')+'" data-pa-at="'+Date.now()+'">'+clock(r.remaining_seconds)+'</span>'} · ${r.answers_submitted?'Ответы отправлены':'Ответы ещё не отправлены'}</small></div><button class="btn btn-sm btn-outline-primary" data-pa-open="rooms" data-id="${escape(r.id)}">Открыть</button></div>`).join('');}
  async function list(){
    const seq=++listSequence;byId('paList').classList.add('pa-loading');message('paError','');
    try{
      const qs=new URLSearchParams({page:String(page),q:byId('paSearch').value,state:byId('paState').value});
      const data=await request(view==='journal'?'/journal':'/'+view+'?'+qs);if(seq!==listSequence)return;
      pages=data.pages||1;byId('paCount').textContent=view==='journal'?'Последние 100 действий':`${view==='players'?'Игроков':'Общих комнат'}: ${data.total} · данные на момент обновления`;
      byId('paList').innerHTML=view==='journal'?journal(data.items):view==='rooms'?roomRows(data.items):data.items.map(a=>`<div class="pa-row ${selected?.type==='players'&&selected.id===a.id?'selected':''}"><div><strong>${escape(a.username)}</strong><small>${escape(a.email)}</small><small>Комнат создано: ${escape(a.games_count)} · регистрация ${escape(date(a.created_at))}</small></div><button class="btn btn-sm btn-outline-primary" data-pa-open="players" data-id="${escape(a.id)}">Открыть</button></div>`).join('');
      if(!data.items.length)byId('paList').innerHTML='<div class="pa-empty">По этим условиям ничего не найдено.</div>';
      byId('paPage').textContent=`${page} / ${pages}`;byId('paPrev').disabled=page<=1;byId('paNext').disabled=page>=pages;byId('paPage').parentElement.hidden=view==='journal';
    }catch(e){if(seq===listSequence)message('paError',e.message);}finally{if(seq===listSequence)byId('paList').classList.remove('pa-loading');}
  }
  function playerCard(data){
    const {account:a,products,games}=data;
    return `<div class="pa-top"><div><span class="pa-eyebrow">Карточка игрока</span><h4>${escape(a.username)}</h4><p class="pa-muted">${escape(a.email)}<br>На сайте с ${escape(date(a.created_at))}</p></div><button class="btn btn-sm btn-outline-secondary" data-pa-close>Закрыть</button></div>
    <div class="pa-section"><h5>Дела и попытки</h5><div class="pa-cases">${products.map(p=>`<div class="pa-case"><strong>${escape(p.title)}</strong><p>${p.owned?'Доступ открыт':'Нет доступа'}${!p.published?' · скрыто в каталоге':''}</p><p>${p.owned?'Осталось '+p.attempts_left+' из '+(Number(p.max_attempts)+p.extra)+' · завершено '+p.used+(p.extra?' · дополнительно выдано '+p.extra:''):'Базово '+p.max_attempts+' попытки'}</p></div>`).join('')||'<p class="pa-muted">Дела не найдены.</p>'}</div></div>
    ${data.can_grant&&products.length?`<div class="pa-section"><h5>Выдать доступ или попытки</h5><form class="pa-form" data-pa-form="grant" data-id="${escape(a.id)}"><label>Дело<select class="form-select" name="product_id" required>${products.map(p=>`<option value="${escape(p.id)}" data-owned="${p.owned}">${escape(p.title)}</option>`).join('')}</select></label><label>Действие<select class="form-select" name="action"><option value="grant_access">Выдать доступ к делу</option><option value="add_attempts">Добавить попытки</option></select></label><label data-pa-amount hidden>Количество попыток<input class="form-control" name="amount" type="number" min="1" max="10" value="1"></label><label>Причина<textarea class="form-control" name="reason" required minlength="3" maxlength="500" rows="2" placeholder="Например: компенсация технического сбоя"></textarea></label><p class="pa-muted small">Ручная выдача доступа не создаёт оплаченный заказ. Добавление попыток сохраняет историю прохождений.</p><button class="btn btn-primary" type="submit">Сохранить выдачу</button></form></div>`:'<p class="pa-muted pa-section">Доступы и дополнительные попытки выдаёт главный администратор.</p>'}
    <div class="pa-section"><h5>Комнаты и результаты</h5>${games.length?games.map(g=>`<div class="pa-row"><div><strong>${escape(g.name)}</strong><small>${escape(g.title)} · ${g.attempt_number?'попытка '+g.attempt_number:'участник'}${g.result_status==='graded'?' · '+g.score+' / 2000 баллов':g.result_status==='pending_review'?' · ожидает проверки':''}</small>${badge(g)}</div>${g.is_shared?`<button class="btn btn-sm btn-outline-primary" data-pa-open="rooms" data-id="${escape(g.id)}">Комната</button>`:'<small>Отдельная команда</small>'}</div>`).join(''):'<p class="pa-muted">Игрок ещё не создавал комнаты.</p>'}</div>
    <div class="pa-section"><h5>История действий</h5>${journal(data.journal)}</div>`;
  }
  function roomCard(data){
    const {room:r,owner,run}=data;
    const options=r.state==='pending'?['start','add_time']:r.state==='running'?['pause','add_time','finish']:r.state==='paused'?['resume','add_time','finish']:[];
    const names={start:'Начать игру',pause:'Приостановить таймер',resume:'Продолжить игру',add_time:'Добавить время',finish:'Завершить комнату'};
    return `<div class="pa-top"><div><span class="pa-eyebrow">Общая комната №${escape(r.id)}</span><h4>${escape(r.name)}</h4><p class="pa-muted">${escape(r.title)}</p>${badge(r)}</div><button class="btn btn-sm btn-outline-secondary" data-pa-close>Закрыть</button></div>
    <div class="pa-section"><p>${owner?`Создатель: <button class="btn btn-sm btn-outline-primary" data-pa-open="players" data-id="${escape(owner.id)}">${escape(owner.username)}</button>`:'Создана организатором'}</p><p>Длительность: ${Math.round(r.duration_seconds/60)} мин${run?' · попытка '+run.attempt_number:''}<br>Осталось: <strong data-pa-seconds="${escape(r.remaining_seconds)}" data-pa-running="${r.state==='running'}" data-pa-at="${Date.now()}">${clock(r.remaining_seconds)}</strong></p>${data.invite_path?`<label>Ссылка для команды<div class="pa-invite"><input class="form-control" readonly data-pa-link value="${escape(location.origin+data.invite_path)}"><button class="btn btn-outline-primary" data-pa-copy type="button">Копировать</button></div></label>`:'<p class="pa-muted">Вход в завершённую комнату закрыт.</p>'}</div>
    ${options.length?`<div class="pa-section"><h5>Управление игрой</h5><form class="pa-form" data-pa-form="control" data-id="${escape(r.id)}" data-pa-consumes="${!!run}"><label>Действие<select class="form-select" name="action">${options.map(a=>`<option value="${a}">${names[a]}</option>`).join('')}</select></label><label data-pa-minutes hidden>Добавить минут<input class="form-control" name="minutes" type="number" min="1" max="240" value="15"></label><label>Причина<textarea class="form-control" name="reason" required minlength="3" maxlength="500" rows="2" placeholder="Комментарий для журнала действий"></textarea></label><p class="pa-muted small" data-pa-finish hidden>Завершение закроет игру для всей команды${run?' и спишет одну попытку у создателя':''}. Организатор может завершить комнату даже без отправленных ответов.</p><button class="btn btn-primary" type="submit">Выполнить действие</button></form></div>`:'<p class="pa-muted pa-section">Комната завершена. История и результат сохранены.</p>'}
    ${run?`<div class="pa-section"><h5>Результат</h5><p>${run.result_status==='graded'?escape(run.score)+' / 2000 баллов':run.result_status==='pending_review'?'Ожидает проверки организатором':'Появится после завершения'}</p>${run.result_status==='pending_review'?'<a class="btn btn-sm btn-outline-primary" href="/player-reviews.html">Проверить ответы</a>':''}</div>`:''}
    <div class="pa-section"><h5>${data.answers_submitted?'Отправленные ответы':'Черновики ответов'}</h5>${data.questions.map(q=>`<div class="pa-answer"><strong>${escape(q.question_text)}</strong><p>${escape(q.answer_text||'Ответ пока не заполнен')}</p></div>`).join('')||'<p class="pa-muted">Вопросы не добавлены.</p>'}</div><div class="pa-section"><h5>Общие заметки</h5><div class="pa-notes">${escape(data.notes||'Заметок пока нет.')}</div></div><div class="pa-section"><h5>История действий</h5>${journal(data.journal)}</div>`;
  }
  async function detail(type,id,scroll=false){
    const seq=++detailSequence;message('paError','');
    try{const data=await request('/'+type+'/'+encodeURIComponent(id));if(seq!==detailSequence)return;selected={type,id};byId('paDetail').innerHTML=type==='players'?playerCard(data):roomCard(data);byId('paDetail').querySelectorAll('form').forEach(updateForm);if(scroll&&window.innerWidth<1150)byId('paDetail').scrollIntoView({behavior:'smooth',block:'start'});}
    catch(e){if(seq===detailSequence)message('paError',e.message);}
  }
  function updateForm(form){
    const action=form.elements.action.value;
    const own=form.elements.product_id?.selectedOptions[0]?.dataset.owned==='true';
    if(form.dataset.paForm==='grant'){
      const access=form.elements.action.querySelector('[value=grant_access]');access.disabled=own;
      form.elements.action.querySelector('[value=add_attempts]').disabled=!own;
      if(own&&action==='grant_access')form.elements.action.value='add_attempts';
      if(!own&&action==='add_attempts')form.elements.action.value='grant_access';
      form.querySelector('[data-pa-amount]').hidden=form.elements.action.value!=='add_attempts';
      form.elements.amount.disabled=form.elements.action.value!=='add_attempts';
    }else{form.querySelector('[data-pa-minutes]').hidden=action!=='add_time';form.elements.minutes.disabled=action!=='add_time';form.querySelector('[data-pa-finish]').hidden=action!=='finish';}
  }
  async function submit(form){
    const kind=form.dataset.paForm;const fields=Object.fromEntries(new FormData(form));
    if(kind==='grant'&&fields.action==='add_attempts')fields.amount=Number(fields.amount);else delete fields.amount;
    if(kind==='control'&&fields.action==='add_time')fields.minutes=Number(fields.minutes);else delete fields.minutes;
    if(fields.action==='finish'){if(!confirm('Завершить игру для всей команды? '+(form.dataset.paConsumes==='true'?'Это спишет одну попытку у создателя. ':'')+'Действие нельзя отменить.'))return;fields.confirmed=true;}
    const path=kind==='grant'?'/players/'+encodeURIComponent(form.dataset.id)+'/grants':'/rooms/'+encodeURIComponent(form.dataset.id)+'/control';
    const signature=path+JSON.stringify(fields);if(!pending.has(signature))pending.set(signature,crypto.randomUUID());fields.request_key=pending.get(signature);
    const button=form.querySelector('[type=submit]');button.disabled=true;message('paError','');message('paNotice','');
    try{await request(path,{method:'POST',body:JSON.stringify(fields)});pending.delete(signature);message('paNotice','Изменение сохранено и записано в журнал.');await detail(selected.type,selected.id);await list();}
    catch(e){message('paError',e.message);}finally{if(button.isConnected)button.disabled=false;}
  }
  function init(){
    if(initialized)return;initialized=true;const panel=byId('playerManagement-tab');
    panel.addEventListener('click',async event=>{
      const target=event.target.closest('button');if(!target)return;
      if(target.dataset.paView){view=target.dataset.paView;page=1;selected=null;detailSequence++;byId('paDetail').innerHTML='<div class="pa-empty">Выберите игрока или комнату, чтобы увидеть подробности.</div>';panel.querySelectorAll('[data-pa-view]').forEach(b=>{b.classList.toggle('btn-primary',b===target);b.classList.toggle('btn-outline-primary',b!==target);});byId('paSearch').value='';byId('paState').value='';byId('paSearch').parentElement.hidden=view==='journal';byId('paStateWrap').hidden=view!=='rooms';byId('paCreate').hidden=view!=='rooms';byId('paSearch').placeholder=view==='rooms'?'Название комнаты, дела или создателя':'Имя или email игрока';panel.querySelector('.pa-layout').classList.toggle('pa-wide',view==='journal');message('paNotice','');await list();}
      if(target.dataset.paOpen)await detail(target.dataset.paOpen,target.dataset.id,true);
      if(target.hasAttribute('data-pa-close')){selected=null;detailSequence++;byId('paDetail').innerHTML='<div class="pa-empty">Выберите игрока или комнату.</div>';}
      if(target.hasAttribute('data-pa-copy')){const input=panel.querySelector('[data-pa-link]');try{await navigator.clipboard.writeText(input.value);message('paNotice','Ссылка скопирована.');}catch(_){input.focus();input.select();message('paNotice','Скопируйте выделенную ссылку.');}}
    });
    panel.addEventListener('change',e=>{if(e.target.closest('form'))updateForm(e.target.closest('form'));});
    panel.addEventListener('submit',e=>{const form=e.target.closest('[data-pa-form]');if(form){e.preventDefault();submit(form);}});
    byId('paRefresh').addEventListener('click',async()=>{await list();if(selected)await detail(selected.type,selected.id);});
    byId('paSearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=1;list();},300);});
    byId('paState').addEventListener('change',()=>{page=1;list();});
    byId('paPrev').addEventListener('click',()=>{if(page>1){page--;list();}});byId('paNext').addEventListener('click',()=>{if(page<pages){page++;list();}});
    byId('paCreate').addEventListener('click',()=>{switchTab('rooms');document.getElementById('roomName')?.focus();});
    setInterval(()=>{if(document.hidden||panel.style.display!=='block')return;panel.querySelectorAll('[data-pa-seconds]').forEach(el=>{const n=Number(el.dataset.paSeconds);if(el.dataset.paSeconds==='')return;const remaining=el.dataset.paRunning==='true'?Math.max(0,n-Math.floor((Date.now()-Number(el.dataset.paAt))/1000)):n;el.textContent=clock(remaining);});},1000);
  }
  window.adminPlayers={load:()=>{init();return list();}};
})();
