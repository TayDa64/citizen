/**
 * Employee talent multiplier for burn. Matches OpenAPI 0.5.0 on PR #6.
 *
 * Per employee: departmentWeight * skillFactor.
 * skillFactor = 1 + 0.8 * (clamp(skill, 0, 1) - 0.5).
 * Skill 0.5 is 1x, skill 1 is 1.4x, and skill 0 is 0.6x.
 * A null or non-finite skill uses 0.5 before that clamp.
 *
 * Weights: tech 1.25, marketing 1.05, sales 0.95, and 1 for any other
 * department, including null or blank. Tech reads skill_tech, marketing
 * reads skill_marketing, and sales reads skill_sales. Another department
 * uses the mean of those three skills.
 *
 * The company multiplier is the mean of the active employees, rounded to
 * 4 decimal places. No employees is exactly 1. Inactive employees are left
 * out. talentMix groups that mean. contribution is the group's share,
 * rounded to 4 decimal places, and the last group absorbs the residual so
 * the shares sum to talentMultiplier. Order is tech, marketing, sales,
 * then other names A–Z, then null.
 *
 * API mode uses company.talentMultiplier when it is present and 1 when it
 * is missing. It does not derive the multiplier from talent cost.
 * There is no baselines.talentMultiplier.
 *
 * burnRate = round(2000 * (1 + taxRate * 0.4) * talentMultiplier), rounded
 * once. baseBurnRate = round(2000 * (1 + taxRate * 0.4)).
 *
 * OPEN DECISION: APPLY_TALENT_COST_TO_BURN. The backend does not let
 * effect.talentCost scale burn. When the flag is true, the multiplier is
 * also multiplied by talentCost / baselines.talentCost.
 */

export const APPLY_TALENT_COST_TO_BURN = false;

export const DEPARTMENT_WEIGHTS = Object.freeze({
  tech: 1.25,
  marketing: 1.05,
  sales: 0.95,
});

const DEPARTMENT_ORDER = Object.freeze(['tech', 'marketing', 'sales']);

export const SAMPLE_EMPLOYEES = Object.freeze([
  Object.freeze({ id: 'emp-tech', department: 'tech', skillTech: 0.5, isActive: true }),
  Object.freeze({ id: 'emp-marketing', department: 'marketing', skillMarketing: 0.5, isActive: true }),
  Object.freeze({ id: 'emp-sales', department: 'sales', skillSales: 0.5, isActive: true }),
]);

function roundTo(value, places) {
  const factor = 10 ** places;
  return Math.round((value + Math.sign(value) * 1e-10) * factor) / factor;
}

function hasAtMostDecimalPlaces(value, places) {
  const factor = 10 ** places;
  const scaled = value * factor;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-6;
}

export function clampSkill(skill) {
  if (skill == null || skill === '') return 0.5;
  const numeric = Number(skill);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.min(1, Math.max(0, numeric));
}

export function skillFactor(skill) {
  return 1 + 0.8 * (clampSkill(skill) - 0.5);
}

function canonicalDepartment(department) {
  if (typeof department !== 'string') return null;
  const key = department.trim().toLowerCase();
  return key.length === 0 ? null : key;
}

export function departmentWeight(department) {
  const key = canonicalDepartment(department);
  if (key == null) return 1;
  return DEPARTMENT_WEIGHTS[key] ?? 1;
}

function readSkill(employee, names) {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(employee, name)) continue;
    if (employee[name] == null || employee[name] === '') continue;
    return employee[name];
  }
  return null;
}

function skillForEmployee(employee, department) {
  if (department === 'tech') return readSkill(employee, ['skillTech', 'skill_tech']);
  if (department === 'marketing') return readSkill(employee, ['skillMarketing', 'skill_marketing']);
  if (department === 'sales') return readSkill(employee, ['skillSales', 'skill_sales']);
  const parts = [
    readSkill(employee, ['skillTech', 'skill_tech']),
    readSkill(employee, ['skillMarketing', 'skill_marketing']),
    readSkill(employee, ['skillSales', 'skill_sales']),
  ].map((skill) => clampSkill(skill));
  return (parts[0] + parts[1] + parts[2]) / 3;
}

