'use strict';

// Real paid API checks. Reads no game database and never publishes player grades.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const dotenv = require(require.resolve('dotenv', {paths: [path.join(root, 'backend')]}));
dotenv.config({path: path.join(root, 'backend/.env')});
dotenv.config({path: path.join(root, 'backend/.env.ai')});
const {rules, freezeRubric, VERSION} = require('../backend/services/borrowedTimeGrading');
const {createYandexGrader, readConfig} = require('../backend/services/yandexGrading');
const fixtures = require('./fixtures/borrowed-time-grading-v4.json');

async function main() {
  const selection = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
  const cases = fixtures.filter(item => !selection || item.name === selection);
  if (!cases.length) throw Object.assign(new Error(), {code: 'AI_UNKNOWN_CHECK_CASE'});
  const config = readConfig({...process.env, AI_GRADING_ENABLED: '1'});
  const grader = createYandexGrader({config});
  // Production database IDs are unrelated to scenario numbering; also vary request order.
  const questions = freezeRubric(rules.map((rule, i) => ({id: 1001 + i * 7, question_text: rule.aliases[0], criteria: ''})));
  const position = new Map(questions.map((q, i) => [q.id, i]));
  const reports = [];
  for (const sample of cases) {
    const result = await grader.grade({questions: [...questions].reverse(), answers: sample.answers.map((answer_text, i) => ({question_id: questions[i].id, answer_text}))});
    const grades = result.grades.map(g => ({...g, question: position.get(g.question_id) + 1, expected: sample.expected[position.get(g.question_id)]})).sort((a, b) => a.question - b.question);
    const report = {name: sample.name, passed: grades.every(g => g.grade === g.expected && !g.needs_review), grades, usage: result.usage};
    reports.push(report);
    console.log(JSON.stringify({name: report.name, passed: report.passed, grades: grades.map(g => ({question: g.question, expected: g.expected, actual: g.grade, needs_review: g.needs_review})), usage: result.usage}));
  }
  const report = {version: VERSION, checked_at: new Date().toISOString(), passed: reports.every(r => r.passed), cases: reports};
  fs.mkdirSync(path.join(root, 'output'), {recursive: true});
  fs.writeFileSync(path.join(root, 'output/ai-semantic-policy-check.json'), JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch(error => {
  console.error(/^AI_[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'AI_SEMANTIC_CHECK_FAILED');
  process.exitCode = 1;
});
