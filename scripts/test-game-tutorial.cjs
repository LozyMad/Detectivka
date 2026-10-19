const test=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./test-helpers/browser-runtime.cjs');

function tour({saved,width=1280,height=900,isTest=false,blockedStorage=false}={}){
 const b=browser(),elements=new Map(),opened=[];
 const ids=['gameTutorial','gameTutorialCard','gameTutorialBody','gameTutorialSpotlight','gameTutorialSecondarySpotlight','gameTutorialHole','gameTutorialSecondaryHole','gameTutorialTitle','gameTutorialText','gameTutorialCounter','gameTutorialProgress','gameTutorialBack','gameTutorialNext','gameTutorialSkip','gameTutorialClose','gameTutorialLaunch','receivedApplicationsPanel','receivedApplicationsList','applications','addressbook-tab','playerAddressBookSearch','game-tab','locationSearchPanel','locationSearchTitle','tripHistory','tripHistoryTitle','boardCreate','board-tab','playerNavStats','playerBottomNav','questions-tab','questionsList','submitAllAnswersBtn'];
 for(const id of ids){
  const el=b.element(id);elements.set(id,el);el.hidden=false;el.offsetWidth=Math.min(400,width-24);el.offsetHeight=Math.min(430,height-24);
  el.click=()=>el.emit('click');el.getClientRects=()=>el.hidden?[]:[{}];
  el.getBoundingClientRect=()=>({left:24,top:60,right:Math.min(380,width-24),bottom:100});
  el.scrollIntoView=()=>{};el.focus=()=>{b.document.activeElement=el;};
  const attributes=new Map();el.setAttribute=(key,value)=>attributes.set(key,String(value));el.getAttribute=key=>attributes.get(key);
  el.classList.toggle=(name,value)=>value?el.classList.add(name):el.classList.remove(name);
 }
 b.document.getElementById=id=>elements.get(id)||null;
 const card=elements.get('gameTutorialCard');
 Object.defineProperty(card,'offsetWidth',{get:()=>parseFloat(card.style.width)||Math.min(400,b.window.innerWidth-24)});
 Object.defineProperty(card,'offsetHeight',{get:()=>Math.min(parseFloat(card.style.height)||430,parseFloat(card.style.maxHeight)||Infinity)});
 const dialog=elements.get('gameTutorial');dialog.open=false;dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
 const store=b.sandbox.localStorage;if(saved)store.setItem('detectum-game-tutorial-v1',JSON.stringify(saved));
 b.sandbox.window.innerWidth=width;b.sandbox.window.innerHeight=height;
 Object.assign(b.window,{scrollX:0,scrollY:140,scrollTo:options=>{b.window.lastScroll=options;},scrollBy(){},gameSession:{isTest,storage:store},gameTutorialNavigation:{current:()=>opened.at(-1)||'game',open:pane=>opened.push(pane)}});
 b.document.activeElement=elements.get('gameTutorialLaunch');
 const observers=[];
 b.sandbox.ResizeObserver=class{constructor(callback){this.callback=callback;this.targets=new Set();observers.push(this);}observe(el){this.targets.add(el);}disconnect(){this.targets.clear();}};
 if(blockedStorage)b.sandbox.localStorage={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
 b.load('frontend/js/game-tutorial.js');b.document.emit('DOMContentLoaded');
 return {...b,dialog,opened,get:id=>elements.get(id),click:id=>elements.get(id).click(),resize:id=>observers.filter(o=>o.targets.has(elements.get(id))).forEach(o=>o.callback()),saved:()=>JSON.parse(store.getItem('detectum-game-tutorial-v1'))};
}

test('send step highlights the questions tab while locked and follows the real submit button when it appears',async()=>{
 const b=tour({width:390,height:844,saved:{status:'active',step:9,total:11}});
 b.get('submitAllAnswersBtn').hidden=true;
 b.get('questions-tab').getBoundingClientRect=()=>({left:90,top:780,right:150,bottom:830});
 b.get('submitAllAnswersBtn').getBoundingClientRect=()=>({left:30,top:100,right:350,bottom:145});
 await b.clock.advance(0);
 assert.equal(b.get('gameTutorialHole').getAttribute('x'),'84');
 assert.ok(parseFloat(b.get('gameTutorialCard').style.top)+b.get('gameTutorialCard').offsetHeight<780);
 b.get('submitAllAnswersBtn').hidden=false;b.resize('questionsList');await b.clock.advance(0);
 assert.equal(b.get('gameTutorialHole').getAttribute('x'),'24');
 assert.equal(b.get('gameTutorialHole').getAttribute('height'),'57');
 assert.equal(b.calls.length,0);
});

test('phone sheet stays above bottom navigation, leaves a visible target and resets only its reading area',async()=>{
 const b=tour({width:390,height:740,saved:{status:'active',step:4,total:11}});
 b.get('playerBottomNav').getBoundingClientRect=()=>({left:0,top:666,right:390,bottom:740});
 b.get('game-tab').getBoundingClientRect=()=>({left:0,top:672,right:78,bottom:734});
 b.get('locationSearchPanel').getBoundingClientRect=()=>({left:20,top:12,right:370,bottom:530});
 await b.clock.advance(0);
 const card=b.get('gameTutorialCard'),top=parseFloat(card.style.top);
 assert.ok(top+card.offsetHeight<666);
 assert.ok(Number(b.get('gameTutorialHole').getAttribute('height'))>80);
 assert.ok(Number(b.get('gameTutorialHole').getAttribute('y'))+Number(b.get('gameTutorialHole').getAttribute('height'))<top);
 assert.equal(b.get('gameTutorialSecondarySpotlight').hidden,false);
 b.get('gameTutorialBody').scrollTop=90;b.click('gameTutorialNext');
 assert.equal(card.style.top,top+'px');assert.equal(b.get('gameTutorialBody').scrollTop,0);
 assert.equal(b.calls.length,0);
});

test('mobile placement respects the visible viewport when browser chrome changes its size and offset',async()=>{
 const b=tour({width:390,height:844,saved:{status:'active',step:9,total:11}});
 b.window.visualViewport={width:390,height:600,offsetLeft:0,offsetTop:40};
 b.window.getComputedStyle=()=>({paddingLeft:'20px',paddingRight:'10px',paddingTop:'18px',paddingBottom:'12px'});
 b.get('submitAllAnswersBtn').hidden=true;
 b.get('questions-tab').getBoundingClientRect=()=>({left:78,top:760,right:156,bottom:830});
 await b.clock.advance(0);
 const card=b.get('gameTutorialCard');
 assert.ok(parseFloat(card.style.left)>=32);
 assert.ok(parseFloat(card.style.top)>=70);
 assert.ok(parseFloat(card.style.top)+card.offsetHeight<=616);
 assert.equal(b.get('gameTutorialSpotlight').hidden,true);
});

test('first game entry starts the tour; skip closes it and prevents another automatic tour',async()=>{
 const b=tour();await b.clock.advance(0);assert.equal(b.dialog.open,true);assert.equal(b.get('gameTutorialCounter').textContent,'Шаг 1 из 11');
 b.click('gameTutorialNext');b.click('gameTutorialSkip');
 assert.equal(b.dialog.open,false);assert.equal(b.saved().status,'skipped');assert.equal(b.opened.at(-1),'game');assert.equal(b.window.lastScroll.top,140);
 const next=tour({saved:b.saved()});await next.clock.advance(0);assert.equal(next.dialog.open,false);
 next.click('gameTutorialLaunch');assert.equal(next.dialog.open,true);assert.equal(next.get('gameTutorialCounter').textContent,'Шаг 1 из 11');
});

test('trip, history and board steps light both the tool and its navigation, then remove the extra hole',async()=>{
 const b=tour({saved:{status:'active',step:4,total:11}});
 b.get('locationSearchPanel').getBoundingClientRect=()=>({left:900,top:180,right:1240,bottom:600});
 b.get('game-tab').getBoundingClientRect=()=>({left:16,top:100,right:80,bottom:160});
 await b.clock.advance(0);
 assert.equal(b.get('gameTutorialHole').getAttribute('x'),'894');
 assert.equal(b.get('gameTutorialSecondaryHole').getAttribute('x'),'10');
 assert.equal(b.get('gameTutorialSecondarySpotlight').hidden,false);
 b.get('game-tab').getBoundingClientRect=()=>({left:20,top:120,right:84,bottom:180});
 b.window.emit('resize');await b.clock.advance(0);
 assert.equal(b.get('gameTutorialSecondaryHole').getAttribute('x'),'14');
 b.get('tripHistory').getBoundingClientRect=()=>({left:130,top:340,right:850,bottom:500});
 b.click('gameTutorialNext');assert.equal(b.get('gameTutorialHole').getAttribute('x'),'124');
 assert.equal(b.get('gameTutorialSecondaryHole').getAttribute('x'),'14');
 b.get('board-tab').getBoundingClientRect=()=>({left:18,top:310,right:82,bottom:370});
 b.click('gameTutorialNext');assert.equal(b.get('gameTutorialSecondaryHole').getAttribute('y'),'304');
 b.click('gameTutorialNext');assert.equal(b.get('gameTutorialSecondarySpotlight').hidden,true);
 assert.equal(b.get('gameTutorialSecondaryHole').getAttribute('width'),'0');
});

test('all eleven steps open real tools without visits, edits, submissions or timer controls',async()=>{
 const b=tour();b.element('houseNumber').value='42';b.element('playerNotesText').value='Моя версия';await b.clock.advance(0);
 for(let i=1;i<11;i++)b.click('gameTutorialNext');
 assert.deepEqual(b.opened,['game','game','addressbook','addressbook','game','game','board','game','questions','questions','game']);
 assert.equal(b.get('gameTutorialNext').textContent,'К расследованию');b.click('gameTutorialNext');
 assert.equal(b.dialog.open,false);assert.equal(b.saved().status,'completed');assert.equal(b.calls.length,0);
 assert.equal(b.element('houseNumber').value,'42');assert.equal(b.element('playerNotesText').value,'Моя версия');
});

test('reload migrates legacy progress, back works, and Escape skips via native cancel',async()=>{
 const b=tour({saved:{status:'active',step:7}});await b.clock.advance(0);
 assert.equal(b.get('gameTutorialCounter').textContent,'Шаг 7 из 11');assert.equal(b.opened.at(-1),'board');
 b.dialog.emit('keydown',{key:'ArrowLeft',preventDefault(){}});assert.equal(b.get('gameTutorialCounter').textContent,'Шаг 6 из 11');
 b.dialog.emit('keydown',{key:'ArrowRight',preventDefault(){}});assert.equal(b.get('gameTutorialCounter').textContent,'Шаг 7 из 11');
 b.dialog.emit('cancel',{preventDefault(){}});assert.equal(b.saved().status,'skipped');assert.equal(b.dialog.open,false);
});

test('old materials progress resumes the combined briefing and stays there after another reload',async()=>{
 const b=tour({saved:{status:'active',step:6}});await b.clock.advance(0);
 assert.equal(b.get('gameTutorialCounter').textContent,'Шаг 2 из 11');assert.equal(b.get('gameTutorialTitle').textContent,'Начните с брифинга');
 const again=tour({saved:b.saved()});await again.clock.advance(0);
 assert.equal(again.get('gameTutorialCounter').textContent,'Шаг 2 из 11');
 const phone=tour({width:390,height:844,saved:b.saved()});await phone.clock.advance(0);
 assert.equal(phone.opened.at(-1),'applications');
 Object.assign(phone.window,{innerWidth:1440,innerHeight:900});phone.window.emit('resize');
 assert.equal(phone.opened.at(-1),'game');assert.equal(phone.get('gameTutorialCounter').textContent,'Шаг 2 из 11');
});

test('completed tours stay closed, test sessions opt in, and denied storage never traps the player',async()=>{
 for(const saved of [{status:'completed'},null]){const b=tour({saved,isTest:true});await b.clock.advance(0);assert.equal(b.dialog.open,false);b.click('gameTutorialLaunch');assert.equal(b.dialog.open,true);b.click('gameTutorialClose');assert.equal(b.dialog.open,false);}
 const b=tour({blockedStorage:true});await b.clock.advance(0);assert.equal(b.dialog.open,true);b.click('gameTutorialSkip');assert.equal(b.dialog.open,false);
});

test('tour card stays inside desktop, narrow phone and landscape viewports, including missing targets',async()=>{
 for(const [width,height]of [[1440,900],[390,844],[320,568],[844,390]]){
  const b=tour({width,height});await b.clock.advance(0);
  for(let i=0;i<11;i++){
   assert.ok(parseFloat(b.get('gameTutorialCard').style.left)>=12);
   assert.ok(parseFloat(b.get('gameTutorialCard').style.top)>=12);
   assert.ok(parseFloat(b.get('gameTutorialCard').style.left)+b.get('gameTutorialCard').offsetWidth<=width-12);
   assert.ok(parseFloat(b.get('gameTutorialCard').style.top)+b.get('gameTutorialCard').offsetHeight<=height-12);
   b.click('gameTutorialNext');
  }
 }
});
