(() => {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>Number(value).toLocaleString('ru-RU',{useGrouping:true});
  function pending(result){return result.scoring?.fee==null&&result.scoring?.ai_review?.status==='processing';}
  function render(result){
    if(result.cancelled)return `<p>${escape(result.rating_rule)}</p>`;
    const f=result.scoring,fee=f?.fee??result.run?.score;
    const processing=pending(result);
    return `<div class="result-summary"><p class="result-score"><span class="result-score-value">${fee==null?'На проверке':number(fee)}</span>${fee==null?'':`<small class="result-score-max">из&nbsp;${number(f?.max_fee||2000)}</small>`}</p>${f?`<div class="fee-breakdown player-fee-breakdown"><div class="fee-metric"><strong>${f.points==null?'—':f.points+' / '+f.max_points}</strong><span>баллы за ответы</span></div><div class="fee-metric"><strong>${f.trips??0}</strong><span>поездок</span></div></div>`:''}<p class="muted" data-result-status role="status">${fee==null?(processing?'Ответы проверяются автоматически. Гонорар и разбор появятся на этом экране.':'Ответы переданы организатору на проверку. Оценки появятся после публикации.'):escape(result.rating_rule||'')}</p>${result.ranked&&fee!=null?`<p class="notice">В общий рейтинг: ${f?.rating_points??fee} баллов за первое прохождение.</p>`:''}</div>${(f?.grades||[]).length?`<section class="answer-reviews" aria-label="Разбор ответов"><h2>Разбор ответов</h2>${f.grades.map((g,index)=>`<article class="answer-review"><div class="answer-review-heading"><div><span class="eyebrow">Вопрос ${index+1}</span><h3>${escape(g.question_text)}</h3></div><span class="answer-grade ${g.grade===5?'answer-grade-full':g.grade===0?'answer-grade-zero':'answer-grade-partial'}" aria-label="Оценка ${g.grade} из 5">${g.grade}<small>из 5</small></span></div><div class="answer-comparison"><div class="answer-player"><h4>Ваш ответ</h4><p class="answer-copy">${escape(g.answer_text||'Ответ не дан.')}</p>${g.comment?`<div class="answer-feedback"><h4>Комментарий к оценке</h4><p class="answer-copy">${escape(g.comment)}</p></div>`:''}</div><div class="answer-correct"><h4>Правильный ответ</h4><p class="answer-copy">${escape(g.correct_answer||'Эталонный ответ для этого вопроса пока не опубликован.')}</p></div></div></article>`).join('')}</section>`:''}${result.solution?`<section class="result-solution"><h2>Разбор дела</h2><p class="answer-copy">${escape(result.solution)}</p></section>`:''}`;
  }
  // One request at a time; closing or replacing a result discards late responses.
  function watch({load,onResult,onError,isActive=()=>true}){
    let stopped=false,timer=null,failures=0;
    const started=Date.now();
    const active=()=>!stopped&&isActive();
    const schedule=()=>{if(active())timer=setTimeout(tick,Date.now()-started<30000?2000:5000);};
    async function tick(){
      if(!active())return;
      try{
        const result=await load();if(!active())return;failures=0;onResult(result);
        if(pending(result)){
          if(Date.now()-started<180000)schedule();
          else onError(new Error('Проверка занимает больше времени. Нажмите «Обновить результат» через несколько секунд.'));
        }
      }catch(error){if(!active())return;onError(error);if(++failures<3&&Date.now()-started<180000)schedule();}
    }
    tick();
    return ()=>{stopped=true;clearTimeout(timer);};
  }
  window.detektumResults={render,watch,pending};
})();
