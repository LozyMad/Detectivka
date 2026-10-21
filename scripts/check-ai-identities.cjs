'use strict';
// Paid API regression checks; no game database access or result publication.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const dotenv=require(require.resolve('dotenv',{paths:[path.join(root,'backend')]}));
dotenv.config({path:path.join(root,'backend/.env')});
dotenv.config({path:path.join(root,'backend/.env.ai')});
const {rules,freezeRubric,VERSION}=require('../backend/services/borrowedTimeGrading');
const {createYandexGrader,readConfig}=require('../backend/services/yandexGrading');
const samples=[
  {question:6,answer:'Владелец часов',expected:0},
  {question:6,answer:'Он',expected:0},
  {question:6,answer:'Часовщик',expected:0},
  {question:6,answer:'Кто-то из клиентов',expected:0},
  {question:6,answer:'Мровец',expected:3},
  {question:6,answer:'Константин Мровец',expected:3},
  {question:6,answer:'Хозяин фирмы Практик',expected:3},
  {question:6,answer:'Владелец заложенных Мареком Rolex',expected:3},
  {question:6,answer:'Личность поджигателя не установили. Поджёг, чтобы отомстить Мареку за залог клиентских Rolex.',expected:2},
  {question:2,answer:'Начальник Томаша дал денег, сам Томаш поручился.',expected:5},
  {question:2,answer:'Дал Хованец, кто поручился — не знаю.',expected:3},
  {question:2,answer:'Одолжил Томаш, поручился его начальник.',expected:0}
];
async function main(){
  const frozen=freezeRubric(rules.map((rule,i)=>({id:i+1,question_text:rule.aliases[0],criteria:''})));
  const questions=samples.map((sample,i)=>({...frozen[sample.question],id:7001+i*11}));
  const config=readConfig({...process.env,AI_GRADING_ENABLED:'1'});
  const result=await createYandexGrader({config}).grade({questions,answers:samples.map((sample,i)=>({question_id:questions[i].id,answer_text:sample.answer}))});
  const byId=new Map(result.grades.map(grade=>[grade.question_id,grade]));
  const checks=samples.map((sample,i)=>({answer:sample.answer,expected:sample.expected,...byId.get(questions[i].id)}));
  const report={version:VERSION,passed:checks.every(check=>check.grade===check.expected&&!check.needs_review),checks,usage:result.usage,checked_at:new Date().toISOString()};
  fs.mkdirSync(path.join(root,'output'),{recursive:true});
  fs.writeFileSync(path.join(root,'output/ai-identities-check.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({version:VERSION,passed:report.passed,checks:checks.map(check=>({answer:check.answer,expected:check.expected,actual:check.grade,matched:check.matched,needs_review:check.needs_review})),usage:report.usage}));
  if(!report.passed)process.exitCode=1;
}
main().catch(error=>{console.error(/^AI_[A-Z0-9_]+$/.test(error.code||'')?error.code:'AI_IDENTITIES_CHECK_FAILED');process.exitCode=1;});
