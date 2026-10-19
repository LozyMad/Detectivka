(() => {
    'use strict';
    const storageKey = 'detectum-game-tutorial-v1';
    const steps = [
        {title:'Добро пожаловать в Детектум', pane:'game', text:'Вы — частные детективы. Читайте материалы, обсуждайте версии и восстанавливайте события по уликам. За пару минут покажем основные инструменты. На любом шаге обучение можно пропустить.'},
        {title:'Начните с вводной', pane:'applications', target:'receivedApplicationsList', text:'Откройте брифинг и начальные материалы дела. В них — обстоятельства происшествия, имена и первые зацепки. Запишите, кого хотите найти и о чём спросить. Документы открывайте уже после обучения.'},
        {title:'Найдите человека или организацию', pane:'addressbook', target:'addressbook-tab', text:'Кнопка «Адреса» открывает адресную книгу — ваш справочник по городу. Здесь собраны частные лица и предприятия. Выбирайте разделы или ищите нужное имя и название.'},
        {title:'Поиск приведёт к адресу', pane:'addressbook', target:'playerAddressBookSearch', text:'Введите имя, название или адрес. Нажатие на найденную запись подставит район, дом и квартиру в форму поездки. Сам выбор адреса ещё не считается поездкой.'},
        {title:'Отправляйтесь по зацепке', pane:'game', target:'game-tab', text:'Во вкладке «Журнал» укажите район, номер дома и, если нужно, квартиру или офис. Кнопка «Поехать» отправляет команду по адресу. Сначала обсудите цель: неверные адреса и повторные поездки тоже учитываются при расчёте гонорара.'},
        {title:'Возвращайтесь к прочитанному', pane:'game', target:'tripHistoryTitle', text:'Журнал хранит результаты поездок, разговоры и найденные зацепки. Новые записи появляются сверху. Используйте поиск по истории: перечитать сцену можно без новой поездки.'},
        {title:'Изучайте материалы дела', pane:'applications', target:'applications', fullPanel:true, text:'Газеты, фотографии и документы собираются здесь по мере расследования. Открывайте их повторно, сопоставляйте даты, имена и детали. Повторное открытие материалов не расходует поездки.'},
        {title:'Собирайте связи на доске', pane:'board', target:'boardCreate', text:'Добавляйте стикеры с уликами и своими версиями, перетаскивайте их и соединяйте нитями. В журнале также есть заметки с автосохранением. В общей комнате доска и заметки доступны всей команде.'},
        {title:'Следите за временем', pane:'game', target:'playerNavStats', text:'Таймер показывает оставшееся время, рядом — число поездок. Создатель общей комнаты запускает расследование и управляет паузой. Пройдите тур обучения до начала игры.'},
        {title:'Формулируйте версии в «Вопросах»', pane:'questions', target:'questions-tab', text:'Здесь находится бланк ответов. Пишите подробно и опирайтесь на найденные доказательства. В общей комнате черновики сохраняются для команды. Если создатель задал задержку открытия, вкладка покажет, сколько ещё ждать.'},
        {title:'Обязательно отправьте ответы', pane:'questions', target:'questionsList', text:'Черновик и отправка — разные действия. До конца времени нажмите «Отправить все ответы». Без отправленных ответов команда получит ноль очков. После отправки создатель может завершить дело досрочно; ответы проверяет организатор.'},
        {title:'Всё готово к расследованию', pane:'game', text:'Начните с брифинга, найдите первый адрес и обсудите следующую поездку. Кнопка «Обучение» в меню игры позволит пройти этот тур снова. Удачного расследования!'}
    ];
    let dialog,card,spotlight,targetObserver,index=0,frame=0,origin=null,active=false;
    const byId=id=>id?document.getElementById(id):null;
    const read=()=>{try{return JSON.parse(localStorage.getItem(storageKey)||'null');}catch(_){return null;}};
    const remember=status=>{try{localStorage.setItem(storageKey,JSON.stringify({status,step:index}));}catch(_){}};
    const visible=element=>element?.getClientRects().length>0;
    function position() {
        if(!active)return;
        const target=byId(steps[index].target);
        const width=window.innerWidth,height=window.innerHeight,gap=16,pad=12;
        const rect=visible(target)?target.getBoundingClientRect():null;
        const r=rect&&rect.bottom>0&&rect.top<height&&rect.right>0&&rect.left<width?{
            left:Math.max(6,rect.left-6),top:Math.max(6,rect.top-6),
            right:Math.min(width-6,rect.right+6),bottom:Math.min(height-6,rect.bottom+6,width<900&&!steps[index].fullPanel?Math.max(6,rect.top-6)+80:Infinity)
        }:null;
        dialog.classList.toggle('has-spotlight',!!r);
        spotlight.hidden=!r;
        if(r)Object.assign(spotlight.style,{left:r.left+'px',top:r.top+'px',width:Math.max(0,r.right-r.left)+'px',height:Math.max(0,r.bottom-r.top)+'px'});
        // Desktop: prefer a free side of the target. Phones: use the space below or above it.
        card.style.maxHeight=(height-24)+'px';
        const mobileAbove=r&&width<900&&r.top>height-r.bottom;
        if(r&&width<900)card.style.maxHeight=Math.max(180,(mobileAbove?r.top:height-r.bottom)-gap-pad)+'px';
        const cw=card.offsetWidth,ch=card.offsetHeight;
        let left=(width-cw)/2,top=(height-ch)/2;
        if(r){
            if(width<900){top=mobileAbove?r.top-ch-gap:r.bottom+gap;}
            else if(width-r.right>=cw+gap+pad){left=r.right+gap;top=r.top;}
            else if(width>=900&&r.left>=cw+gap+pad){left=r.left-cw-gap;top=r.top;}
            else if(height-r.bottom>=ch+gap+pad){top=r.bottom+gap;}
            else if(r.top>=ch+gap+pad){top=r.top-ch-gap;}
            else top=height-ch-pad;
        }
        Object.assign(card.style,{transform:'none',left:Math.max(pad,Math.min(left,width-cw-pad))+'px',top:Math.max(pad,Math.min(top,height-ch-pad))+'px'});
    }
    function schedulePosition(){if(!active||frame)return;frame=requestAnimationFrame(()=>{frame=0;position();});}
    function revealTarget(){
        const target=byId(steps[index].target);
        if(!visible(target))return;
        if(target.closest?.('#playerNavTabs'))return;
        // Native modal content is inert in some browsers, which blocks scrolling it into view.
        // Release and restore the modal synchronously, before the next paint.
        const wasOpen=dialog.open,focus=document.activeElement;
        if(wasOpen)dialog.close();
        target.scrollIntoView({block:window.innerWidth<900?'start':'center',inline:'nearest',behavior:'instant'});
        if(window.innerWidth<900)window.scrollBy({top:-Math.min(120,window.innerHeight*.18),behavior:'instant'});
        if(wasOpen){dialog.showModal();focus?.focus({preventScroll:true});}
    }
    function render() {
        const step=steps[index];
        window.gameTutorialNavigation?.open(step.pane);
        byId('gameTutorialTitle').textContent=step.title;
        byId('gameTutorialText').textContent=step.text;
        byId('gameTutorialCounter').textContent=`Шаг ${index+1} из ${steps.length}`;
        byId('gameTutorialProgress').innerHTML=steps.map((_,i)=>`<span${i<=index?' class="passed"':''}></span>`).join('');
        byId('gameTutorialBack').disabled=index===0;
        byId('gameTutorialNext').textContent=index===steps.length-1?'К расследованию':'Далее →';
        card.scrollTop=0;
        remember('active');
        byId('gameTutorialTitle').focus({preventScroll:true});
        const target=byId(step.target);
        targetObserver.disconnect();
        if(target)targetObserver.observe(target);
        revealTarget();
        position();schedulePosition();
    }
    function start(resume=false) {
        if(active||window.gameSession?.expired)return;
        origin={pane:window.gameTutorialNavigation?.current()||'game',x:window.scrollX,y:window.scrollY,focus:document.activeElement};
        const saved=resume?read():null;
        index=saved?.status==='active'&&Number.isInteger(saved.step)?Math.max(0,Math.min(steps.length-1,saved.step)):0;
        active=true;document.body.classList.add('game-tutorial-running');dialog.showModal();render();
    }
    function finish(status) {
        if(!active)return;
        active=false;remember(status);cancelAnimationFrame(frame);frame=0;targetObserver.disconnect();
        dialog.close();
        document.body.classList.remove('game-tutorial-running');
        window.gameTutorialNavigation?.open(origin?.pane||'game');
        window.scrollTo({left:origin?.x||0,top:origin?.y||0,behavior:'instant'});
        const focus=[origin?.focus,byId('gameTutorialLaunch'),byId(`${origin?.pane||'game'}-tab`)].find(visible);
        if(visible(focus))focus.focus({preventScroll:true});
    }
    function move(amount) {
        if(!active)return;
        if(amount>0&&index===steps.length-1){finish('completed');return;}
        index=Math.max(0,Math.min(steps.length-1,index+amount));render();
    }
    document.addEventListener('DOMContentLoaded',()=>{
        dialog=byId('gameTutorial');card=byId('gameTutorialCard');spotlight=byId('gameTutorialSpotlight');
        if(!dialog||!card||!spotlight)return;
        targetObserver=new ResizeObserver(()=>{if(active){revealTarget();schedulePosition();}});
        byId('gameTutorialLaunch')?.addEventListener('click',()=>start());
        byId('gameTutorialSkip').addEventListener('click',()=>finish('skipped'));
        byId('gameTutorialClose').addEventListener('click',()=>finish('skipped'));
        byId('gameTutorialBack').addEventListener('click',()=>move(-1));
        byId('gameTutorialNext').addEventListener('click',()=>move(1));
        dialog.addEventListener('cancel',event=>{event.preventDefault();finish('skipped');});
        dialog.addEventListener('keydown',event=>{
            if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
            if(event.key==='ArrowRight'){event.preventDefault();move(1);}
            if(event.key==='ArrowLeft'){event.preventDefault();move(-1);}
        });
        window.addEventListener('resize',schedulePosition);
        window.visualViewport?.addEventListener('resize',schedulePosition);
        document.addEventListener('scroll',schedulePosition,true);
        new ResizeObserver(schedulePosition).observe(card);
        // Stored locally, never shared with teammates; skipping on one device does not dismiss their tour.
        const saved=read();
        if(!['completed','skipped'].includes(saved?.status)&&!window.gameSession?.isTest&&window.gameSession?.storage.getItem('token')){
            requestAnimationFrame(()=>start(true));
        }
    });
})();
