import { roundTo } from './triggerContract.js';

// Employee talent multiplier for burn.
//
// Per employee: departmentWeight * skillFactor.
// skillFactor is linear: 1 + 0.8 * (clamp(skill, 0, 1) - 0.5).
// Skill 0.5 is 1x, skill 1 is 1.4x, and skill 0 is 0.6x.
// A null or non-finite skill uses the column default 0.5 before that clamp.
//
// Department weights: tech 1.25, marketing 1.05, sales 0.95.
// Any other department, including NULL or blank, weighs 1.
// Tech reads skill_tech, marketing reads skill_marketing, and sales reads
// skill_sales. An unknown department uses the mean of those three skills.
//
// The company multiplier is the mean of the per-employee factors, so
// headcount does not scale burn beyond its effect on that mean. No employees
// is exactly 1. Inactive employees (is_active / isActive false) are left out.
//
// talentMix groups that mean by department. contribution is the group's share
// of the multiplier. Shares are rounded to 4 decimal places, and the last
// group in display order absorbs the residual so the shares sum to
// talentMultiplier when the mix is non-empty. An empty mix means
// talentMultiplier is exactly 1. Display order is tech, marketing, sales,
// then other names A-Z, then NULL.
//
// talentMultiplier stays that employee mean. Trigger talent cost does not
// scale it or the mix. talentCostFactor is talentCost / baselines.talentCost.
// It is 1 when there is no movement from the baseline, the baseline is
// missing, or the baseline is 0. A stacked talent cost of 0 (the -5 delta
// floors the dollar cost at 0) makes the factor 0, and burn becomes 0.
// effectiveMultiplier is the product. Both factors are finite and >= 0.

export const BASE_MONTHLY_BURN = 2000;

const DEPARTMENT_WEIGHTS = Object.freeze({
  tech: 1.25,
  marketing: 1.05,
  sales: 0.95
});
const DEPARTMENT_ORDER = Object.freeze(['tech', 'marketing', 'sales']);
const UNKNOWN_DEPARTMENT_WEIGHT = 1;

export function clampSkill(skill) {
  if (skill == null || skill === '') return 0.5;
  const numeric = Number(skill);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.min(1, Math.max(0, numeric));
}

export function skillFactor(skill) {
  return 1 + 0.8 * (clampSkill(skill) - 0.5);
}

export function departmentWeight(department) {
  const key = canonicalDepartment(department);
  if (key == null) return UNKNOWN_DEPARTMENT_WEIGHT;
  return DEPARTMENT_WEIGHTS[key] ?? UNKNOWN_DEPARTMENT_WEIGHT;
}

function canonicalDepartment(department) {
  if (typeof department !== 'string') return null;
  const key = department.trim().toLowerCase();
  return key.length === 0 ? null : key;
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
  if (department === 'marketing') {
    return readSkill(employee, ['skillMarketing', 'skill_marketing']);
  }
  if (department === 'sales') return readSkill(employee, ['skillSales', 'skill_sales']);
  const parts = [
    readSkill(employee, ['skillTech', 'skill_tech']),
    readSkill(employee, ['skillMarketing', 'skill_marketing']),
    readSkill(employee, ['skillSales', 'skill_sales'])
  ].map((skill) => clampSkill(skill));
  return (parts[0] + parts[1] + parts[2]) / 3;
}

function isCounted(employee) {
  return employee.isActive !== false && employee.is_active !== false;
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
    contribution: fromMilli(milli(group.contribution))
  }));
  const assigned = rounded.reduce((sum, group) => sum + milli(group.contribution), 0);
  const last = rounded[rounded.length - 1];
  last.contribution = fromMilli(milli(last.contribution) + (target - assigned));
  return rounded;
}

function profileFromEmployees(employees) {
  const roster = Array.isArray(employees) ? employees.filter(isCounted) : [];
  if (roster.length === 0) {
    return { talentMultiplier: 1, talentMix: [] };
  }

  const scored = roster.map((employee) => {
    const department = canonicalDepartment(employee.department);
    const skill = clampSkill(skillForEmployee(employee, department));
    return {
      department,
      skill,
      factor: departmentWeight(department) * skillFactor(skill)
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
      weight: departmentWeight(employee.department)
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
      contribution: group.factorTotal / scored.length
    })),
    talentMultiplier
  );
  return { talentMultiplier, talentMix };
}

export function composeTalentMultiplier({ employees } = {}) {
  return profileFromEmployees(employees);
}

function nonNegativeFinite(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
}

export function talentCostFactor(talentCost, baselineTalentCost) {
  const baseline = Number(baselineTalentCost);
  if (baselineTalentCost == null || baselineTalentCost === '') return 1;
  if (!Number.isFinite(baseline) || baseline <= 0) return 1;
  if (talentCost == null || talentCost === '') return 1;
  const cost = Number(talentCost);
  if (!Number.isFinite(cost)) return 1;
  if (cost <= 0) return 0;
  const factor = cost / baseline;
  if (!Number.isFinite(factor) || factor < 0) return 0;
  return roundTo(factor, 4);
}

export function effectiveMultiplier(talentMultiplier, costFactor) {
  const employee = nonNegativeFinite(talentMultiplier, 1);
  const factor = nonNegativeFinite(costFactor, 1);
  const product = employee * factor;
  if (!Number.isFinite(product) || product < 0) return 0;
  return roundTo(product, 4);
}

function publishedFactor(costFactor) {
  const factor = nonNegativeFinite(costFactor, 1);
  if (factor === 0) return 0;
  return roundTo(factor, 4);
}

export function burnFromTax(taxRate, talentMultiplier, costFactor = 1) {
  const rate = Number(taxRate);
  const safeRate = Number.isFinite(rate) ? rate : 0;
  const taxTerm = BASE_MONTHLY_BURN * (1 + safeRate * 0.4);
  const employee = nonNegativeFinite(talentMultiplier, 1);
  const factor = publishedFactor(costFactor);
  return {
    baseBurnRate: Math.round(taxTerm),
    burnRate: Math.round(taxTerm * employee * factor),
    talentCostFactor: factor,
    effectiveMultiplier: effectiveMultiplier(employee, factor)
  };
}

export function burnFromBase(baseBurnRate, talentMultiplier, costFactor = 1) {
  const base = Number(baseBurnRate);
  const safeBase = Number.isFinite(base) ? base : 0;
  const employee = nonNegativeFinite(talentMultiplier, 1);
  const factor = publishedFactor(costFactor);
  const effective = effectiveMultiplier(employee, factor);
  return {
    baseBurnRate: safeBase,
    burnRate: Math.round(safeBase * effective),
    talentCostFactor: factor,
    effectiveMultiplier: effective
  };
}
