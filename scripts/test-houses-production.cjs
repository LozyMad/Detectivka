'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash,randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const root=path.resolve(__dirname,'..'),privateFile=process.env.HOUSES_E2E_STATE||path.join(root,'deploy/beget/private/houses-e2e-state.json');
const reportDir=path.join(root,'output/game-houses-production-report');fs.mkdirSync(reportDir,{recursive:true});fs.mkdirSync(path.dirname(privateFile),{recursive:true});
const reportFile=path.join(reportDir,'production-e2e.json');
const base='https://detektum.ru';
let state=fs.existsSync(privateFile)?JSON.parse(fs.readFileSync(privateFile,'utf8')):{base,houses:[],report:{base,created_at:new Date().toISOString(),checks:[]}};
function save(){fs.writeFileSync(privateFile,JSON.stringify(state,null,2));fs.writeFileSync(reportFile,JSON.stringify(state.report,null,2));if(process.env.DEPLOY_SECRET)fs.writeFileSync(path.join(reportDir,'recovery.enc'),encrypt(JSON.stringify(state)));}
function check(name,data={}){const item={name,at:new Date().toISOString(),...data};state.report.checks.push(item);save();console.log(JSON.stringify(item));}
async function api(url,{method='GET',body,token=state.adminToken,expected=200,timeout=30000}={}){
  const response=await fetch(base+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
  const data=await response.json().catch(()=>({}));
  if(response.status!==expected){const error=new Error('HTTP '+response.status+' '+url+': '+String(data.error||'Unexpected response'));error.status=response.status;throw error;}
  return data;
}
async function house(index){const h=state.houses[index];assert.ok(h,'House is not prepared');return api('/api/houses/'+h.id);}
async function control(index,action,extra={}){
  const data=await house(index),h=state.houses[index];
  await api('/api/houses/'+h.id+'/control',{method:'POST',body:{action,revision:data.house.revision,request_key:randomUUID(),...extra}});
  return house(index);
}
function encrypt(value){
  const key=createHash('sha256').update(process.env.DEPLOY_SECRET||'').digest(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return Buffer.from(JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')})).toString('base64');
}
function decrypt(value){
  assert.ok(process.env.DEPLOY_SECRET,'Deployment secret is required to unlock encrypted test credentials');
  const payload=JSON.parse(Buffer.from(value,'base64').toString('utf8'));
  const decipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(process.env.DEPLOY_SECRET).digest(),Buffer.from(payload.iv,'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload.data,'base64')),decipher.final()]).toString('utf8');
}
async function fullBrowserTest(){
  const credentials=JSON.parse(decrypt(process.env.HOUSES_E2E_CREDENTIALS));
  assert.equal(credentials.username,'admin');assert.ok(credentials.password);
  console.log('::add-mask::'+credentials.password);
  if(process.env.HOUSES_E2E_RECOVERY)state=JSON.parse(decrypt(process.env.HOUSES_E2E_RECOVERY));
  process.env.HOUSES_ADMIN_PASSWORD=credentials.password;
  await main('login');delete process.env.HOUSES_ADMIN_PASSWORD;
  await main('preflight');
  const {chromium}=require('playwright');
  const browser=await chromium.launch({headless:true,...(process.env.HOUSES_BROWSER_CHANNEL?{channel:process.env.HOUSES_BROWSER_CHANNEL}:{})});
  const adminContext=await browser.newContext({viewport:{width:1440,height:1000}}),adminPage=await adminContext.newPage();
  const players=[];
  try{
    await adminPage.goto(base+'/admin-login');
    await adminPage.locator('#username').fill(credentials.username);await adminPage.locator('#password').fill(credentials.password);
    await adminPage.locator('#adminLoginForm button[type=submit]').click();await adminPage.waitForURL(/\/admin(?:#|$)/,{timeout:30000});
    credentials.password='';
    await adminPage.locator('.sidebar [data-tab=houses]').click();
    if(!state.houses.length){
      const prefix='Проверка игры · '+new Date().toLocaleDateString('ru-RU',{timeZone:'Asia/Yerevan'});
      for(let n=0;n<2;n++){
        if(n)await adminPage.locator('[data-house-action=back]').click();
        await adminPage.locator('[data-house-action=create]').click();
        const modal=adminPage.locator('.houses-dialog[open]');
        const name=prefix+' · '+(n+1);
        await modal.locator('[name=name]').fill(name);await modal.locator('[name=scenario_id]').selectOption(String(state.scenario_id));
        await modal.locator('[name=questions_immediate]').check();
        await modal.locator('[name=format]').selectOption(n?'offline':'online');
        const created=adminPage.waitForResponse(r=>r.url()===base+'/api/houses'&&r.request().method()==='POST'&&r.status()===201);
        await modal.locator('button[type=submit]').click();const entry={id:(await(await created).json()).id,name,teams:[]};state.houses.push(entry);save();
        await modal.waitFor({state:'hidden'});
        for(let k=0;k<3;k++){
          await adminPage.locator('[data-house-action=add-team]').click();
          const dialog=adminPage.locator('.houses-dialog[open]'),password='Check-'+randomUUID().slice(0,12),teamName='Тест '+(n+1)+' · Агентство '+(k+1);
          await dialog.locator('[name=name]').fill(teamName);await dialog.locator('[name=password]').fill(password);await dialog.locator('[name=participants]').fill(String(3+k));
          const response=adminPage.waitForResponse(r=>r.url().endsWith('/api/houses/'+entry.id+'/teams')&&r.request().method()==='POST'&&r.status()===201);
          await dialog.locator('button[type=submit]').click();const result=await(await response).json();
          entry.teams.push({room_id:result.room_id,name:teamName,password});save();await dialog.waitFor({state:'hidden'});
        }
        const data=await house(n);entry.public_id=data.house.public_id;entry.url=base+data.house.invite_path;save();
        assert.equal(data.house.questions_delay_seconds,0);assert.equal(data.house.duration_seconds,7200);assert.equal(data.teams.length,3);
        check('house_created_through_admin_ui',{house:n+1,id:entry.id,url:entry.url,rooms:entry.teams.map(t=>t.room_id),questions_delay_seconds:0});
      }
    }
    assert.equal(state.houses.length,2);
    for(let h=0;h<2;h++)for(const team of state.houses[h].teams){
      const entry=state.houses[h],context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
      await page.goto(entry.url);await page.locator('#house-team').selectOption(String(team.room_id));
      await page.locator('#house-password').fill(team.password);await page.locator('#house-enter').click();
      await page.waitForURL(/\/(?:game|room-result)$/,{timeout:30000});
      if(page.url().endsWith('/game')){
        await page.locator('#gameTutorialSkip').waitFor({state:'visible',timeout:7000}).then(()=>page.locator('#gameTutorialSkip').click()).catch(()=>{});
        const auth=await api('/api/houses/public/'+entry.public_id+'/join',{method:'POST',token:null,body:{room_id:team.room_id,password:team.password}});
        team.token=auth.token;team.user_id=auth.user.id;
      }
      players.push({h,team,page,context});save();
      check('agency_entered_through_player_ui',{house:h+1,room_id:team.room_id});
    }
    async function openAdminHouse(h){
      const back=adminPage.locator('[data-house-action=back]');if(await back.isVisible())await back.click();
      await adminPage.locator('.houses-card').filter({hasText:state.houses[h].name}).locator('[data-house-action=open]').click();
    }
    async function startHouse(h){
      await openAdminHouse(h);await adminPage.locator('[data-house-action=start]').click();
      const dialog=adminPage.locator('.houses-dialog[open]');
      const response=adminPage.waitForResponse(r=>r.url().endsWith('/api/houses/'+state.houses[h].id+'/control')&&r.request().method()==='POST'&&r.status()===200);
      await dialog.locator('button[type=submit]').click();await response;await dialog.waitFor({state:'hidden'});
      const data=await house(h);state.houses[h].started_at=data.house.game_start_time;save();
      for(const team of state.houses[h].teams){const game=await api('/api/game/shared/state',{token:team.token});assert.equal(game.room.state,'running');assert.equal(game.questions_access.is_open,true);assert.equal(game.questions.length,7);}
      check('house_started_through_admin_ui',{house:h+1,started_at:data.house.game_start_time,questions_open:true});
    }
    async function play(h){
      for(const player of players.filter(p=>p.h===h)){
        const {page,team}=player;if(team.submitted_at)continue;
        const k=state.houses[h].teams.indexOf(team);
        await api('/api/game/visit',{method:'POST',token:team.token,expected:404,body:{district:'Ц',house_number:'9999',apartment:''}});
        await page.locator('#questions-tab').click();
        const game=await api('/api/game/shared/state',{token:team.token});
        for(let q=0;q<game.questions.length;q++){
          const question=game.questions[q],rule=state.rules.find(r=>Number(r.id)===Number(question.id));assert.ok(rule);
          let answer=rule.answer;if(k===1&&q===2)answer='Деньги дал Хованец. Кто поручился — не знаем.';
          if(k===2&&q===6)answer='Фургон поджёг Хованец из-за долга Марека.';
          await page.locator('#answer_'+question.id).fill(answer);
        }
        page.once('dialog',dialog=>dialog.accept());
        await page.locator('#submitAllAnswersBtn').click();await page.waitForURL('**/room-result',{timeout:45000});
        team.submitted_at=new Date().toISOString();save();
        const result=await api('/api/game/shared/result',{token:team.token});assert.equal(result.awaiting_house_finish,true);assert.deepEqual(result.scoring.grades,[]);assert.ok(result.scoring.ai_review);
        await api('/api/game/shared/state',{token:team.token,expected:403});
        check('agency_answered_and_submitted_through_ui',{house:h+1,room_id:team.room_id,answers:7,ai_status:result.scoring.ai_review.status,solution_hidden:true,gameplay_closed:true});
      }
    }
    if(!state.houses[0].started_at)await startHouse(0);
    if(!state.houses[0].teams.every(t=>t.submitted_at))await play(0);
    if(!state.houses[1].started_at){
      const deadline=new Date(state.houses[0].started_at).getTime()+150000;
      check('waiting_for_independent_second_start',{remaining_seconds:Math.max(0,Math.ceil((deadline-Date.now())/1000))});
      while(Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,1000));
      await startHouse(1);
    }
    const gap=(new Date(state.houses[1].started_at)-new Date(state.houses[0].started_at))/1000;assert.ok(gap>=120);check('independent_starts',{gap_seconds:gap});
    if(!state.houses[1].teams.every(t=>t.submitted_at))await play(1);
    const waitUntil=Date.now()+8*60000;
    let complete=false;
    while(Date.now()<waitUntil){
      await main('status');
      const jobs=state.report.latest_results.flatMap(h=>h.results);complete=jobs.every(r=>r.ai_status==='completed'&&r.review_status==='graded');
      if(complete)break;
      assert.ok(jobs.every(r=>r.ai_status!=='needs_review'),'AI job requires review; see the saved report');
      await new Promise(resolve=>setTimeout(resolve,10000));
    }
    assert.ok(complete,'AI review did not finish in the allotted time');
    await main('finish');
    for(const player of players){
      await player.page.reload();await player.page.locator('.result-score-value').waitFor({timeout:30000});
      await player.page.screenshot({path:path.join(reportDir,'agency-'+player.team.room_id+'-result.png'),fullPage:true});
    }
    for(let h=0;h<2;h++){
      await openAdminHouse(h);await adminPage.locator('#house-standings-status').filter({hasText:'Итоговые места'}).waitFor();
      await adminPage.screenshot({path:path.join(reportDir,'house-'+(h+1)+'-standings.png'),fullPage:true});
    }
    const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),mobile=await phone.newPage();
    await mobile.goto(state.houses[0].url);await mobile.locator('#house-login').waitFor();
    await mobile.screenshot({path:path.join(reportDir,'mobile-entry.png'),fullPage:true});
    state.report.passed=true;state.report.finished_at=new Date().toISOString();save();check('production_browser_test_passed',{houses:2,agencies:6,real_ai_reviews:6});
  }catch(error){
    await adminPage.locator('.houses-dialog[open] input[name=password]').fill('').catch(()=>{});
    await adminPage.screenshot({path:path.join(reportDir,'admin-failure.png'),fullPage:true}).catch(()=>{});throw error;
  }finally{await browser.close();}
}
async function main(action=process.argv[2]||'preflight',index=Number(process.argv[3]||0)){
  if(action==='full')return fullBrowserTest();
  if(action==='login'){
    assert.ok(process.env.HOUSES_ADMIN_PASSWORD,'Admin password not supplied');
    const data=await api('/api/auth/login',{method:'POST',token:null,body:{username:'admin',password:process.env.HOUSES_ADMIN_PASSWORD}});
    assert.ok(data.token);state.adminToken=data.token;save();check('production_admin_login',{ok:true});return;
  }
  if(action==='preflight'){
    const catalog=await api('/api/player/catalog',{token:null});
    const product=catalog.products.find(p=>p.id==='borrowed-time');assert.ok(product,'Published AI case not found');state.scenario_id=product.scenario_id;
    const settings=await api('/api/player/admin/manage/scoring/settings/'+state.scenario_id);
    const {freezeRubric}=require('../backend/services/borrowedTimeGrading');
    const frozen=freezeRubric(settings.questions);assert.ok(frozen,'Current questions or custom criteria do not match the supported AI rubric');
    state.question_ids=frozen.map(q=>q.id);state.rules=frozen.map(q=>({id:q.id,text:q.question_text,answer:q.ai_rule.answer}));
    const reviews=await api('/api/player/admin/manage/scoring/reviews?status=all');
    let evidence=null;
    for(const row of reviews.items.slice(0,8)){
      const detail=await api('/api/player/admin/manage/scoring/reviews/'+row.room_id);
      if(detail.ai_details){evidence={status:detail.ai_details.status,model_uri:detail.ai_details.model_uri,attempts:detail.ai_details.attempts};break;}
    }
    check('production_ai_preflight',{scenario_id:state.scenario_id,questions:frozen.length,rubric_compatible:true,existing_ai_job:evidence});return;
  }
  if(action==='prepare'){
    assert.equal(state.houses.length,0,'These test houses were already prepared');
    const prefix='Проверка домов · '+new Date().toLocaleDateString('ru-RU',{timeZone:'Asia/Yerevan'});
    for(let n=0;n<2;n++){
      const body={name:prefix+' · '+(n+1),scenario_id:state.scenario_id,duration_seconds:7200,questions_immediate:true,format:n?'offline':'online',venue:'',pause_halfway:false,request_key:randomUUID()};
      const result=await api('/api/houses',{method:'POST',body,expected:201});
      const entry={id:result.id,name:body.name,teams:[]};state.houses.push(entry);save();
      for(let k=0;k<3;k++){
        const current=await house(n),password='Check-'+randomUUID().slice(0,12),name='Тест '+(n+1)+' · Агентство '+(k+1);
        const created=await api('/api/houses/'+entry.id+'/teams',{method:'POST',expected:201,body:{name,password,participants:String(3+k),revision:current.house.revision,request_key:randomUUID()}});
        entry.teams.push({room_id:created.room_id,name,password});save();
      }
      const data=await house(n);entry.public_id=data.house.public_id;entry.url=base+data.house.invite_path;save();
      assert.equal(data.teams.length,3);assert.equal(data.house.questions_delay_seconds,0);assert.equal(data.house.duration_seconds,7200);
      for(const team of entry.teams){
        const auth=await api('/api/houses/public/'+entry.public_id+'/join',{method:'POST',token:null,body:{room_id:team.room_id,password:team.password}});
        team.token=auth.token;team.user_id=auth.user.id;
        const game=await api('/api/game/shared/state',{token:auth.token});assert.equal(game.room.state,'pending');assert.equal(game.questions.length,0);
      }
      check('house_prepared',{index:n+1,id:entry.id,url:entry.url,rooms:entry.teams.map(t=>t.room_id),questions_delay_seconds:0});
    }
    return;
  }
  if(action==='start'){
    const data=await control(index,'start'),entry=state.houses[index];entry.started_at=data.house.game_start_time;save();
    for(const team of entry.teams){const game=await api('/api/game/shared/state',{token:team.token});assert.equal(game.room.state,'running');assert.equal(game.questions_access.is_open,true);assert.equal(game.questions.length,7);}
    check('house_started',{index:index+1,started_at:entry.started_at,questions_open:true,rooms:entry.teams.map(t=>t.room_id)});
    if(index===1){const gap=(new Date(entry.started_at)-new Date(state.houses[0].started_at))/1000;assert.ok(gap>=120,'Starts must be at least two minutes apart');check('independent_starts',{gap_seconds:gap});}
    return;
  }
  if(action==='play'){
    const entry=state.houses[index];
    for(let k=0;k<entry.teams.length;k++){
      const team=entry.teams[k];if(team.submitted_at)continue;
      const game=await api('/api/game/shared/state',{token:team.token});assert.equal(game.questions_access.is_open,true);
      const note='Запись агентства '+team.name;
      await api('/api/game/shared/notes',{method:'PATCH',token:team.token,body:{text:note,revision:game.notes_revision}});
      const other=entry.teams[(k+1)%3];if(!other.submitted_at){const otherState=await api('/api/game/shared/state',{token:other.token});assert.notEqual(otherState.notes,note);}
      // Include real trips so the fee formula is exercised, not only answer grading.
      await api('/api/game/visit',{method:'POST',token:team.token,expected:404,body:{district:'Ц',house_number:'9999',apartment:''}});
      const answers=[];
      for(let q=0;q<game.questions.length;q++){
        const question=game.questions[q],rule=state.rules.find(r=>Number(r.id)===Number(question.id));assert.ok(rule);
        let answer=rule.answer;
        // Three independent patterns: full, incomplete guarantor answer, wrong arson answer.
        if(k===1&&q===2)answer='Деньги дал Хованец. Кто поручился — не знаем.';
        if(k===2&&q===6)answer='Фургон поджёг Хованец из-за долга Марека.';
        const draft=await api('/api/game/shared/draft',{method:'PATCH',token:team.token,body:{question_id:question.id,text:answer,revision:question.revision}});
        answers.push({question_id:question.id,text:answer,revision:draft.revision});
      }
      const submitted=await api('/api/game/shared/answers',{method:'POST',token:team.token,body:{finish:true,answers}});assert.equal(submitted.finished,true);
      team.submitted_at=new Date().toISOString();save();
      const result=await api('/api/game/shared/result',{token:team.token});assert.equal(result.awaiting_house_finish,true);assert.equal(result.scoring.grades.length,0);assert.ok(result.scoring.ai_review);
      await api('/api/game/shared/state',{token:team.token,expected:403});
      check('agency_submitted',{house:index+1,room_id:team.room_id,answers:answers.length,ai_status:result.scoring.ai_review.status,gameplay_closed:true,solution_hidden:true});
    }
    return;
  }
  if(action==='status'||action==='finish'){
    const summaries=[];
    for(let n=0;n<state.houses.length;n++){
      const entry=state.houses[n],results=[];
      for(const team of entry.teams){
        if(!team.submitted_at){results.push({room_id:team.room_id,submitted:false});continue;}
        const result=await api('/api/game/shared/result',{token:team.token}),review=await api('/api/player/admin/manage/scoring/reviews/'+team.room_id);
        results.push({room_id:team.room_id,ai_status:review.ai_details?.status||null,review_status:result.scoring.review_status,fee:result.scoring.fee,points:result.scoring.points,questions:review.questions.length,attempts:review.ai_details?.attempts,error_code:review.ai_details?.error_code||null});
      }
      summaries.push({house:n+1,id:entry.id,results});
      if(action==='finish'){
        assert.ok(results.every(r=>r.ai_status==='completed'&&r.review_status==='graded'),'Every agency must finish actual AI review before finalization');
        const standings=await control(n,'finish',{confirmed:true});assert.equal(standings.standings_final,true);
        assert.equal(standings.teams.length,3);assert.deepEqual(standings.teams.map(t=>t.fee),[2000,1886,1714]);
        for(const team of entry.teams){
          const result=await api('/api/game/shared/result',{token:team.token});assert.equal(result.awaiting_house_finish,false);assert.equal(result.scoring.grades.length,7);
          const returned=await api('/api/houses/public/'+entry.public_id+'/join',{method:'POST',token:null,body:{room_id:team.room_id,password:team.password}});assert.equal(returned.finished,true);
        }
        const publicInfo=await api('/api/houses/public/'+entry.public_id,{token:null});assert.ok(publicInfo.teams.every(t=>t.fee===undefined));
        check('house_finalized',{house:n+1,url:entry.url,standings:standings.teams.map(t=>({name:t.name,room_id:t.room_id,place:t.place,fee:t.fee}))});
      }
    }
    state.report.latest_results=summaries;save();console.log(JSON.stringify(summaries));return;
  }
  throw Error('Unknown action');
}
main().catch(error=>{if(process.argv[2]==='full'){state.report.failure=String(error.message||'Test failed');save();}const message=String(error.message||'Request failed').replaceAll(state.adminToken||'__no_token__','[redacted]');console.error(message);process.exitCode=1;});
