(() => {
  const store=window.gameSession?.storage;
  let room;try{room=JSON.parse(store?.getItem('room')||'null');}catch(_){return;}
  if(!room||window.gameSession.isTest)return;
  let run;try{run=JSON.parse(sessionStorage.getItem('detectum-cabinet-game-'+room.id)||'null');}catch(_){return;}
  if(!run)return;
  document.addEventListener('DOMContentLoaded',()=>{
    const target=document.getElementById('navbarCollapse');if(!target)return;
    const bar=document.createElement('div');bar.className='cabinet-game-controls';
    const link=document.createElement('a');link.href='/profile';link.textContent='Мой кабинет';link.className='btn btn-outline-light btn-sm';bar.append(link);
    const info=document.createElement('span');info.className='cabinet-game-message';bar.append(info);
    async function control(action){const response=await fetch('/api/player/games/'+encodeURIComponent(run.id)+'/control',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action}),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось выполнить действие');return data;}
    if(run.is_owner){
      const pause=document.createElement('button');pause.type='button';pause.className='btn btn-outline-light btn-sm';pause.textContent='Пауза / продолжить';pause.onclick=async()=>{pause.disabled=true;try{const response=await fetch('/api/room/'+room.id+'/state');if(!response.ok)throw new Error('Не удалось проверить состояние игры');const state=(await response.json()).state;if(state==='finished')throw new Error('Игра уже завершена');await control(state==='paused'?'resume':'pause');await window.refreshRoomState?.();info.textContent=state==='paused'?'Игра продолжается':'Игра на паузе';}catch(error){info.textContent=error.message;}finally{pause.disabled=false;}};bar.insertBefore(pause,info);
      const finish=document.createElement('button');finish.type='button';finish.className='btn btn-outline-light btn-sm';finish.textContent='Завершить дело';finish.onclick=async()=>{if(!confirm('Убедитесь, что вы отправили ответы. Завершить расследование?'))return;finish.disabled=true;try{await control('finish');location.href='/profile';}catch(error){info.textContent=error.message;finish.disabled=false;}};bar.insertBefore(finish,info);
    }
    target.append(bar);
    window.logout=()=>{window.gameSession.clear();location.href='/profile';};
  });
})();
