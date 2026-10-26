/* Navigation and presentation only: existing forms, identities and API handlers stay in place. */
(() => {
 'use strict';
 const byId=id=>document.getElementById(id);
 const sections={
  overview:['Рабочий стол','Обзор','Дела, команды и задачи организатора в одном месте.'],
  rooms:['Проведение игр','Комнаты','Запускайте расследования, приглашайте команды и управляйте временем.'],
  houses:['Проведение игр','Дома агентств','Общие игры нескольких команд: агентства, единый таймер и таблица гонораров.'],
  playerManagement:['Проведение игр','Игроки и прохождения','Аккаунты игроков, доступы к делам, попытки и история действий.'],
  reviews:['Проведение игр','Проверка и гонорары','Оцените отправленные ответы и опубликуйте результаты расследования.'],
  answers:['Проведение игр','Ответы отдельных команд','Просмотр ответов команд с отдельным входом. Общие комнаты проверяются в разделе «Проверка и гонорары».'],
  statistics:['Проведение игр','Статистика','Посмотрите, какие адреса находили команды и сколько поездок они совершили.'],
  scenarios:['Подготовка дел','Сценарии','Настройки дела, игровые сцены, приложения и интернет-страницы.'],
  addressBook:['Подготовка дел','Адресная книга города','Общий справочник имён и организаций. Тексты игровых сцен редактируются в сценариях.'],
  backup:['Подготовка дел','Импорт и экспорт','Переносите сценарии целиком с материалами или импортируйте таблицы Excel.'],
  enquiries:['Администрирование','Заявки с сайта','Обращения компаний, статусы, контакты и договорённости.'],
  users:['Администрирование','Организаторы','Служебные учётные записи и роли. Аккаунты покупателей находятся в разделе «Игроки и прохождения».'],
  permissions:['Администрирование','Права доступа','Назначайте организаторам доступ к нужным сценариям.']
 };
 const slug=id=>id==='playerManagement'?'player-management':id;
 let initialized=false,routing=false,reviewLoaded=false,active='overview',scenarioPane='library';
 let rooms=[],cases=[],roomsLoaded=false,casesLoaded=false;
 const paneGroups=new Map();
 function allowed(id){const link=document.querySelector(`.sidebar [data-tab="${id}"]`);return !!sections[id]&&!!link&&!link.hidden&&link.style.display!=='none';}
 function routeValue(){return '#'+slug(active)+(active==='scenarios'&&scenarioPane!=='library'?'/'+scenarioPane:'');}
 function saveRoute(replace=false){if(routing||location.hash===routeValue())return;history[replace?'replaceState':'pushState']({},'',routeValue());}
 function selectPane(group,id){
  const item=paneGroups.get(group);if(!item||!item.panels.has(id))return;
  for(const [key,panel]of item.panels)panel.hidden=key!==id;
  item.nav.querySelectorAll('button').forEach(button=>{button.setAttribute('aria-selected',String(button.dataset.wsPane===id));button.tabIndex=button.dataset.wsPane===id?0:-1;});
  if(group==='scenario'){scenarioPane=id;if(active==='scenarios')saveRoute(true);}
 }
 function makePanes(host,group,items){
  const nav=document.createElement('div');nav.className='ws-editor-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label',group==='scenario'?'Редактор сценариев':'Разделы настройки дела');
  const panels=new Map();
  items.forEach(([id,label,nodes])=>{
   const panel=document.createElement('div');panel.className='ws-subpanel';panel.id='ws-'+group+'-'+id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','ws-tab-'+group+'-'+id);
   nodes.forEach(node=>panel.append(node));panels.set(id,panel);
   const button=document.createElement('button');button.type='button';button.id='ws-tab-'+group+'-'+id;button.dataset.wsPane=id;button.textContent=label;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);button.addEventListener('click',()=>selectPane(group,id));
   nav.append(button);
  });
  host.append(nav,...panels.values());paneGroups.set(group,{nav,panels});
  nav.addEventListener('keydown',event=>{const buttons=[...nav.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].click();buttons[next].focus();});
  selectPane(group,items[0][0]);return panels;
 }
 function disclosure(formId,title,description){
  const form=byId(formId);if(!form)return null;
  const container=form.closest('.form-section')||form.closest('.card');if(!container)return null;
  const details=document.createElement('details');details.className='ws-disclosure';details.id='ws-form-'+formId;
  const summary=document.createElement('summary');summary.append(document.createTextNode(title));if(description){const small=document.createElement('small');small.textContent=description;summary.append(small);}
  container.before(details);details.append(summary,container);
  return details;
 }
 function reveal(id){
  const node=typeof id==='string'?byId(id):id;if(!node)return;
  for(const [group,item]of paneGroups)for(const [key,panel]of item.panels)if(panel.contains(node))selectPane(group,key);
  let parent=node.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}
  node.scrollIntoView({block:'center',behavior:'smooth'});
 }
 function buildScenarioEditor(){
  const host=byId('scenarios-tab'),children=[...host.children];
  const addresses=children.findIndex(n=>n.tagName==='H4'&&n.textContent.includes('Адреса'));
  const internet=children.findIndex(n=>n.tagName==='H4'&&n.textContent.includes('Интернет'));
  if(addresses<0||internet<0)throw Error('Scenario editor sections not found');
  children.filter(n=>n.tagName==='HR').forEach(n=>n.remove());
  const panels=makePanes(host,'scenario',[
   ['library','Список дел',children.slice(0,addresses).filter(n=>n.tagName!=='HR')],
   ['scenes','Сцены и приложения',children.slice(addresses,internet).filter(n=>n.tagName!=='HR')],
   ['internet','Интернет-страницы',children.slice(internet).filter(n=>n.tagName!=='HR')]
  ]);
  const library=panels.get('library'),table=byId('scenariosTable').closest('.card');library.prepend(table);
  const search=document.createElement('input');search.type='search';search.id='wsScenarioSearch';search.className='form-control';search.placeholder='Найти дело по названию';search.setAttribute('aria-label','Поиск сценария');table.before(search);
  search.addEventListener('input',()=>filterTable('scenariosTable',search.value));
  disclosure('addScenarioForm','Создать сценарий','Новое дело с отдельными сценами и вопросами.');
  disclosure('copyScenarioForm','Сделать копию сценария','Исходное дело сохранится; копия будет самостоятельным сценарием.');
  const addressForm=disclosure('addAddressForm','Добавить игровую сцену','Район, адрес, текст посещения и приложения.');
  const addressTable=byId('addressesTable').closest('.card');if(addressForm)panels.get('scenes').append(addressForm);
  const sceneSearch=document.createElement('input');sceneSearch.type='search';sceneSearch.id='wsSceneSearch';sceneSearch.className='form-control mb-3';sceneSearch.placeholder='Поиск по адресу или тексту сцены';sceneSearch.setAttribute('aria-label','Поиск сцен');addressTable.before(sceneSearch);
  sceneSearch.addEventListener('input',()=>filterTable('addressesTable',sceneSearch.value));
  new MutationObserver(()=>filterTable('addressesTable',sceneSearch.value)).observe(byId('addressesTable'),{childList:true});
  const internetRow=byId('internetPageScenario').closest('.row');if(internetRow)panels.get('internet').prepend(internetRow);
  const internetForm=disclosure('internetPageForm','Создать или изменить интернет-страницу','Блочный редактор и HTML. Существующие страницы находятся в списке выше.');
  if(internetForm)panels.get('internet').append(internetForm);
  const form=byId('editScenarioForm'),fields=[...form.children];
  const briefing=fields.find(n=>n.contains(byId('scenarioBriefingFiles'))),questions=fields.find(n=>n.contains(byId('editScenarioQuestions')));
  if(briefing&&questions)makePanes(form,'settings',[
   ['general','Название и обложка',fields.filter(n=>n!==briefing&&n!==questions)],['briefing','Брифинг и документы',[briefing]],['questions','Вопросы',[questions]]
  ]);
  if(questions){const hint=document.createElement('p');hint.className='form-text';hint.textContent='Изменение текста сохраняется при выходе из поля. Добавление и удаление вопросов применяются сразу.';questions.prepend(hint);}
  byId('editScenarioModal').addEventListener('show.bs.modal',()=>selectPane('settings','general'));
  const addressEditor=byId('editAddressForm'),addressFields=[...addressEditor.children];
  const applicationStart=addressFields.findIndex(n=>/^H[1-6]$/.test(n.tagName)&&n.textContent.includes('Приложения'));
  if(applicationStart>=0){makePanes(addressEditor,'address',[
   ['scene','Адрес и текст сцены',addressFields.slice(0,applicationStart)],['files','Приложения',addressFields.slice(applicationStart)]
  ]);byId('editAddressModal').addEventListener('show.bs.modal',()=>selectPane('address','scene'));}
  const editPage=window.editInternetPage;if(editPage)window.editInternetPage=function(...args){const result=editPage(...args);reveal('internetPageForm');return result;};
 }
 function filterTable(id,value){const query=value.trim().toLocaleLowerCase('ru');byId(id)?.querySelectorAll('tr').forEach(row=>{row.hidden=!!query&&!row.textContent.toLocaleLowerCase('ru').includes(query);});}
 function refreshOverview(){
  for(const [state,id]of [['running','wsRunning'],['pending','wsPending'],['paused','wsPaused']])byId(id).textContent=roomsLoaded?String(rooms.filter(r=>!r.archived_at&&!r.is_test&&r.state===state).length):'—';
  byId('wsScenarios').textContent=casesLoaded?String(cases.length):'—';
  const host=byId('wsCurrentRooms');host.replaceChildren();
  if(!roomsLoaded){const empty=document.createElement('p');empty.className='ws-empty';empty.textContent='Загружаем комнаты. Если данные не появились, откройте раздел «Комнаты» для повторной загрузки.';host.append(empty);return;}
  const current=rooms.filter(r=>!r.archived_at&&!r.is_test&&r.state!=='finished').slice(0,5);
  if(!current.length){const empty=document.createElement('p');empty.className='ws-empty';empty.textContent='Сейчас нет незавершённых комнат. Создайте комнату, когда будете готовы собрать команду.';host.append(empty);return;}
  const statuses={running:'Идёт игра',pending:'Ожидает старта',paused:'На паузе'};
  current.forEach(room=>{const row=document.createElement('div');row.className='ws-room-row';const icon=document.createElement('i');icon.className='fas fa-door-open';icon.setAttribute('aria-hidden','true');const body=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('small'),badge=document.createElement('span'),open=document.createElement('button');name.textContent=room.name;meta.textContent=(room.scenario_name||'Сценарий №'+room.scenario_id)+' · №'+room.id;badge.className='ws-status '+room.state;badge.textContent=statuses[room.state]||room.state;body.append(name,meta);open.type='button';open.className='btn btn-outline-primary btn-sm';open.textContent='К комнате';open.addEventListener('click',()=>{switchTab('rooms');const search=byId('wsRoomSearch');search.value=room.name;filterRooms();});row.append(icon,body,badge,open);host.append(row);});
 }
 function filterRooms(){const value=byId('wsRoomSearch')?.value?.trim().toLocaleLowerCase('ru')||'',state=byId('wsRoomState')?.value||'';byId('roomsTable')?.querySelectorAll('tr').forEach(row=>{const id=Number(row.firstElementChild?.textContent),room=rooms.find(r=>Number(r.id)===id);row.hidden=!!room&&((state==='archived'?!room.archived_at:!!room.archived_at)||(state==='test'?!room.is_test:!!state&&state!=='archived'&&room.state!==state)||(!!value&&!row.textContent.toLocaleLowerCase('ru').includes(value)));});}
 function buildRoomWorkspace(){
  const panel=byId('rooms-tab'),table=byId('roomsTable').closest('.card');panel.prepend(table);
  const create=disclosure('createRoomForm','Создать комнату','Команда войдёт по ссылке. Таймер запускается отдельно, когда все готовы.');
  const teams=disclosure('addRoomUserForm','Команды с отдельным входом','Для комнат со входом по названию команды и паролю. Для общей комнаты достаточно ссылки.');
  if(create)panel.insertBefore(create,table);
  const filters=document.createElement('div');filters.className='ws-review-filters';filters.innerHTML='<label>Поиск комнаты<input id="wsRoomSearch" class="form-control" type="search" placeholder="Название, сценарий или номер"></label><label>Статус<select id="wsRoomState" class="form-select"><option value="">Все комнаты вне архива</option><option value="running">Идут сейчас</option><option value="pending">Ожидают старта</option><option value="paused">На паузе</option><option value="finished">Завершены</option><option value="test">Тестовые</option><option value="archived">Архив</option></select></label>';
  table.before(filters);byId('wsRoomSearch').addEventListener('input',filterRooms);byId('wsRoomState').addEventListener('change',filterRooms);
  const view=window.viewRoomUsers;if(view)window.viewRoomUsers=function(...args){reveal('addRoomUserForm');return view(...args);};
 }
 function loadReviews(){
  if(reviewLoaded){byId('review-refresh').click();return;}
  reviewLoaded=true;const script=document.createElement('script');script.src='/js/player-reviews.js?v=houses1';script.onerror=()=>{reviewLoaded=false;byId('review-error').textContent='Не удалось загрузить проверку. Откройте раздел повторно.';byId('review-error').hidden=false;};document.body.append(script);
 }
 function commandSearch(){
  const trigger=document.createElement('button');trigger.type='button';trigger.className='ws-command-trigger';trigger.setAttribute('aria-label','Найти раздел');trigger.innerHTML='<i class="fas fa-search" aria-hidden="true"></i><span>Найти раздел</span><kbd>Ctrl K</kbd>';
  const dialog=document.createElement('dialog');dialog.className='ws-command-dialog';dialog.setAttribute('aria-labelledby','wsCommandTitle');
  dialog.innerHTML='<div class="ws-command-heading"><h2 id="wsCommandTitle">Куда перейти?</h2><button type="button" class="btn btn-outline-secondary btn-sm" aria-label="Закрыть поиск">×</button></div><label class="visually-hidden" for="wsCommandInput">Поиск раздела</label><input type="search" id="wsCommandInput" class="form-control" placeholder="Например: брифинг, таймер, игрок…" autocomplete="off"><div class="ws-command-results"></div>';
  document.body.append(dialog);document.querySelector('.navbar-brand').after(trigger);
  const input=dialog.querySelector('input'),results=dialog.querySelector('.ws-command-results');
  const aliases={rooms:'таймер время пригласить создать комнату пауза',scenarios:'брифинг документы вопросы сцены приложения копия обложка',playerManagement:'доступ аккаунт попытки игроки журнал',reviews:'оценки баллы результат гонорар ответы',backup:'xlsx excel zip загрузить скачать пакет',addressBook:'справочник имена организации адреса',users:'администратор учётные записи'};
  function render(){results.replaceChildren();const query=input.value.trim().toLocaleLowerCase('ru');const found=Object.entries(sections).filter(([id,values])=>allowed(id)&&(!query||(values.join(' ')+' '+(aliases[id]||'')).toLocaleLowerCase('ru').includes(query)));if(!found.length){const empty=document.createElement('p');empty.className='ws-empty';empty.textContent='Такой раздел не найден. Попробуйте другое слово.';results.append(empty);}for(const [id,[group,title]]of found){const button=document.createElement('button');button.type='button';const name=document.createElement('strong'),meta=document.createElement('small');name.textContent=title;meta.textContent=group;button.append(name,meta);button.addEventListener('click',()=>{dialog.close();switchTab(id);byId('adminWorkspaceHeader').focus({preventScroll:false});});results.append(button);}}
  function open(){input.value='';render();dialog.showModal();input.focus();}
  trigger.addEventListener('click',open);input.addEventListener('input',render);dialog.querySelector('button').addEventListener('click',()=>dialog.close());
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!dialog.open)open();}});
 }
 function openRoute(){const [raw,sub]=location.hash.slice(1).split('/'),id=raw==='player-management'?'playerManagement':raw;const next=allowed(id)?id:'overview';routing=true;switchTab(next);if(next==='scenarios'&&['library','scenes','internet'].includes(sub))selectPane('scenario',sub);routing=false;saveRoute(true);}
 function init(){
  if(initialized||!window.currentUser&&!localStorage.getItem('token'))return;
  initialized=true;
  let user;try{user=JSON.parse(localStorage.getItem('user')||'{}');}catch(_){return;}
  if(!user.is_admin)return;
  document.querySelectorAll('[data-ws-super]').forEach(n=>{n.hidden=user.admin_level!=='super_admin';});
  document.querySelectorAll('.ws-nav-group').forEach(group=>{group.hidden=![...group.querySelectorAll('[data-tab]')].some(link=>link.style.display!=='none');});
  const adminGroup=[...document.querySelectorAll('.ws-nav-group')].find(group=>group.querySelector('.ws-nav-label')?.textContent==='Администрирование');
  if(adminGroup){const details=document.createElement('details');details.className='ws-nav-group ws-system-group';details.open=true;details.hidden=adminGroup.hidden;const summary=document.createElement('summary');summary.className='ws-nav-label';summary.textContent='Администрирование';details.append(summary,...adminGroup.querySelectorAll('[data-tab]'));adminGroup.replaceWith(details);}
  byId('wsLocalBadge').hidden=!['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  buildScenarioEditor();buildRoomWorkspace();disclosure('addUserForm','Добавить учётную запись','Организатор для управления играми или пользователь с отдельной ролью.');
  const usersTable=byId('usersTable').closest('.card');byId('users-tab').prepend(usersTable);
  const previousSwitch=window.switchTab;
  window.switchTab=function(id){
   if(!sections[id])return;
   if(!allowed(id))return previousSwitch(id);
   previousSwitch(id);active=id;const [group,title,description]=sections[id];byId('wsBreadcrumb').textContent=group;byId('wsPageTitle').textContent=title;byId('wsPageDescription').textContent=description;
   document.querySelectorAll('.sidebar [data-tab]').forEach(link=>{if(link.dataset.tab===id)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
   const parent=document.querySelector(`.sidebar [data-tab="${id}"]`)?.closest('details');if(parent)parent.open=true;
   saveRoute();if(id==='overview')refreshOverview();if(id==='reviews')loadReviews();if(id==='scenarios')selectPane('scenario',scenarioPane);
   if(innerWidth<992)window.closeSidebar?.();
  };
  const displayRooms=window.displayRooms;window.displayRooms=function(items){rooms=items;roomsLoaded=typeof roomsCache!=='undefined'&&Array.isArray(roomsCache);const result=displayRooms(items);filterRooms();refreshOverview();return result;};
  const displayScenarios=window.displayScenarios;window.displayScenarios=function(items){cases=items;casesLoaded=true;const result=displayScenarios(items);filterTable('scenariosTable',byId('wsScenarioSearch').value);refreshOverview();return result;};
  document.addEventListener('click',event=>{
   const go=event.target.closest('[data-ws-go]');if(go){switchTab(go.dataset.wsGo);return;}
   const reviewLink=event.target.closest('a[href="/player-reviews.html"]');if(reviewLink&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){event.preventDefault();switchTab('reviews');}
  });
  document.addEventListener('invalid',event=>reveal(event.target),true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&byId('sidebar').classList.contains('show'))window.closeSidebar?.();});
  window.addEventListener('popstate',openRoute);window.addEventListener('hashchange',openRoute);
  commandSearch();
  const draftRooms=typeof roomsCache==='undefined'?null:roomsCache;if(Array.isArray(draftRooms)){rooms=draftRooms;roomsLoaded=true;}
  if(typeof scenarios!=='undefined'&&scenarios.length){cases=scenarios;casesLoaded=true;}
  openRoute();
 }
 window.adminWorkspace={reveal,openScenes(id){switchTab('scenarios');selectPane('scenario','scenes');byId('addressScenario').value=String(id);byId('viewAddressScenario').value=String(id);byId('viewAddressScenario').dispatchEvent(new Event('change',{bubbles:true}));},refresh:refreshOverview};
 document.addEventListener('DOMContentLoaded',init);
})();
