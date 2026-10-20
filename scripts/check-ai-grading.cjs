'use strict';
const path = require('node:path');
const dotenv = require(require.resolve('dotenv', {paths:[path.join(__dirname,'../backend')]}));
dotenv.config({path:path.join(__dirname,'../backend/.env')});
dotenv.config({path:path.join(__dirname,'../backend/.env.ai')});
const {rules, VERSION, freezeRubric} = require('../backend/services/borrowedTimeGrading');
const {createYandexGrader, readConfig} = require('../backend/services/yandexGrading');

async function main() {
  const config = readConfig({...process.env, AI_GRADING_ENABLED:'1'});
  const diagnose = process.argv.includes('--diagnose');
  const fetchImpl = async (...args) => {
    const response = await fetch(...args);
    if(diagnose && response.ok){
      const body=await response.clone().json();
      const text=(body.output||[]).filter(o=>o.type==='message').flatMap(o=>o.content||[]).filter(o=>o.type==='output_text').map(o=>o.text).join('');
      try{
        const value=JSON.parse(text);
        console.log(JSON.stringify({diagnostic:true,status:body.status,count:Array.isArray(value.grades)?value.grades.length:null,
          grades:Array.isArray(value.grades)?value.grades.map(g=>({question_id:g.question_id,id_type:typeof g.question_id,grade:g.grade,grade_type:typeof g.grade,matched:g.matched,
            comment_type:typeof g.comment,comment_length:typeof g.comment==='string'?g.comment.length:null,needs_review:g.needs_review,reason_type:typeof g.review_reason,reason_length:typeof g.review_reason==='string'?g.review_reason.length:null})):null}));
      }catch(_){console.log(JSON.stringify({diagnostic:true,status:body.status,json:false}));}
    }
    return response;
  };
  const grader = createYandexGrader({config, fetchImpl});
  if (process.argv.includes('--full')) {
    const questions = freezeRubric(rules.map((rule,index)=>({id:index+1,question_text:rule.aliases[0],criteria:''})));
    const result = await grader.grade({questions,answers:questions.map(q=>({question_id:q.id,answer_text:q.ai_rule.answer}))});
    const points=result.grades.reduce((sum,g)=>sum+g.grade,0);
    const passed=points===35&&!result.grades.some(g=>g.needs_review);
    console.log(JSON.stringify({expected:35,actual:points,passed,grades:result.grades.map(g=>({question_id:g.question_id,grade:g.grade,needs_review:g.needs_review})),usage:result.usage}));
    if(!passed)throw Object.assign(new Error(),{code:'AI_SMOKE_TEST_FAILED'});
    console.log('Full demo API check passed. No database changes were made.');
    return;
  }
  const rule = rules[2];
  const questions = [{id:3,question_text:rule.aliases[0],ai_rule:{version:VERSION,answer:rule.answer,note:rule.note,
    items:rule.items.map(([id,points,text])=>({id,points,text}))}}];
  const samples = [['Деньги дал Хованец, поручился Томаш.',5],['Деньги дал Хованец. Кто поручился — не знаем.',3],['Деньги дал Томаш, поручился Хованец.',0]];
  for (const [answer, expected] of samples) {
    const result = await grader.grade({questions,answers:[{question_id:3,answer_text:answer}]});
    const actual = result.grades[0].grade;
    console.log(JSON.stringify({expected,actual,passed:actual===expected,usage:result.usage}));
    if (actual !== expected || result.grades[0].needs_review) throw Object.assign(new Error(), {code:'AI_SMOKE_TEST_FAILED'});
  }
  console.log('AI API check passed. No database changes were made.');
}
main().catch(error => {
  console.error(/^AI_[A-Z0-9_]+$/.test(error.code||'') ? error.code : 'AI_CHECK_FAILED');
  process.exitCode = 1;
});
