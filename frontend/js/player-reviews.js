'use strict';
(async()=>{
 const token=localStorage.getItem('token');if(!token){location.replace('/admin-login');return;}
 const byId=id=>document.getElementById(id),escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const api=async(path,body)=>{const res=await fetch('/api/player/admin/manage/scoring'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(20000)});const data=await res.json();if(!res.ok)throw new Error(data.error||'Не удалось выполнить действие');return data;};
 const message=(id,text)=>{byId(id).textContent=text||'';byId(id).hidden=!text;};
 let selected=null,detailSequence=0,listSequence=0;const pending=new Map();
 function preview(){
  const form=byId('review-detail').querySelector('form');if(!form||!selected)return;
  const values=[...form.querySelectorAll('[data-grade]')].map(el=>el.value===''?null:Number(el.value));const done=values.filter(v=>v!==null).length,points=values.reduce((s,v)=>s+(v||0),0);
  const quality=selected.max_points?points/selected.max_points:0,factor=selected.trips>0?Math.min(1,Math.sqrt(selected.standard_trips/selected.trips)):0;
  const fee=Math.round(selected.max_fee*(Number(selected.formula_version)>=2?quality:quality*quality)*factor);
  form.querySelector('[data-preview]').textContent='Предварительный гонорар: '+fee.toLocaleString('ru-RU');
  form.querySelector('[data-progress]').textContent=`Оценено ${done} из ${values.length} · ${points} из ${selected.max_points} баллов за ответы`;
 }
 async function loadList(){
  const seq=++listSequence;try{const data=await api('/reviews?status='+byId('review-status').value);if(seq!==listSequence)return;
   byId('review-list').innerHTML=data.items.length?data.items.map(r=>`<button class="review-choice" type="button" data-room="${r.room_id}" aria-pressed="${selected?.room.id===r.room_id}"><strong>${escape(r.title)}</strong><small>${escape(r.team_name)} · №${r.room_id}</small><small>${escape(r.owner_name||'Комната организатора')} · поездки: ${r.trips??0}</small><small>${r.review_status==='graded'?'Гонорар: '+Number(r.fee||0).toLocaleString('ru-RU'):'Ожидает проверки'}</small></button>`).join(''):'<p class="muted">Нет комнат с этим статусом.</p>';
  }catch(e){message('review-error',e.message);}
 }
 async function open(id,scroll=true){
  const seq=++detailSequence;message('review-error','');try{const data=await api('/reviews/'+id);if(seq!==detailSequence)return;selected=data;
   byId('review-detail').innerHTML=`<span class="eyebrow">Комната №${data.room.id} · ${data.review_status==='graded'?'Результат опубликован':'Ожидает проверки'}</span><h2>${escape(data.room.title)}</h2><p class="muted">${escape(data.room.name)}${data.room.owner_name?' · '+escape(data.room.owner_name):''}</p><div class="fee-breakdown"><div class="fee-metric"><strong>${data.trips??0}</strong><span>поездок</span></div><div class="fee-metric"><strong>${data.standard_trips}</strong><span>норматив поездок</span></div><div class="fee-metric"><strong>${Number(data.max_fee).toLocaleString('ru-RU')}</strong><span>максимальный гонорар</span></div></div><p class="fee-explanation">Гонорар = максимум × (баллы / ${data.max_points})${Number(data.formula_version)>=2?'':'²'} × min(1, √(норматив / поездки)). При 0 поездок гонорар равен 0. Условия закреплены при создании комнаты.</p>${data.legacy?'<p class="notice">Сохранён результат прежней системы. Публикация оценок пересчитает эту комнату по показанной формуле.</p>':''}<p class="review-help">0 — нет ответа или неверно; 1 — верная деталь; 2 — частично верно; 3 — верный основной вывод; 4 — почти полный ответ; 5 — полный ответ с объяснениями.</p><form data-room="${data.room.id}" data-revision="${data.revision}">${data.questions.map((q,i)=>`<article class="review-question"><h3>${i+1}. ${escape(q.question_text)}</h3><p class="review-criteria"><strong>Критерии:</strong> ${escape(q.criteria||'Оцените правильность вывода и полноту объяснения по шкале 0–5.')}</p><p class="review-answer"><strong>Ответ команды:</strong><br>${escape(q.answer_text||'Ответ не отправлен')}</p><div class="review-controls"><label class="field"><span>Оценка ответа</span><select data-grade data-question="${q.id}" aria-label="Оценка вопроса ${i+1}"><option value="">Не оценён</option>${[0,1,2,3,4,5].map(n=>`<option value="${n}" ${q.grade===n?'selected':''}>${n} из 5</option>`).join('')}</select></label><label class="field"><span>Комментарий игроку</span><textarea data-comment="${q.id}" maxlength="2000" rows="2">${escape(q.comment)}</textarea></label></div></article>`).join('')}<div class="review-preview"><strong data-preview></strong><p class="muted" data-progress></p><label class="field"><span>Причина сохранения</span><textarea name="reason" required minlength="3" maxlength="500" rows="2">Проверка ответов команды</textarea></label><div class="actions"><button class="button secondary" type="submit" value="draft">Сохранить черновик</button><button class="button" type="submit" value="publish">Опубликовать гонорар</button></div><p class="review-help">Черновик не меняет опубликованный результат. Все сохранения и исправления записываются в журнал.</p></div></form>`;
   byId('review-list').querySelectorAll('[data-room]').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.room)===data.room.id)));preview();if(scroll&&innerWidth<850)byId('review-detail').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){message('review-error',e.message);}
 }
 byId('review-list').addEventListener('click',e=>{const btn=e.target.closest('[data-room]');if(btn)open(Number(btn.dataset.room));});
 byId('review-detail').addEventListener('change',preview);byId('review-status').addEventListener('change',loadList);
 byId('review-refresh').addEventListener('click',async()=>{await loadList();if(selected)await open(selected.room.id,false);});
 byId('review-detail').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.target,publish=e.submitter?.value==='publish';message('review-error','');message('review-notice','');
  const fields=[...form.querySelectorAll('[data-grade]')];if(publish&&fields.some(el=>el.value==='')){message('review-error','Перед публикацией оцените все вопросы.');return;}
  const body={publish,revision:Number(form.dataset.revision),reason:form.elements.reason.value,grades:fields.filter(el=>el.value!=='').map(el=>({question_id:Number(el.dataset.question),grade:Number(el.value),comment:form.querySelector('[data-comment="'+el.dataset.question+'"]').value}))};
  const path='/reviews/'+form.dataset.room,signature=path+JSON.stringify(body);if(!pending.has(signature))pending.set(signature,crypto.randomUUID());body.request_key=pending.get(signature);const buttons=[...form.querySelectorAll('[type=submit]')];buttons.forEach(b=>b.disabled=true);
  try{const result=await api(path,body);pending.delete(signature);message('review-notice',publish?'Гонорар опубликован: '+result.calculation.fee.toLocaleString('ru-RU')+'.':'Черновик сохранён. Игрок пока не видит эти изменения.');await open(Number(form.dataset.room),false);await loadList();}catch(error){message('review-error',error.message);}finally{buttons.forEach(b=>b.disabled=false);}
 });
 await loadList();const room=Number(new URLSearchParams(location.search).get('room'));if(Number.isSafeInteger(room)&&room>0)await open(room,false);
})();
