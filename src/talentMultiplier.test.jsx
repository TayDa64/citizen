import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import Dashboard from './components/Dashboard';
import {
  SAMPLE_EMPLOYEES,
  baseBurnRate,
  burnMultiplier,
  burnRateFromMultiplier,
  computeTalentMultiplier,
  departmentWeight,
  employeeTalentFactor,
  formatTalentReadout,
  readTalentMix,
  readTalentMultiplier,
  talentMixFromEmployees,
  triggerTalentCostAffectsBurn,
} from './talentMultiplier';

describe('department weights and skill', () => {
  test('uses tech 1.25, marketing 1.05, sales 0.95, and 1 for unknown or null', () => {
    expect(departmentWeight('tech')).toBe(1.25);
    expect(departmentWeight('Tech')).toBe(1.25);
    expect(departmentWeight('marketing')).toBe(1.05);
    expect(departmentWeight('sales')).toBe(0.95);
    expect(departmentWeight('finance')).toBe(1);
    expect(departmentWeight(null)).toBe(1);
    expect(departmentWeight(undefined)).toBe(1);
  });

  test('clamps skill to 0..1 before the 0.8 slope', () => {
    expect(employeeTalentFactor({ department: 'tech', skill: 0.5 })).toBeCloseTo(1.25, 10);
    expect(employeeTalentFactor({ department: 'tech', skill: 2 })).toBeCloseTo(1.25 * 1.4, 10);
    expect(employeeTalentFactor({ department: 'tech', skill: -1 })).toBeCloseTo(1.25 * 0.6, 10);
    expect(employeeTalentFactor({ department: null, skill: 0 })).toBeCloseTo(0.6, 10);
    expect(employeeTalentFactor({ department: 'Finance', skill: 1 })).toBeCloseTo(1.4, 10);
  });

  test('rejects a non-finite skill', () => {
    expect(() => employeeTalentFactor({ department: 'tech', skill: Number.NaN })).toThrow(TypeError);
  });
});

describe('computeTalentMultiplier', () => {
  test('is exactly 1 with no employees', () => {
    expect(computeTalentMultiplier({ employees: [], dataSource: 'local' })).toBe(1);
    expect(computeTalentMultiplier({ employees: undefined, dataSource: 'local' })).toBe(1);
  });

  test('is the mean of employee factors', () => {
    const employees = [
      { department: 'tech', skill: 0.5 },
      { department: 'sales', skill: 0.5 },
    ];
    expect(computeTalentMultiplier({ employees, dataSource: 'local' })).toBeCloseTo((1.25 + 0.95) / 2, 10);
  });

  test('sample employees are the local mock roster', () => {
    expect(SAMPLE_EMPLOYEES.length).toBeGreaterThan(0);
    const multiplier = computeTalentMultiplier({ employees: SAMPLE_EMPLOYEES, dataSource: 'local' });
    expect(multiplier).toBeGreaterThan(0);
    const mix = talentMixFromEmployees(SAMPLE_EMPLOYEES);
    const contributionSum = mix.reduce((sum, row) => sum + row.contribution, 0);
    expect(contributionSum).toBeCloseTo(multiplier, 10);
    expect(mix.map((row) => row.department)).toEqual(expect.arrayContaining(['tech', 'marketing', 'sales']));
  });

  test('API mode uses talentMultiplier and does not derive it from talent cost', () => {
    expect(computeTalentMultiplier({ dataSource: 'api' })).toBe(1);
    expect(computeTalentMultiplier({ dataSource: 'api', talentMultiplier: undefined })).toBe(1);
    expect(computeTalentMultiplier({
      dataSource: 'api',
      talentMultiplier: 1.28,
      talentCost: 4480,
      baselineTalentCost: 4000,
    })).toBe(1.28);
  });

  test('rejects an invalid talentMultiplier and accepts 4 decimal places', () => {
    expect(readTalentMultiplier(undefined)).toBe(1);
    expect(readTalentMultiplier(null)).toBe(1);
    expect(readTalentMultiplier(0)).toBe(0);
    expect(readTalentMultiplier(1.1234)).toBe(1.1234);
    expect(() => readTalentMultiplier(-0.1)).toThrow(TypeError);
    expect(() => readTalentMultiplier(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => readTalentMultiplier(1.12345)).toThrow(/4 decimal places/);
    expect(() => readTalentMix([{ department: 'tech' }])).toThrow(TypeError);
  });
});

describe('burn rate', () => {
  test('at multiplier 1 is 2000, 2200, and 2800 for tax 0, 0.25, and 1', () => {
    expect(baseBurnRate(0)).toBe(2000);
    expect(baseBurnRate(0.25)).toBe(2200);
    expect(baseBurnRate(1)).toBe(2800);
    expect(burnRateFromMultiplier(0, 1)).toBe(2000);
    expect(burnRateFromMultiplier(0.25, 1)).toBe(2200);
    expect(burnRateFromMultiplier(1, 1)).toBe(2800);
  });

  test('rounds only after tax and the talent multiplier', () => {
    const taxRate = 0.333;
    const talentMultiplier = 1.01;
    expect(burnRateFromMultiplier(taxRate, talentMultiplier)).toBe(
      Math.round(2000 * (1 + taxRate * 0.4) * talentMultiplier)
    );
    expect(baseBurnRate(taxRate)).toBe(Math.round(2000 * (1 + taxRate * 0.4)));
  });

  test('trigger talent cost stays off in both modes and can be turned on', () => {
    expect(triggerTalentCostAffectsBurn('local')).toBe(false);
    expect(triggerTalentCostAffectsBurn('api')).toBe(false);
    expect(() => triggerTalentCostAffectsBurn('remote')).toThrow(/unknown data source/i);

    const off = burnRateFromMultiplier(0.25, burnMultiplier({
      talentMultiplier: 1,
      talentCostFactor: 1.12,
      affectsBurn: triggerTalentCostAffectsBurn('local'),
    }));
    const on = burnRateFromMultiplier(0.25, burnMultiplier({
      talentMultiplier: 1,
      talentCostFactor: 1.12,
      affectsBurn: true,
    }));
    expect(off).toBe(2200);
    expect(on).toBe(2464);
    expect(burnRateFromMultiplier(0.25, burnMultiplier({
      talentMultiplier: 1,
      talentCostFactor: 4480 / 4000,
      affectsBurn: true,
    }))).toBe(2464);
  });
});

describe('talent burn readout', () => {
  test('shows effective burn, the talent factor, base burn, and the mix table', () => {
    const employees = [{ department: 'tech', skill: 0.53 }];
    render(
      <Dashboard
        state={{
          taxRate: 0.25,
          dataSource: 'local',
          employees,
          talentMix: [],
          company: { cash: 15000, burnRate: 2000, hype: 0.3, talentCost: 1, productQuality: 0.4 },
          baselines: { hype: 0.3, talentCost: 1 },
          history: { cash: [15000], burnRate: [2000] },
          activeTriggers: [],
        }}
      />
    );

    const section = screen.getByRole('region', { name: 'Talent and burn' });
    expect(section).toHaveTextContent('Effective burn $2,816');
    expect(section).toHaveTextContent(`×${formatTalentReadout(1.28)} talent`);
    expect(section).toHaveTextContent(/base burn \$2,200/i);
    expect(formatTalentReadout(1.28)).toBe('1.28');

    const table = within(section).getByRole('table', { name: 'Talent mix' });
    expect(within(table).getByRole('columnheader', { name: 'Department' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Headcount' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Avg skill' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Weight' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Contribution' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'tech' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '1' })).toBeInTheDocument();
  });
});