function isCounted(employee) {
  return employee?.isActive !== false && employee?.is_active !== false;
}

function milli(value) {
  return Math.round((value + Math.sign(value) * 1e-10) * 10000);
}

function fromMilli(value) {
  return value / 10000;
}

function compareDepartments(left, right) {
  const leftRank = left == null ? DEPARTMENT_ORDER.length + 1 : DEPARTMENT_ORDER.indexOf(left);
  const rightRank = right == null ? DEPARTMENT_ORDER.length + 1 : DEPARTMENT_ORDER.indexOf(right);
  const leftOrder = leftRank === -1 ? DEPARTMENT_ORDER.length : leftRank;
  const rightOrder = rightRank === -1 ? DEPARTMENT_ORDER.length : rightRank;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function absorbContributions(groups, talentMultiplier) {
  if (groups.length === 0) return [];
  const target = milli(talentMultiplier);
  const rounded = groups.map((group) => ({
    department: group.department,
    headcount: group.headcount,
    avgSkill: roundTo(group.avgSkill, 4),
    weight: group.weight,
    contribution: fromMilli(milli(group.contribution)),
  }));
  const assigned = rounded.reduce((sum, group) => sum + milli(group.contribution), 0);
  const last = rounded[rounded.length - 1];
  last.contribution = fromMilli(milli(last.contribution) + (target - assigned));
  return rounded;
}

function profileFromEmployees(employees) {
  const roster = Array.isArray(employees) ? employees.filter(isCounted) : [];
  if (roster.length === 0) return { talentMultiplier: 1, talentMix: [] };

  const scored = roster.map((employee) => {
    const department = canonicalDepartment(employee.department);
    const skill = clampSkill(skillForEmployee(employee, department));
    return {
      department,
      skill,
      factor: departmentWeight(department) * skillFactor(skill),
    };
  });
  const total = scored.reduce((sum, employee) => sum + employee.factor, 0);
  const talentMultiplier = roundTo(total / scored.length, 4);
  const groups = new Map();
  for (const employee of scored) {
    const key = employee.department ?? '';
    const group = groups.get(key) ?? {
      department: employee.department,
      headcount: 0,
      skillTotal: 0,
      factorTotal: 0,
      weight: departmentWeight(employee.department),
    };
    group.headcount += 1;
    group.skillTotal += employee.skill;
    group.factorTotal += employee.factor;
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((left, right) =>
    compareDepartments(left.department, right.department)
  );
  const talentMix = absorbContributions(
    ordered.map((group) => ({
      department: group.department,
      headcount: group.headcount,
      avgSkill: group.skillTotal / group.headcount,
      weight: group.weight,
      contribution: group.factorTotal / scored.length,
    })),
    talentMultiplier
  );
  return { talentMultiplier, talentMix };
}

export function scaleTalentMultiplier(profile, triggerFactor) {
  if (!Number.isFinite(triggerFactor) || triggerFactor < 0) {
    throw new TypeError('triggerFactor must be a finite number >= 0');
  }
  const talentMultiplier = roundTo(profile.talentMultiplier * triggerFactor, 4);
  const talentMix = absorbContributions(
    profile.talentMix.map((group) => ({
      ...group,
      contribution: group.contribution * triggerFactor,
    })),
    talentMultiplier
  );
  return { talentMultiplier, talentMix };
}

export function composeTalentMultiplier({ employees, triggerFactor = 1 } = {}) {
  const profile = profileFromEmployees(employees);
  if (!APPLY_TALENT_COST_TO_BURN) return profile;
  return scaleTalentMultiplier(profile, triggerFactor);
}

export function computeTalentMultiplierFromEmployees(employees) {
  return composeTalentMultiplier({ employees }).talentMultiplier;
}

export function talentMixFromEmployees(employees) {
  return composeTalentMultiplier({ employees }).talentMix;
}

export function readTalentMultiplier(value) {
  if (value == null) return 1;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError('talentMultiplier must be a finite number >= 0');
  }
  if (!hasAtMostDecimalPlaces(value, 4)) {
    throw new TypeError('talentMultiplier must have at most 4 decimal places');
  }
  return value;
}

function readDepartment(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new TypeError('talentMix department must be a string or null');
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readTalentMixRow(row) {
  if (row == null || typeof row !== 'object' || Array.isArray(row)) {
    throw new TypeError('talentMix entry must be an object');
  }
  const headcount = Number(row.headcount);
  const avgSkill = Number(row.avgSkill);
  const weight = Number(row.weight);
  const contribution = Number(row.contribution);
  if (!Number.isFinite(headcount) || headcount < 0) {
    throw new TypeError('talentMix headcount must be a finite number >= 0');
  }
  if (!Number.isFinite(avgSkill)) throw new TypeError('talentMix avgSkill must be finite');
  if (!Number.isFinite(weight) || weight < 0 || !hasAtMostDecimalPlaces(weight, 4)) {
    throw new TypeError('talentMix weight must be a finite number >= 0 with at most 4 decimal places');
  }
  if (!Number.isFinite(contribution) || !hasAtMostDecimalPlaces(contribution, 4)) {
    throw new TypeError('talentMix contribution must be a finite number with at most 4 decimal places');
  }
  return {
    department: readDepartment(row.department),
    headcount,
    avgSkill,
    weight,
    contribution,
  };
}

export function readTalentMix(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError('talentMix must be an array');
  return value.map(readTalentMixRow);
}

export function computeTalentMultiplier({ employees, talentMultiplier, dataSource = 'local' } = {}) {
  switch (dataSource) {
    case 'api':
      return readTalentMultiplier(talentMultiplier);
    case 'local':
      return computeTalentMultiplierFromEmployees(employees);
    default: {
      const neverSource = dataSource;
      throw new Error(`Unknown data source: ${String(neverSource)}`);
    }
  }
}

export function burnMultiplier({ talentMultiplier = 1, talentCostFactor: factor = 1, affectsBurn = false } = {}) {
  if (!affectsBurn) return talentMultiplier;
  return talentMultiplier * factor;
}

export function talentCostFactor(talentCost, baselineTalentCost) {
  const current = Number(talentCost);
  const baseline = Number(baselineTalentCost);
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return 1;
  return current / baseline;
}

export function baseBurnRate(taxRate) {
  return Math.round(2000 * (1 + taxRate * 0.4));
}

export function burnRateFromMultiplier(taxRate, talentMultiplier) {
  return Math.round(2000 * (1 + taxRate * 0.4) * talentMultiplier);
}

export function formatTalentReadout(multiplier) {
  const value = Number(multiplier);
  if (!Number.isFinite(value)) return '1.0000';
  return value.toFixed(4);
}

function triggerFactorOf(state) {
  return talentCostFactor(state?.company?.talentCost, state?.baselines?.talentCost);
}

export function talentMultiplierOf(state) {
  if (state?.dataSource === 'api') {
    const base = readTalentMultiplier(state?.talentMultiplier);
    if (!APPLY_TALENT_COST_TO_BURN) return base;
    return roundTo(base * triggerFactorOf(state), 4);
  }
  return composeTalentMultiplier({
    employees: state?.employees,
    triggerFactor: triggerFactorOf(state),
  }).talentMultiplier;
}

export function talentMixOf(state) {
  if (state?.dataSource === 'api') {
    const mix = Array.isArray(state.talentMix) ? state.talentMix : [];
    if (!APPLY_TALENT_COST_TO_BURN) return mix;
    return scaleTalentMultiplier(
      { talentMultiplier: readTalentMultiplier(state?.talentMultiplier), talentMix: mix },
      triggerFactorOf(state)
    ).talentMix;
  }
  return composeTalentMultiplier({
    employees: state?.employees,
    triggerFactor: triggerFactorOf(state),
  }).talentMix;
}

export function effectiveBurnRate(state) {
  return burnRateFromMultiplier(state?.taxRate ?? 0, talentMultiplierOf(state));
}
