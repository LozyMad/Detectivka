'use strict';

const fs = require('node:fs');
const borrowedTime = require('./borrowedTimeGrading');

const STAVKA_VERSION = 'stavka-na-molchanie-2026-11-08-v1';
const STAVKA_V2_VERSION = 'stavka-na-molchanie-2026-11-09-v2';
const normalize = text => String(text || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const scenarioIds = {
  borrowedTime: Number(process.env.AI_BORROWED_TIME_SCENARIO_ID) || null,
  stavka: Number(process.env.AI_STAVKA_SCENARIO_ID) || null
};

function loadStavka(version, rubricPath, policyPath) {
  const rubric = JSON.parse(fs.readFileSync(rubricPath, 'utf8'));
  const document = fs.readFileSync(policyPath, 'utf8');
  const start = document.indexOf('## 1. '), end = document.indexOf('## 5. ');
  if (rubric.version !== version || rubric.questions?.length !== 11 || start < 0 || end <= start ||
      rubric.questions.some(q => !q.aliases?.length || !q.answer || !q.items?.length ||
        new Set(q.items.map(i => i.id)).size !== q.items.length || q.items.some(i => !i.id || !Number.isInteger(i.points) || i.points < 1 || !i.text) ||
        q.items.reduce((sum, item) => sum + item.points, 0) !== 5)) {
    throw new Error('AI_STAVKA_RUBRIC_INVALID');
  }
  return {version, rules: rubric.questions, policy: document.slice(start, end)};
}

const stavkaPolicies = new Map();
let stavka;
if (scenarioIds.stavka && process.env.AI_GRADING_ENABLED === '1') {
  const {AI_STAVKA_RUBRIC_PATH, AI_STAVKA_POLICY_PATH, AI_STAVKA_RUBRIC_V2_PATH, AI_STAVKA_POLICY_V2_PATH} = process.env;
  stavka = loadStavka(STAVKA_VERSION, AI_STAVKA_RUBRIC_PATH, AI_STAVKA_POLICY_PATH);
  stavkaPolicies.set(stavka.version, stavka.policy);
  if (AI_STAVKA_RUBRIC_V2_PATH || AI_STAVKA_POLICY_V2_PATH) {
    stavka = loadStavka(STAVKA_V2_VERSION, AI_STAVKA_RUBRIC_V2_PATH, AI_STAVKA_POLICY_V2_PATH);
    stavkaPolicies.set(stavka.version, stavka.policy);
  }
}

function configured(scenarioId) {
  const id = Number(scenarioId);
  return id > 0 && (id === scenarioIds.borrowedTime || (id === scenarioIds.stavka && !!stavka));
}

function freezeScenarioRubric(scenarioId, questions, productId) {
  const id = Number(scenarioId);
  if (stavka && id === scenarioIds.stavka) {
    if (questions.length !== stavka.rules.length) return null;
    const seen = new Set();
    const frozen = questions.map(question => {
      const rule = stavka.rules.find(candidate => candidate.aliases.some(alias => normalize(alias) === normalize(question.question_text)));
      if (!rule || seen.has(rule.key) || String(question.criteria || '').trim()) return null;
      seen.add(rule.key);
      return {...question, ai_rule: {version: stavka.version, answer: rule.answer, items: rule.items, note: rule.notes.join('\n')}};
    });
    return frozen.every(Boolean) ? frozen : null;
  }
  if (id === scenarioIds.borrowedTime || productId === 'borrowed-time') return borrowedTime.freezeRubric(questions);
  return null;
}

function getStavkaPolicy(version) {
  return stavkaPolicies.get(version);
}

module.exports = {configured, freezeScenarioRubric, STAVKA_VERSION, STAVKA_V2_VERSION, getStavkaPolicy};
