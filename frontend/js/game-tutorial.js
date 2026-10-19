(() => {
    'use strict';
    const storageKey = 'detectum-game-tutorial-v1';
    const steps = [
        {title:'Добро пожаловать в Детектум', pane:'game', text:'Вы — частные детективы. Вам предстоит перемещаться по городу, искать улики, разговаривать со свидетелями и сопоставлять факты.\n\nВаша цель — правильно ответить на наибольшее число вопросов, совершив как можно меньше поездок.\n\nЗа пару минут покажем основные инструменты. На любом шаге обучение можно пропустить.'},
        {title:'Начните с брифинга', pane:'game', narrowPane:'applications', target:'receivedApplicationsPanel', fullPanel:true, text:'Начните с брифинга: в нём — обстоятельства дела, имена и первые зацепки. Здесь же собраны начальные материалы, а по мере расследования появятся новые газеты, фотографии и документы. Открывайте их повторно и сопоставляйте детали — это не расходует поездки.'},
        {title:'Найдите человека или организацию', pane:'addressbook', target:'addressbook-tab', text:'Кнопка «Адреса» открывает адресную книгу — ваш справочник по городу. Здесь собраны частные лица и предприятия. Выбирайте разделы или ищите нужное имя и название.'},
        {title:'Поиск приведёт к адресу', pane:'addressbook', target:'playerAddressBookSearch', text:'Введите имя, название или адрес. Нажатие на найденную запись подставит район, дом и квартиру в форму поездки. Сам выбор адреса ещё не считается поездкой.'},
        {title:'Отправляйтесь по зацепке', pane:'game', target:'locationSearchPanel', secondaryTarget:'game-tab', fullPanel:true, text:'Во вкладке «Журнал» укажите район, номер дома и, если нужно, квартиру или офис. Кнопка «Поехать» отправляет команду по адресу. Сначала обсудите цель: неверные адреса и повторные поездки тоже учитываются при расчёте гонорара.'},
        {title:'Возвращайтесь к прочитанному', pane:'game', target:'tripHistory', secondaryTarget:'game-tab', fullPanel:true, text:'Журнал хранит результаты поездок, разговоры и найденные зацепки. Новые записи появляются сверху. Используйте поиск по истории: перечитать сцену можно без новой поездки.'},
        {title:'Собирайте связи на доске', pane:'board', target:'boardCreate', secondaryTarget:'board-tab', text:'Добавляйте стикеры с уликами и своими версиями, перетаскивайте их и соединяйте нитями. В журнале также есть заметки с автосохранением.'},
        {title:'Следите за временем', pane:'game', target:'playerNavStats', text:'Таймер показывает оставшееся время, рядом — число поездок. Создатель общей комнаты запускает расследование и управляет паузой. Пройдите тур обучения до начала игры.'},
        {title:'Формулируйте версии в «Вопросах»', pane:'questions', target:'questions-tab', text:'Бланк ответов откроется через 15 минут после начала дела. Конечная цель игры — правильно ответить на наибольшее число вопросов. Пишите подробно и опирайтесь на найденные доказательства.'},
        {title:'Обязательно отправьте ответы', pane:'questions', target:'submitAllAnswersBtn', fallbackTarget:'questions-tab', watchTarget:'questionsList', text:'Черновик и отправка — разные действия. До конца времени нажмите «Отправить все ответы». Без отправленных ответов команда получит ноль очков. После отправки создатель может завершить дело досрочно; ответы проверяет организатор.'},
        {title:'Всё готово к расследованию', pane:'game', text:'Начните с брифинга, найдите первый адрес и обсудите следующую поездку. Кнопка «Обучение» в меню игры позволит пройти этот тур снова. Удачного расследования!'}
    ];
    let dialog,card,spotlight,secondarySpotlight,targetObserver,index=0,frame=0,origin=null,active=false;
    const byId=id=>id?document.getElementById(id):null;
    const read=()=>{try{return JSON.parse(localStorage.getItem(storageKey)||'null');}catch(_){return null;}};
    const remember=status=>{try{localStorage.setItem(storageKey,JSON.stringify({status,step:index,total:steps.length}));}catch(_){}};
    const visible=element=>element?.getClientRects().length>0;
    const currentTarget=()=>{const step=steps[index],target=byId(step.target);return visible(target)?target:byId(step.fallbackTarget);};
    const navigationTarget=target=>target?.id?.endsWith('-tab')||target?.closest?.('#playerNavTabs');
    const viewport=()=>{
        const view=window.visualViewport,left=view?.offsetLeft||0,top=view?.offsetTop||0;
        const width=view?.width||window.innerWidth,height=view?.height||window.innerHeight;
        const css=dialog&&window.getComputedStyle?.(dialog);
        const inset=side=>parseFloat(css?.[side])||0;
        const safeLeft=inset('paddingLeft'),safeRight=inset('paddingRight'),safeTop=inset('paddingTop'),safeBottom=inset('paddingBottom');
        return {left:left+safeLeft,top:top+safeTop,width:width-safeLeft-safeRight,height:height-safeTop-safeBottom,right:left+width-safeRight,bottom:top+height-safeBottom};
    };
    function targetRect(target){
        const view=viewport();
        const rect=visible(target)?target.getBoundingClientRect():null;
        if(!rect||rect.bottom<=view.top||rect.top>=view.bottom||rect.right<=view.left||rect.left>=view.right)return null;
        return {left:Math.max(view.left+6,rect.left-6),top:Math.max(view.top+6,rect.top-6),right:Math.min(view.right-6,rect.right+6),bottom:Math.min(view.bottom-6,rect.bottom+6)};
    }
    function placeSpotlight(outline,hole,rect){
        outline.hidden=!rect;
        const width=rect?Math.max(0,rect.right-rect.left):0,height=rect?Math.max(0,rect.bottom-rect.top):0;
        if(rect)Object.assign(outline.style,{left:rect.left+'px',top:rect.top+'px',width:width+'px',height:height+'px'});
        hole.setAttribute('x',rect?.left||0);hole.setAttribute('y',rect?.top||0);
        hole.setAttribute('width',width);hole.setAttribute('height',height);
    }
    function position() {
        if(!active)return;
        const view=viewport(),{width,height}=view,gap=16,pad=12;
        const target=currentTarget(),extra=byId(steps[index].secondaryTarget);
        let primary=targetRect(target),secondary=targetRect(extra);
        const r=primary||secondary;
        const mobile=width<900||height<=500,landscape=mobile&&width>=600&&width>height;
        dialog.classList.toggle('is-mobile',mobile);
        if(mobile){
            const nav=targetRect(byId('playerBottomNav'));
            const bottomTarget=[nav, navigationTarget(target)&&primary, navigationTarget(extra)&&secondary].find(rect=>rect&&rect.top>view.top+height*.6);
            const bottom=bottomTarget?bottomTarget.top-10:view.bottom-pad;
            const available=Math.max(160,bottom-view.top-pad);
            card.style.width=(landscape?Math.min(400,Math.round(width*.48)):width-pad*2)+'px';
            card.style.maxHeight=available+'px';
            // Keep controls in one place; only the description scrolls on small screens.
            card.style.height=r?(landscape?available:Math.min(360,Math.round(height*.54),Math.max(180,available-100)))+'px':'';
            const cw=card.offsetWidth,ch=card.offsetHeight;
            const rightSide=!r||(r.left+r.right)/2<view.left+width/2;
            const left=landscape&&r?(rightSide?view.right-cw-pad:view.left+pad):view.left+(width-cw)/2;
            const top=r?(landscape?view.top+pad:bottom-ch):view.top+(bottom-view.top-ch)/2;
            Object.assign(card.style,{transform:'none',left:left+'px',top:Math.max(view.top+pad,top)+'px'});
            // A tall panel may continue behind the sheet. Light only its visible part,
            // while keeping the separately highlighted bottom navigation unobstructed.
            const clip=(rect,element)=>{
                if(!rect||navigationTarget(element))return rect;
                const clipped={...rect};
                if(landscape){if(rightSide)clipped.right=Math.min(clipped.right,left-gap);else clipped.left=Math.max(clipped.left,left+cw+gap);}
                else clipped.bottom=Math.min(clipped.bottom,top-gap);
                return clipped.right>clipped.left&&clipped.bottom>clipped.top?clipped:null;
            };
            primary=clip(primary,target);secondary=clip(secondary,extra);
        }else{
            card.style.width='';card.style.height='';
            if(r&&steps[index].secondaryTarget&&width>=900){
                const rightSpace=width-r.right-gap-pad,leftSpace=r.left-gap-pad;
                if(rightSpace>=300&&rightSpace<card.offsetWidth)card.style.width=rightSpace+'px';
                else if(rightSpace<300&&leftSpace>=300&&leftSpace<card.offsetWidth)card.style.width=leftSpace+'px';
            }
            card.style.maxHeight=(height-pad*2)+'px';
            const cw=card.offsetWidth,ch=card.offsetHeight;
            let left=view.left+(width-cw)/2,top=view.top+(height-ch)/2;
            if(r){
                if(view.right-r.right>=cw+gap+pad){left=r.right+gap;top=r.top;}
                else if(r.left-view.left>=cw+gap+pad){left=r.left-cw-gap;top=r.top;}
                else if(view.bottom-r.bottom>=ch+gap+pad){top=r.bottom+gap;}
                else if(r.top-view.top>=ch+gap+pad){top=r.top-ch-gap;}
                else top=view.bottom-ch-pad;
            }
            Object.assign(card.style,{transform:'none',left:Math.max(view.left+pad,Math.min(left,view.right-cw-pad))+'px',top:Math.max(view.top+pad,Math.min(top,view.bottom-pad-ch))+'px'});
        }
        dialog.classList.toggle('has-spotlight',!!(primary||secondary));
        placeSpotlight(spotlight,byId('gameTutorialHole'),primary);
        placeSpotlight(secondarySpotlight,byId('gameTutorialSecondaryHole'),secondary);
    }
    function schedulePosition(){if(!active||frame)return;frame=requestAnimationFrame(()=>{frame=0;position();});}
    function revealTarget(){
        const target=currentTarget();
        if(!visible(target))return;
        if(navigationTarget(target))return;
        // Native modal content is inert in some browsers, which blocks scrolling it into view.
        // Release and restore the modal synchronously, before the next paint.
        const wasOpen=dialog.open,focus=document.activeElement;
        if(wasOpen)dialog.close();
        target.scrollIntoView({block:window.innerWidth<900?'start':'center',inline:'nearest',behavior:'instant'});
        if(window.innerWidth<900)window.scrollBy({top:-12,behavior:'instant'});
        if(wasOpen){dialog.showModal();focus?.focus({preventScroll:true});}
    }
    function render() {
        const step=steps[index];
        const narrow=window.innerWidth<768||(window.innerWidth<=950&&window.innerHeight<=500);
        window.gameTutorialNavigation?.open(narrow&&step.narrowPane?step.narrowPane:step.pane);
        byId('gameTutorialTitle').textContent=step.title;
        byId('gameTutorialText').textContent=step.text;
        byId('gameTutorialCounter').textContent=`Шаг ${index+1} из ${steps.length}`;
        byId('gameTutorialProgress').innerHTML=steps.map((_,i)=>`<span${i<=index?' class="passed"':''}></span>`).join('');
        byId('gameTutorialBack').disabled=index===0;
        byId('gameTutorialNext').textContent=index===steps.length-1?'К расследованию':'Далее →';
        byId('gameTutorialBody').scrollTop=0;
        remember('active');
        byId('gameTutorialTitle').focus({preventScroll:true});
        const target=currentTarget();
        targetObserver.disconnect();
        if(target)targetObserver.observe(target);
        const secondary=byId(step.secondaryTarget);
        if(secondary)targetObserver.observe(secondary);
        const watched=byId(step.watchTarget);
        if(watched)targetObserver.observe(watched);
        revealTarget();
        position();schedulePosition();
    }
    function start(resume=false) {
        if(active||window.gameSession?.expired)return;
        origin={pane:window.gameTutorialNavigation?.current()||'game',x:window.scrollX,y:window.scrollY,focus:document.activeElement};
        const saved=resume?read():null;
        let resumeIndex=saved?.status==='active'&&Number.isInteger(saved.step)?saved.step:0;
        // In the previous 12-step tour, the materials step (index 6) is now part of the briefing.
        if(saved?.status==='active'&&(saved.total===undefined||saved.total===12)&&resumeIndex>=6)resumeIndex=resumeIndex===6?1:resumeIndex-1;
        index=Math.max(0,Math.min(steps.length-1,resumeIndex));
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
        dialog=byId('gameTutorial');card=byId('gameTutorialCard');spotlight=byId('gameTutorialSpotlight');secondarySpotlight=byId('gameTutorialSecondarySpotlight');
        if(!dialog||!card||!spotlight||!secondarySpotlight)return;
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
        const reposition=()=>{if(active)revealTarget();schedulePosition();};
        window.addEventListener('resize',()=>{if(active&&steps[index].narrowPane)render();else reposition();});
        window.visualViewport?.addEventListener('resize',reposition);
        window.visualViewport?.addEventListener('scroll',schedulePosition);
        document.addEventListener('scroll',schedulePosition,true);
        new ResizeObserver(schedulePosition).observe(card);
        // Stored locally, never shared with teammates; skipping on one device does not dismiss their tour.
        const saved=read();
        if(!['completed','skipped'].includes(saved?.status)&&!window.gameSession?.isTest&&window.gameSession?.storage.getItem('token')){
            requestAnimationFrame(()=>start(true));
        }
    });
})();
