(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statuses={pending:'Ожидает старта',running:'Идёт игра',paused:'На паузе',finished:'Завершён'};
  const clock=value=>value==null?'Без таймера':`${Math.floor(Math.max(0,value)/3600)}:${String(Math.floor(Math.max(0,value)%3600/60)).padStart(2,'0')}:${String(Math.max(0,value)%60).padStart(2,'0')}`;
  const date=value=>value?new Date(value).toLocaleString('ru-RU'):'Дата не указана';
  let initialized=false,selected=null,current=null,sequence=0,polling=false,mutating=false,retry=null;
  async function request(path,options={}){
    const response=await fetch('/api/houses'+path,{...options,headers:{Authorization:'Bearer '+localStorage.getItem('token'),...(options.body?{'Content-Type':'application/json'}:{})},cache:'no-store',signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok){if(response.status===401||String(data.code||'').startsWith('AUTH_'))location.href='/admin-login';const error=new Error(data.error||'Не удалось выполнить действие');error.status=response.status;throw error;}
    return data;
  }
  function message(value){$('houses-error').textContent=value||'';$('houses-error').hidden=!value;$('houses-retry').hidden=!retry;}
  async function mutate(path,body={},method='POST'){
    if(mutating)return;
    const signature=JSON.stringify({path,body,method});
    if(retry&&retry.signature!==signature)throw new Error('Повторите последнее действие кнопкой над списком: сервер мог уже принять его.');
    const op=retry||{path,method,signature,body:{...body,request_key:crypto.randomUUID(),...(current&&selected?{revision:body.revision??current.house.revision}:{})}};
    mutating=true;retry=op;
    try{
      const data=await request(op.path,{method:op.method,body:JSON.stringify(op.body)});retry=null;message('');return data;
    }catch(error){if(error.status&&error.status<500)retry=null;message(error.name==='TimeoutError'?'Сервер не ответил вовремя. Повторите последнее действие.':error.message);throw error;}
    finally{mutating=false;$('houses-retry').hidden=!retry;}
  }
  const button=(action,label,extra='',kind='outline-primary')=>`<button type="button" class="btn btn-${kind} btn-sm" data-house-action="${action}" ${extra}>${label}</button>`;
  function init(){
    if(initialized)return;initialized=true;
    $('houses-tab').innerHTML=`<div class="houses-workspace"><div id="houses-root-toolbar" class="houses-toolbar">${button('create','Создать дом','','primary')}${button('refresh','Обновить')}</div><p id="houses-error" class="alert alert-danger houses-error" role="alert" hidden></p><button id="houses-retry" type="button" class="btn btn-warning mb-3" hidden>Повторить последнее действие</button><div id="houses-list" class="houses-grid"></div><div id="houses-detail" hidden></div></div>`;
    $('houses-tab').addEventListener('click',event=>{
      const target=event.target.closest('[data-house-action]');if(!target)return;
      event.preventDefault();handle(target.dataset.houseAction,target).catch(error=>message(error.message));
    });
    $('houses-retry').onclick=async()=>{
      if(!retry||mutating)return;
      const op=retry;
      try{const data=await mutate(op.path,JSON.parse(op.signature).body,op.method);if(data?.id)selected=data.id;document.querySelector('.houses-dialog[open]')?.close();await load();}
      catch(_){}
    };
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDetail();});
    window.addEventListener('pagehide',()=>{polling=false;});
    polling=true;setTimeout(tick,3000);
  }
  async function tick(){
    if(!polling)return;
    if(!document.hidden&&$('houses-tab')?.style.display!=='none'&&!mutating)await refreshDetail();
    setTimeout(tick,3000);
  }
  async function load(){
    init();const seq=++sequence;
    try{
      if(selected){
        const data=await request('/'+encodeURIComponent(selected));if(seq!==sequence)return;
        current=data;renderDetail();
      }else{
        const data=await request('');if(seq!==sequence)return;
        current=null;$('houses-detail').hidden=true;$('houses-list').hidden=false;$('houses-root-toolbar').hidden=false;
        $('houses-list').innerHTML=data.items.length?data.items.map(h=>`<article class="houses-card"><span class="pa-badge ${esc(h.state)}">${esc(statuses[h.state])}</span><h3 class="mt-3">${esc(h.name)}</h3><p>${esc(h.scenario_name)}</p><p class="houses-muted">${h.format==='offline'?'Очная игра':'Онлайн'} · ${esc(date(h.scheduled_at))}</p><p>${h.team_count} агентств</p>${button('open','Открыть дом',`data-id="${esc(h.id)}"`)}</article>`).join(''):'<div class="houses-card"><h3>Первый дом</h3><p>Выберите дело, подготовьте агентства и запустите общую игру.</p></div>';
      }
      if(!retry)message('');
    }catch(error){message(error.message);}
  }
  async function refreshDetail(){
    if(!selected||!current||mutating)return;
    const id=selected,seq=sequence;
    try{const data=await request('/'+encodeURIComponent(id));if(selected!==id||seq!==sequence||mutating)return;current=data;updateDetail();}
    catch(error){message(error.message);}
  }
  function renderDetail(){
    const h=current.house;
    $('houses-list').hidden=true;$('houses-detail').hidden=false;$('houses-root-toolbar').hidden=true;
    $('houses-detail').innerHTML=`<div class="houses-toolbar">${button('back','← Все дома')}<h2>${esc(h.name)}</h2>${button('refresh','Обновить')}${button('settings','Настройки',h.state!=='pending'?'disabled':'')}</div><div class="houses-card mb-3"><div class="houses-meta"><span>${esc(h.scenario_name)}</span><span>${h.format==='offline'?'Очная игра':'Онлайн'}</span><span>${esc(date(h.scheduled_at))}</span><span>${esc(h.venue)}</span></div><div id="house-timer"></div><div id="house-controls" class="houses-controls"></div><p class="houses-muted">Запуск, пауза и добавление времени действуют на все агентства. ${h.questions_delay_seconds?'Вопросы открываются через '+Math.floor(h.questions_delay_seconds/60)+' минут игрового времени.':'Вопросы доступны сразу после старта.'}</p>${button('copy','Скопировать ссылку дома')} <a class="btn btn-outline-primary btn-sm" href="${esc(h.invite_path)}" target="_blank" rel="noopener">Открыть вход игроков</a><span id="house-copy-status" class="ms-2" role="status"></span></div><div class="houses-toolbar"><h3>Агентства и гонорары</h3><span id="house-standings-status" class="houses-muted"></span>${button('add-team','Добавить агентство',h.state!=='pending'?'disabled':'')}</div><div class="table-responsive"><table class="table houses-table"><thead><tr><th>Место</th><th>Агентство</th><th>Участники</th><th>Игра</th><th>Гонорар</th><th>Проверка</th><th>Действия</th></tr></thead><tbody id="house-teams"></tbody></table></div><p class="houses-muted mt-3">Рейтинг виден только организатору. При равном гонораре агентства делят место. Количество участников не влияет на расчёт.</p>`;
    updateDetail();
  }
  function setHTML(node,html){if(node.dataset.rendered!==html){node.dataset.rendered=html;node.innerHTML=html;}}
  function updateDetail(){
    if(!$('house-timer')||!current)return;
    const h=current.house;
    $('house-timer').innerHTML=`<p><span class="pa-badge ${esc(h.state)}">${esc(statuses[h.state])}</span></p><p class="houses-clock">${h.state==='pending'?(h.duration_seconds?clock(h.duration_seconds):'Без таймера'):h.state==='finished'?'Игра завершена':clock(h.remaining_seconds)}</p>`;
    const controls=[];
    if(h.state==='pending')controls.push(button('start','Начать игру','','primary'));
    if(h.state==='running')controls.push(button('pause','Общая пауза'));
    if(h.state==='paused')controls.push(button('resume','Продолжить игру','','primary'));
    if(h.state!=='finished'&&h.duration_seconds)controls.push(button('add-time','Добавить время'));
    if(['running','paused'].includes(h.state))controls.push(button('finish','Завершить весь дом','','outline-danger'));
    setHTML($('house-controls'),controls.join(''));
    $('house-standings-status').textContent=current.standings_final?'Итоговые места':'Предварительные места';
    document.querySelectorAll('[data-house-action="settings"],[data-house-action="add-team"]').forEach(b=>b.disabled=h.state!=='pending');
    setHTML($('house-teams'),current.teams.length?current.teams.map(t=>`<tr><td>${t.place??'—'}</td><td><strong>${esc(t.name)}</strong></td><td>${esc(t.participants)||'—'}</td><td>${esc(statuses[t.state])}</td><td>${t.fee==null?'—':Number(t.fee).toLocaleString('ru-RU')}</td><td>${t.state!=='finished'?'Игра не завершена':t.review_status==='graded'?'Проверено':'Ожидает проверки'}</td><td>${button('team-link','Ссылка',`data-room="${t.room_id}"`)}${h.state!=='finished'?button('edit-team','Изменить',`data-room="${t.room_id}"`):''}${h.state==='pending'?button('remove-team','Удалить',`data-room="${t.room_id}"`,'outline-danger'):''}${t.state==='finished'?button('review','Проверить',`data-room="${t.room_id}"`):''}</td></tr>`).join(''):'<tr><td colspan="7">Добавьте агентства и задайте им пароли. После этого дом можно запустить.</td></tr>');
  }
  function dialog(title,fields,submitLabel,onSubmit){
    const popup=document.createElement('dialog');popup.className='houses-dialog';
    popup.innerHTML=`<form><h2>${esc(title)}</h2>${fields}<p class="house-error" role="alert" hidden></p><div class="houses-controls"><button type="submit" class="btn btn-primary">${esc(submitLabel)}</button><button type="button" class="btn btn-outline-primary" data-cancel>Отмена</button></div></form>`;
    popup.addEventListener('close',()=>popup.remove());popup.querySelector('[data-cancel]').onclick=()=>popup.close();
    popup.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const form=event.target,submit=form.querySelector('[type=submit]'),error=form.querySelector('[role=alert]');submit.disabled=true;error.hidden=true;
      try{await onSubmit(Object.fromEntries(new FormData(form)),form);popup.close();await load();}
      catch(e){error.textContent=e.message;error.hidden=false;}
      finally{submit.disabled=false;}
    };
    document.body.append(popup);popup.showModal();return popup;
  }
  async function settingsDialog(edit){
    const h=edit?current.house:{duration_seconds:7200,format:'online'},expectedRevision=current?.house.revision;
    const response=await fetch('/api/admin/scenarios',{headers:{Authorization:'Bearer '+localStorage.getItem('token')},signal:AbortSignal.timeout(15000)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось загрузить дела');
    const localDate=h.scheduled_at?new Date(new Date(h.scheduled_at).getTime()-new Date(h.scheduled_at).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
    const popup=dialog(edit?'Настройки дома':'Новый дом',`<div class="houses-fields"><label class="houses-wide">Название игры для участников<input class="form-control" name="name" required maxlength="120" value="${esc(h.name)}" placeholder="Например, Детективный вечер — 1 ноября"></label><label class="houses-wide">Дело<select class="form-select" name="scenario_id" required><option value="">Выберите дело</option>${data.scenarios.map(s=>`<option value="${s.id}" ${Number(s.id)===Number(h.scenario_id)?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label>Длительность, минуты<input class="form-control" name="minutes" type="number" min="16" max="1440" step="1" value="${h.duration_seconds?Math.floor(h.duration_seconds/60):120}"></label><label>Формат<select class="form-select" name="format"><option value="online">Онлайн</option><option value="offline" ${h.format==='offline'?'selected':''}>Очная игра</option></select></label><label>Дата и время<input class="form-control" name="scheduled_at" type="datetime-local" value="${localDate}"></label><label>Место / площадка<input class="form-control" name="venue" maxlength="250" value="${esc(h.venue)}"></label><label class="houses-check"><input name="timer_disabled" type="checkbox" ${h.duration_seconds===0?'checked':''}> Без ограничения времени</label><label class="houses-check houses-wide"><input name="questions_immediate" type="checkbox" ${h.questions_delay_seconds===0?'checked':''}> Вопросы доступны сразу после старта</label><label class="houses-check"><input name="pause_halfway" type="checkbox" ${h.pause_halfway?'checked':''}> Общая пауза на середине</label></div><p class="houses-muted">По умолчанию вопросы открываются через 15 игровых минут. Отметьте доступ сразу, чтобы убрать ожидание, сохранив общий таймер игры. Без ограничения времени вопросы также доступны сразу. Условия гонорара берутся из настроек дела при общем запуске.</p>`,edit?'Сохранить':'Создать дом',async values=>{
      const body={name:values.name,scenario_id:Number(values.scenario_id),duration_seconds:Number(values.minutes)*60,timer_disabled:values.timer_disabled==='on',format:values.format,venue:values.venue,scheduled_at:values.scheduled_at?new Date(values.scheduled_at).toISOString():null,pause_halfway:values.pause_halfway==='on',questions_immediate:values.questions_immediate==='on',...(edit?{revision:expectedRevision}:{})};
      const result=await mutate(edit?'/'+selected:'',body,edit?'PATCH':'POST');if(result?.id)selected=result.id;
    });
    const checkbox=popup.querySelector('[name=timer_disabled]'),minutes=popup.querySelector('[name=minutes]');checkbox.onchange=()=>{minutes.disabled=checkbox.checked;minutes.required=!checkbox.checked;};checkbox.onchange();
  }
  function teamDialog(team){
    const alphabet='abcdefghjkmnpqrstuvwxyz23456789';
    const password=team?'':Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>alphabet[n%alphabet.length]).join('');
    dialog(team?'Изменить агентство':'Новое агентство',`<div class="houses-fields"><label class="houses-wide">Название агентства<input class="form-control" name="name" required maxlength="80" value="${esc(team?.name)}" ${team&&current.house.state!=='pending'?'readonly':''}></label><label>Участники<input class="form-control" name="participants" maxlength="40" value="${esc(team?.participants)}" placeholder="Например, 6 или 4–6"></label><label>${team?'Новый пароль (если нужен)':'Пароль агентства'}<input class="form-control" name="password" type="text" autocomplete="off" ${team?'':'required'} minlength="4" maxlength="72" value="${password}"></label></div><p class="houses-muted">Передайте пароль участникам. Сохранённый пароль не отображается; его можно заменить.</p>`,team?'Сохранить':'Создать агентство',values=>mutate('/'+selected+'/teams'+(team?'/'+team.room_id:''),values,team?'PATCH':'POST'));
  }
  async function copy(path){
    const url=new URL(path,location.origin).href;
    try{await navigator.clipboard.writeText(url);$('house-copy-status').textContent='Ссылка скопирована';}
    catch(_){dialog('Ссылка для игроков',`<label class="d-block">Скопируйте ссылку<input class="form-control mt-2" type="text" readonly value="${esc(url)}"></label><p class="houses-muted">Для входа также понадобится пароль агентства.</p>`,'Готово',async()=>{});}
  }
  async function handle(action,target){
    if(mutating)return;
    const team=current?.teams.find(t=>t.room_id===Number(target.dataset.room));
    if(action==='create')return settingsDialog(false);
    if(action==='settings')return settingsDialog(true);
    if(action==='refresh')return load();
    if(action==='back'){selected=null;current=null;return load();}
    if(action==='open'){selected=target.dataset.id;return load();}
    if(action==='copy')return copy(current.house.invite_path);
    if(action==='team-link')return copy(team.invite_path);
    if(action==='add-team')return teamDialog();
    if(action==='edit-team')return teamDialog(team);
    if(action==='remove-team'){
      const popup=dialog('Удалить агентство?',`<p>Агентство «${esc(team.name)}» будет исключено из дома. Его вход будет закрыт.</p>`,'Удалить агентство',()=>mutate('/'+selected+'/teams/'+team.room_id,{},'DELETE'));
      popup.querySelector('[type=submit]').className='btn btn-danger';return;
    }
    if(action==='review'){const url=new URL(location.href);url.searchParams.set('room',team.room_id);history.replaceState({},'',url);window.switchTab('reviews');window.adminReviews?.open(team.room_id);return;}
    if(action==='add-time'){
      dialog('Добавить время всему дому','<div class="houses-fields"><label>Количество минут<input class="form-control" type="number" name="minutes" min="1" max="240" step="1" value="15" required></label></div>','Добавить время',values=>mutate('/'+selected+'/control',{action:'add_time',minutes:Number(values.minutes)}));return;
    }
    if(action==='start'){
      dialog('Начать игру во всём доме?',`<p>Все агентства (${current.teams.length}) начнут расследование одновременно. Условия дела и гонорара будут закреплены.</p>`,'Начать игру',()=>mutate('/'+selected+'/control',{action:'start'}));return;
    }
    if(action==='finish'){
      const popup=dialog('Завершить весь дом?','<p>Приём ответов у всех агентств будет закрыт. Продолжить завершённую игру нельзя.</p>','Завершить дом',()=>mutate('/'+selected+'/control',{action:'finish',confirmed:true}));
      popup.querySelector('[type=submit]').className='btn btn-danger';return;
    }
    await mutate('/'+selected+'/control',{action,confirmed:action==='finish'});await load();
  }
  window.adminHouses={load};
})();
