/**
 * Talent multiplier for monthly burn.
 *
 * OpenAPI 0.5.0 is not pushed yet. This module is the client reading of that
 * draft, kept in one place so the shape can change.
 *
 * talentMultiplier is the mean over employees of
 *   deptWeight * (1 + 0.8 * (clamp(skill, 0, 1) - 0.5)).
 * Department weights: tech 1.25, marketing 1.05, sales 0.95.
 * Unknown or null departments use 1. With no employees the multiplier is 1.
 *
 * burnRate = round(2000 * (1 + taxRate * 0.4) * talentMultiplier), rounded
 * once at the end. baseBurnRate = round(2000 * (1 + taxRate * 0.4)).
 * The draft that applied tax twice is not used.
 *
 * API mode uses the company's talentMultiplier when it is present and 1 when
 * it is missing. It does not derive the multiplier from talentCost.
 * There is no baselines.talentMultiplier.
 *
 * OPEN DECISION: triggerTalentCostAffectsBurn. The backend does not let
 * effect.talentCost scale burn. The flag is false for local and API mode.
 */

export const DEPARTMENT_WEIGHTS = Object.freeze({
  tech: 1.25,
  marketing: 1.05,
  sales: 0.95,
});

export const SAMPLE_EMPLOYEES = Object.freeze([
  Object.freeze({ id: 'emp-tech', department: 'tech', skill: 0.5 }),
  Object.freeze({ id: 'emp-marketing', department: 'marketing', skill: 0.5 }),
  Object.freeze({ id: 'emp-sales', department: 'sales', skill: 0.5 }),
]);

function hasAtMostDecimalPlaces(value, places) {
  const factor = 10 ** places;
  const scaled = value * factor;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-6;
}

function clampSkill(skill) {
  if (typeof skill !== 'number' || !Number.isFinite(skill)) {
    throw new TypeError('Employee skill must be a finite number');
  }
  return Math.min(1, Math.max(0, skill));
}

export function departmentWeight(department) {
  if (department == null) return 1;
  const key = String(department).trim().toLowerCase();
  if (key === '') return 1;
  return DEPARTMENT_WEIGHTS[key] ?? 1;
}

export function employeeTalentFactor(employee) {
  const skill = clampSkill(employee?.skill);
  return departmentWeight(employee?.department) * (1 + 0.8 * (skill - 0.5));
}

export function computeTalentMultiplierFromEmployees(employees) {
  if (!Array.isArray(employees) || employees.length === 0) return 1;
  let sum = 0;
  for (const employee of employees) sum += employeeTalentFactor(employee);
  return sum / employees.length;
}

export function talentMixFromEmployees(employees) {
  if (!Array.isArray(employees) || employees.length === 0) return [];
  const groups = new Map();
  for (const employee of employees) {
    const department = employee?.department ?? null;
    const key = department == null ? '\0null' : String(department).trim().toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = {
        department: department == null || String(department).trim() === '' ? null : String(department),
        headcount: 0,
        skillSum: 0,
        weight: departmentWeight(department),
        factorSum: 0,
      };
      groups.set(key, group);
    }
    const skill = clampSkill(employee?.skill);
    group.headcount += 1;
    group.skillSum += skill;
    group.factorSum += employeeTalentFactor({ department, skill });
    groups.set(key, group);
  }
  const total = employees.length;
  return [...groups.values()].map((group) => ({
    department: group.department,
    headcount: group.headcount,
    avgSkill: group.skillSum / group.headcount,
    weight: group.weight,
    contribution: group.factorSum / total,
  }));
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
    department: row.department == null ? null : String(row.department),
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

export function triggerTalentCostAffectsBurn(dataSource) {
  switch (dataSource) {
    case 'local':
    case 'api':
      return false;
    default: {
      const neverSource = dataSource;
      throw new Error(`Unknown data source: ${String(neverSource)}`);
    }
  }
}

export function burnMultiplier({ talentMultiplier = 1, talentCostFactor = 1, affectsBurn = false } = {}) {
  if (!affectsBurn) return talentMultiplier;
  return talentMultiplier * talentCostFactor;
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
  const text = Number(multiplier).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (!text.includes('.')) return `${text}.00`;
  if (text.split('.')[1].length === 1) return `${text}0`;
  return text;
}

export function talentMultiplierOf(state) {
  const dataSource = state?.dataSource === 'api' ? 'api' : 'local';
  if (dataSource === 'api') {
    return computeTalentMultiplier({
      talentMultiplier: state?.talentMultiplier,
      dataSource: 'api',
    });
  }
  return computeTalentMultiplier({ employees: state?.employees, dataSource: 'local' });
}

export function talentMixOf(state) {
  if (state?.dataSource === 'api') return Array.isArray(state.talentMix) ? state.talentMix : [];
  if (Array.isArray(state?.employees) && state.employees.length > 0) {
    return talentMixFromEmployees(state.employees);
  }
  return [];
}

export function effectiveBurnRate(state) {
  const dataSource = state?.dataSource === 'api' ? 'api' : 'local';
  const multiplier = burnMultiplier({
    talentMultiplier: talentMultiplierOf(state),
    talentCostFactor: talentCostFactor(state?.company?.talentCost, state?.baselines?.talentCost),
    affectsBurn: triggerTalentCostAffectsBurn(dataSource),
  });
  return burnRateFromMultiplier(state?.taxRate ?? 0, multiplier);
}
