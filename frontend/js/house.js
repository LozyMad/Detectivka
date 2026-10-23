(() => {
  'use strict';
  const byId=id=>document.getElementById(id);
  const publicId=location.pathname.split('/')[2];
  const base='/api/houses/public/'+encodeURIComponent(publicId||'');
  const states={pending:'Игра начнётся по команде организатора.',running:'',paused:'В игре объявлена пауза.',finished:'Игра завершена. Войдите в агентство, чтобы посмотреть свой гонорар.'};
  let busy=false;
  const error=message=>{byId('house-error').textContent=message;byId('house-error').hidden=!message;};
  async function request(path,body){
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось загрузить игру');return data;
  }
  async function load(){
    if(busy)return;
    busy=true;byId('house-reload').hidden=true;
    try{
      const data=await request(''),house=data.house,select=byId('house-team');
      byId('house-name').textContent=house.name;document.title=house.name+' — Детектум';
      byId('house-case').textContent=house.scenario_name;
      byId('house-state').textContent=states[house.state]||'';
      byId('house-state').hidden=!states[house.state];
      const previous=select.value||new URLSearchParams(location.search).get('team');
      select.replaceChildren(new Option('Выберите своё агентство',''));
      for(const team of data.teams)select.add(new Option(team.name,team.room_id));
      if(data.teams.some(t=>String(t.room_id)===previous))select.value=previous;
      byId('house-login').hidden=!data.teams.length;
      if(!data.teams.length){byId('house-state').textContent='Организатор ещё готовит агентства. Откройте ссылку позднее.';byId('house-state').hidden=false;}
      error('');
    }catch(e){error(e.name==='TimeoutError'?'Сайт не ответил вовремя. Попробуйте снова.':e.message);byId('house-reload').hidden=false;}
    finally{busy=false;}
  }
  byId('house-reload').onclick=load;
  byId('house-login').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;byId('house-enter').disabled=true;error('');
    try{
      const data=await request('/join',{room_id:Number(byId('house-team').value),password:byId('house-password').value});
      byId('house-password').value='';
      if(data.finished){sessionStorage.setItem('detectum-room-result',JSON.stringify({token:data.token,room_id:data.room.id}));location.href='/room-result';}
      else{window.gameSession.saveLogin(data);location.href='/game';}
    }catch(e){error(e.name==='TimeoutError'?'Не удалось войти вовремя. Попробуйте снова.':e.message);}
    finally{busy=false;byId('house-enter').disabled=false;}
  });
  load();
})();
