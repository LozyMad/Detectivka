(() => {
  const session=window.gameSession,store=session?.storage;
  let room,access;
  try {room=JSON.parse(store?.getItem('room')||'null');access=JSON.parse(sessionStorage.getItem('detectum-shared-access-'+room?.id)||'null');}catch(_){return;}
  if(!room?.shared)return;
  document.body.classList.add('shared-room');
  const inputs=new Map();let snapshot=null,notesEntry=null,submitting=false,rendering=false,controlling=false;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const request=async(path,body,method)=>{const response=await window.gameNetwork.fetch('/api/game/shared'+path,{method:method||(body?'PATCH':'GET'),headers:{Authorization:'Bearer '+store.getItem('token'),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok){const error=new Error(data.error||'Не удалось сохранить');error.data=data;throw error;}return data;};
  session.onRoomFinished=identity=>{if(identity?.token)sessionStorage.setItem('detectum-room-result',JSON.stringify({token:identity.token,room_id:room.id}));window.gameNetwork.cancelReads();location.replace('/room-result');};
  session.onExpired=()=>{location.href=access?.invite_path||'/profile';};
  function entry(field,revision,status,kind,questionId){
    const item={field,revision:Number(revision),status,kind,questionId,dirty:false,busy:null,timer:null,version:0,conflict:false};
    field.addEventListener('input',()=>{item.dirty=true;item.version++;item.conflict=false;clearTimeout(item.timer);if(status)status.textContent='Сохраняем для команды…';item.timer=setTimeout(()=>save(item),500);});return item;
  }
  async function save(item){
    if(item.busy)return item.busy;if(!item.dirty)return;
    clearTimeout(item.timer);const version=item.version,text=item.field.value;
    item.busy=(async()=>{try{const result=await request(item.kind==='notes'?'/notes':'/draft',{text,revision:item.revision,...(item.questionId?{question_id:item.questionId}:{})});item.revision=result.revision;if(item.version===version)item.dirty=false;if(item.status)item.status.textContent='Сохранено для команды';}
    catch(error){if(error.data?.current){item.revision=Number(error.data.current.revision);item.conflict=true;const status=item.status;if(status){status.textContent='Другой участник изменил текст. ';const button=document.createElement('button');button.type='button';button.textContent='Сохранить мою версию';button.className='btn btn-sm btn-outline-light';button.onclick=()=>{item.conflict=false;save(item);};status.append(button);}}else if(item.status)item.status.textContent=error.message;}
    })().finally(()=>{item.busy=null;if(item.dirty&&!item.conflict&&item.version!==version)item.timer=setTimeout(()=>save(item),100);});return item.busy;
  }
  const originalDisplay=window.displayQuestions;
  async function renderQuestions(){if(rendering)return;rendering=true;try{const state=await request('/state');inputs.clear();window.setQuestionsAccess?.(state.questions_access,state.room.state);if(state.questions_access?.is_open===false){apply(state);window.showQuestionsLock?.();return;}if(state.room.state==='pending'){apply(state);document.getElementById('questionsList').innerHTML='<p class="text-muted">Создатель комнаты ещё не запустил расследование. Пока можно пригласить друзей.</p>';return;}
    originalDisplay(state.questions,room.scenario_id,undefined);
    for(const question of state.questions){const field=document.getElementById('answer_'+question.id);if(!field)continue;field.value=question.answer_text;const status=document.getElementById('draftStatus_'+question.id);inputs.set(Number(question.id),entry(field,question.revision,status,'draft',Number(question.id)));}
    apply(state);
  }catch(error){window.showQuestionsLoadError();}finally{rendering=false;}}
  window.displayQuestions=()=>renderQuestions();
  window.loadSharedQuestions=renderQuestions;
  window.submitAllAnswers=async()=>{
    if(submitting)return;if(!confirm('Отправить ответы и завершить расследование? Изменить ответы после отправки будет нельзя.'))return;submitting=true;const status=document.getElementById('answers_global_status'),button=document.getElementById('submitAllAnswersBtn');if(button)button.disabled=true;
    try{for(const item of inputs.values()){await save(item);if(item.dirty)throw new Error('Сначала сохраните изменения и разрешите конфликты в бланке');}
      await request('/answers',{finish:true,answers:[...inputs.values()].map(item=>({question_id:item.questionId,text:item.field.value,revision:item.revision}))},'POST');session.closeRoom();
    }catch(error){if(status)status.textContent=error.message;}finally{submitting=false;if(button)button.disabled=!!snapshot?.answers_submitted;}
  };
  function apply(state){
    if(state.room.state==='finished'){session.closeRoom();return;}
    const previous=snapshot;snapshot=state;
    window.setQuestionsAccess?.(state.questions_access,state.room.state);
    if(notesEntry){if(!notesEntry.dirty&&!notesEntry.busy){notesEntry.field.value=state.notes;notesEntry.revision=Number(state.notes_revision);}notesEntry.field.disabled=state.room.state==='finished';}
    for(const question of state.questions){const item=inputs.get(Number(question.id));if(!item)continue;if(!item.dirty&&!item.busy){item.field.value=question.answer_text;item.revision=Number(question.revision);if(item.status)item.status.textContent=state.answers_submitted?'Отправлено командой':'Сохранено для команды';}item.field.disabled=state.answers_submitted||state.room.state!=='running';}
    const submit=document.getElementById('submitAllAnswersBtn');if(submit)submit.disabled=submitting||state.answers_submitted||state.room.state!=='running';
    if(state.answers_submitted){window.dismissAnswerDeadlineNotice?.();const status=document.getElementById('answers_global_status');if(status)status.textContent='Все ответы отправлены командой. Создатель может завершить дело досрочно.';}
    window.updateAnswerDraftStatus?.();
    const start=document.getElementById('shared-start'),pause=document.getElementById('shared-pause'),finish=document.getElementById('shared-finish');
    if(start){start.hidden=state.room.state!=='pending';start.disabled=controlling;}if(pause){pause.disabled=controlling;pause.hidden=!['running','paused'].includes(state.room.state);pause.textContent=state.room.state==='paused'?'Продолжить':'Пауза';}if(finish){finish.hidden=state.room.state==='finished';finish.disabled=controlling||!state.can_finish;finish.title=state.can_finish?'Завершить расследование':'Доступно после отправки командных ответов';}
    const message=document.getElementById('shared-status');if(message)message.textContent=state.room.state==='pending'?'Команда собирается. Таймер ещё не запущен.':state.room.state==='paused'?'Пауза. Оставшееся время сохранено.':state.room.state==='finished'?'Дело завершено.':access?.is_owner?'Расследование идёт.':'Общая игра команды';
    if(previous?.room.state==='pending'&&state.room.state!=='pending'&&document.getElementById('questions')?.classList.contains('active'))renderQuestions();
  }
  async function refresh(){try{const state=await request('/state');apply(state);if(document.body.classList.contains('board-open'))await window.investigationBoard?.refresh?.();return true;}catch(_){return false;}}
  let copyToastTimer;
  function setupMobileTimerControls(bar){
    const host=document.getElementById('mobileTimerControls');
    const buttons=['shared-start','shared-pause'].map(id=>document.getElementById(id)).filter(Boolean);
    if(!host||!buttons.length)return;
    // Move the original buttons: state updates and owner-only handlers keep the same IDs.
    const homes=buttons.map(button=>{const marker=document.createComment(button.id);bar.insertBefore(marker,button);return marker;});
    const mobile=window.matchMedia('(max-width: 767.98px)');
    const arrange=()=>buttons.forEach((button,index)=>{
      if(mobile.matches)host.append(button);
      else homes[index].after(button);
    });
    document.body.classList.add('has-mobile-timer-controls');
    arrange();
    mobile.addEventListener('change',arrange);
  }
  function showCopiedToast(){
    const toast=document.getElementById('gameCopyToast');if(!toast)return;
    clearTimeout(copyToastTimer);toast.hidden=false;
    document.getElementById('gameCopyToastMessage').textContent='Ссылка скопирована';
    copyToastTimer=setTimeout(()=>{toast.hidden=true;},4000);
  }
  document.addEventListener('DOMContentLoaded',async()=>{
    const bar=document.createElement('div');bar.className='cabinet-game-controls';
    const invite=document.createElement('button');invite.type='button';invite.className='btn btn-outline-light btn-sm';invite.textContent='Пригласить друзей';invite.onclick=async()=>{const url=new URL(access?.invite_path||'/room',location.origin).href;try{await navigator.clipboard.writeText(url);showCopiedToast();}catch(_){prompt('Скопируйте ссылку для друзей',url);}};bar.append(invite);
    document.getElementById('gameCopyToastClose')?.addEventListener('click',()=>{clearTimeout(copyToastTimer);document.getElementById('gameCopyToast').hidden=true;});
    const control=async action=>{const response=await fetch('/api/player/games/'+encodeURIComponent(access.run_id)+'/control',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,confirmed:action==='finish'}),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось выполнить действие');await refresh();await window.refreshRoomState?.();};
    if(access?.is_owner){for(const [id,label,action]of [['shared-start','Начать расследование','start'],['shared-pause','Пауза','pause'],['shared-finish','Завершить дело','finish']]){const button=document.createElement('button');button.type='button';button.id=id;button.className='btn btn-outline-light btn-sm';button.textContent=label;button.disabled=true;button.hidden=action==='pause';button.onclick=async()=>{const actual=action==='pause'&&snapshot?.room.state==='paused'?'resume':action;if(actual==='finish'&&!confirm('Ответы команды отправлены. Завершить дело и использовать одну попытку?'))return;controlling=true;button.disabled=true;try{await control(actual);if(actual==='finish')location.href='/profile';}catch(error){document.getElementById('shared-status').textContent=error.message;}finally{controlling=false;if(snapshot)apply(snapshot);}};bar.append(button);}}
    const feeInfo=document.createElement('button');feeInfo.type='button';feeInfo.className='btn btn-outline-light btn-sm';feeInfo.textContent='Гонорар';feeInfo.onclick=()=>{const f=snapshot?.scoring;if(!f)return;const popup=document.createElement('dialog');popup.className='shared-result-dialog';popup.innerHTML='<h2>Гонорар за расследование</h2><p>Максимальный гонорар: '+f.max_fee+'.</p><p>Каждый ответ оценивается от 0 до 5. Гонорар зависит от качества ответов и количества поездок.</p><p>Неверные адреса и повторные поездки учитываются. Повторное открытие материалов и страниц интернет-кафе поездкой не считается. Эти условия закреплены при создании комнаты.</p>';const close=document.createElement('button');close.className='btn btn-outline-light';close.textContent='Закрыть';close.onclick=()=>{popup.close();popup.remove();};popup.append(close);document.body.append(popup);popup.showModal();};bar.append(feeInfo);
    const message=document.createElement('span');message.id='shared-status';message.className='cabinet-game-message';bar.append(message);const navbar=document.getElementById('gameNavbar');const actions=document.getElementById('sharedGameActions');(actions||navbar)?.append(bar);if(navbar){const measure=()=>document.body.style.setProperty('--shared-navbar-height',navbar.offsetHeight+'px');measure();new ResizeObserver(measure).observe(navbar);}
    setupMobileTimerControls(bar);
    const heading=document.getElementById('playerNotesTitle');if(heading)heading.textContent='Общие заметки команды';const label=document.querySelector('label[for=playerNotesText]');if(label)label.textContent='Общие заметки команды';
    const notes=document.getElementById('playerNotesText');if(notes){notes.placeholder='Общие заметки команды…';notesEntry=entry(notes,0,document.getElementById('playerNotesStatus'),'notes');}
    await refresh();if(document.getElementById('shared-start'))document.getElementById('shared-start').disabled=false;
    const poll=window.gameNetwork.poll(refresh,3000);const update=()=>{if(!document.hidden&&window.gameNetwork.isAvailable()&&!session.expired)poll.start();else poll.stop();};document.addEventListener('visibilitychange',update);window.addEventListener('online',update);window.addEventListener('offline',update);window.addEventListener('focus',update);window.addEventListener('detectum:network-restored',update);window.addEventListener('pagehide',()=>poll.stop());window.addEventListener('pageshow',update);update();
    window.logout=()=>{session.clear();location.href=access?.is_owner?'/profile':'/';};
  });
})();
