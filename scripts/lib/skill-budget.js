'use strict';

/**
 * Measure and filter ECC skill listings against host context-window budgets (#2694).
 */

function parseSkillList(raw) {
  if (!raw || typeof raw !== 'string') return new Set();
  return new Set(
    raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
}

function filterSkills(skills, env = process.env) {
  const enabled = parseSkillList(env.ECC_ENABLED_SKILLS);
  const disabled = parseSkillList(env.ECC_DISABLED_SKILLS);
  return skills.filter((skill) => {
    const id = String(skill.name || skill.id || '').toLowerCase();
    if (!id) return false;
    if (disabled.has(id)) return false;
    if (enabled.size > 0 && !enabled.has(id)) return false;
    return true;
  });
}

function measureSkillBudget(skills, contextWindowTokens = 200000) {
  const totalChars = skills.reduce((sum, s) => {
    return sum + String(s.name || '').length + String(s.description || '').length;
  }, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  const budgetTokens = Math.floor(contextWindowTokens * 0.01);
  return {
    skillCount: skills.length,
    totalChars,
    estimatedTokens,
    budgetTokens,
    withinBudget: estimatedTokens <= budgetTokens,
  };
}

module.exports = { parseSkillList, filterSkills, measureSkillBudget };
