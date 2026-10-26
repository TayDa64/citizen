import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import Dashboard from './components/Dashboard';
import {
  APPLY_TALENT_COST_TO_BURN,
  SAMPLE_EMPLOYEES,
  baseBurnRate,
  burnMultiplier,
  burnRateFromMultiplier,
  composeTalentMultiplier,
  computeTalentMultiplier,
  departmentWeight,
  formatTalentReadout,
  readTalentMix,
  readTalentMultiplier,
  effectiveBurnRate,
  effectiveMultiplierOf,
  scaleTalentMultiplier,
  skillFactor,
  talentCostFactorOf,
  talentMixFromEmployees,
  talentMultiplierOf,
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

  test('skill 0 is 0.6x, skill 0.5 is 1x, and skill 1 is 1.4x', () => {
    expect(skillFactor(0)).toBe(0.6);
    expect(skillFactor(0.5)).toBe(1);
    expect(skillFactor(1)).toBe(1.4);
    expect(skillFactor(-1)).toBe(0.6);
    expect(skillFactor(2)).toBe(1.4);
    expect(skillFactor(null)).toBe(1);
    expect(skillFactor(Number.NaN)).toBe(1);
  });
});

describe('computeTalentMultiplier', () => {
  test('is exactly 1 with no employees', () => {
    expect(computeTalentMultiplier({ employees: [], dataSource: 'local' })).toBe(1);
    expect(computeTalentMultiplier({ employees: undefined, dataSource: 'local' })).toBe(1);
  });

  test('four tech employees at skill 1 are 1.75, and other departments use their own skills', () => {
    const tech = composeTalentMultiplier({
      employees: [
        { department: 'tech', skillTech: 1 },
        { department: 'Tech', skill_tech: 1 },
        { department: 'tech', skillTech: 1 },
        { department: 'tech', skillTech: 1 },
      ],
    });
    expect(tech.talentMultiplier).toBe(1.75);
    expect(tech.talentMix).toEqual([
      { department: 'tech', headcount: 4, avgSkill: 1, weight: 1.25, contribution: 1.75 },
    ]);
    expect(composeTalentMultiplier({
      employees: [{ department: 'marketing', skillMarketing: 0.5 }],
    }).talentMultiplier).toBe(1.05);
    expect(composeTalentMultiplier({
      employees: [{ department: 'sales', skillSales: 0.5 }],
    }).talentMultiplier).toBe(0.95);
    expect(composeTalentMultiplier({
      employees: [{ department: 'tech', skillTech: -3 }],
    }).talentMultiplier).toBe(0.75);
    expect(composeTalentMultiplier({
      employees: [{ department: null, skillTech: 0, skillMarketing: 0, skillSales: 0 }],
    }).talentMultiplier).toBe(0.6);
  });

  test('a null skill is 0.5, a blank department is null, and inactive employees are left out', () => {
    const missing = composeTalentMultiplier({
      employees: [{ department: '  ', skillTech: null, skillMarketing: null, skillSales: null }],
    });
    expect(missing.talentMultiplier).toBe(1);
    expect(missing.talentMix[0]).toMatchObject({ department: null, weight: 1, avgSkill: 0.5, headcount: 1 });

    const inactive = composeTalentMultiplier({
      employees: [
        { department: 'tech', skillTech: 1, isActive: true },
        { department: 'sales', skillSales: 1, is_active: false },
      ],
    });
    expect(inactive.talentMultiplier).toBe(1.75);
    expect(inactive.talentMix).toHaveLength(1);
  });

  test('other departments use the mean of the three skills, and the last share absorbs the residual', () => {
    const other = composeTalentMultiplier({
      employees: [{ department: 'ops', skillTech: 1, skillMarketing: 1, skillSales: 0 }],
    });
    expect(other.talentMultiplier).toBe(1.1333);
    expect(other.talentMix[0].department).toBe('ops');
    expect(other.talentMix[0].weight).toBe(1);

    const thirds = composeTalentMultiplier({
      employees: [
        { department: 'c', skillTech: 0.5, skillMarketing: 0.5, skillSales: 0.5 },
        { department: 'a', skillTech: 0.5, skillMarketing: 0.5, skillSales: 0.5 },
        { department: 'b', skillTech: 0.5, skillMarketing: 0.5, skillSales: 0.5 },
      ],
    });
    expect(thirds.talentMultiplier).toBe(1);
    expect(thirds.talentMix.map((group) => group.department)).toEqual(['a', 'b', 'c']);
    expect(thirds.talentMix.map((group) => group.contribution)).toEqual([0.3333, 0.3333, 0.3334]);
    const sum = thirds.talentMix.reduce((total, group) => total + group.contribution, 0);
    expect(Math.round(sum * 10000) / 10000).toBe(thirds.talentMultiplier);
  });

  test('sample employees use department skills and their contributions sum to the multiplier', () => {
    expect(SAMPLE_EMPLOYEES.length).toBeGreaterThan(0);
    const profile = composeTalentMultiplier({ employees: SAMPLE_EMPLOYEES });
    expect(profile.talentMultiplier).toBe(1.0833);
    const mix = talentMixFromEmployees(SAMPLE_EMPLOYEES);
    expect(mix.map((row) => row.department)).toEqual(['tech', 'marketing', 'sales']);
    expect(mix.map((row) => row.contribution)).toEqual([0.4167, 0.35, 0.3166]);
    const contributionSum = mix.reduce((sum, row) => sum + row.contribution, 0);
    expect(Math.round(contributionSum * 10000) / 10000).toBe(profile.talentMultiplier);
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

  test('trigger talent cost scales burn and the employee multiplier stays unscaled', () => {
    expect(APPLY_TALENT_COST_TO_BURN).toBe(true);
    const tech = composeTalentMultiplier({
      employees: [{ department: 'tech', skillTech: 1 }],
      triggerFactor: 2,
    });
    expect(tech.talentMultiplier).toBe(1.75);
    const scaled = scaleTalentMultiplier(tech, 1.12);
    expect(scaled.talentMultiplier).toBe(1.96);
    expect(scaled.talentMix[0].contribution).toBe(1.96);

    const on = burnRateFromMultiplier(0.25, burnMultiplier({
      talentMultiplier: 1,
      talentCostFactor: 1.12,
      affectsBurn: APPLY_TALENT_COST_TO_BURN,
    }));
    expect(on).toBe(2464);
    expect(burnRateFromMultiplier(0.25, burnMultiplier({
      talentMultiplier: 1,
      talentCostFactor: 4480 / 4000,
      affectsBurn: true,
    }))).toBe(2464);
    expect(burnRateFromMultiplier(0.25, burnMultiplier({
      talentMultiplier: 1,
      talentCostFactor: 1.12,
      affectsBurn: false,
    }))).toBe(2200);
  });

  test('rounds base times the effective multiplier once', () => {
    const quiet = {
      dataSource: 'local',
      employees: [],
      company: { talentCost: 1 },
      baselines: { talentCost: 1 },
    };
    expect(effectiveBurnRate({ ...quiet, taxRate: 0 })).toBe(2000);
    expect(effectiveBurnRate({ ...quiet, taxRate: 0.25 })).toBe(2200);
    expect(effectiveBurnRate({ ...quiet, taxRate: 1 })).toBe(2800);

    const policy = {
      ...quiet,
      company: { talentCost: 1.12 },
    };
    expect(effectiveBurnRate({ ...policy, taxRate: 0 })).toBe(2240);
    expect(effectiveBurnRate({ ...policy, taxRate: 0.25 })).toBe(2464);

    const tech = [
      { department: 'tech', skillTech: 1 },
      { department: 'tech', skillTech: 1 },
      { department: 'tech', skillTech: 1 },
      { department: 'tech', skillTech: 1 },
    ];
    const staffed = {
      dataSource: 'local',
      taxRate: 1,
      employees: tech,
      company: { talentCost: 1.12 },
      baselines: { talentCost: 1 },
    };
    expect(talentMultiplierOf(staffed)).toBe(1.75);
    expect(talentCostFactorOf(staffed)).toBeCloseTo(1.12);
    expect(effectiveMultiplierOf(staffed)).toBeCloseTo(1.96);
    expect(effectiveBurnRate(staffed)).toBe(5488);

    const server = {
      dataSource: 'api',
      taxRate: 1,
      talentMultiplier: 1.75,
      talentCostFactor: 1.12,
      effectiveMultiplier: 1.96,
      company: { talentCost: 999 },
      baselines: { talentCost: 4000 },
    };
    expect(talentCostFactorOf(server)).toBe(1.12);
    expect(effectiveMultiplierOf(server)).toBe(1.96);
    expect(effectiveBurnRate(server)).toBe(5488);
    expect(effectiveBurnRate({ ...server, effectiveMultiplier: 2 })).toBe(5600);

    const legacy = {
      dataSource: 'api',
      talentMultiplier: 1,
      company: { talentCost: 4480 },
      baselines: { talentCost: 4000 },
    };
    expect(talentCostFactorOf(legacy)).toBeCloseTo(1.12);
    expect(effectiveMultiplierOf(legacy)).toBeCloseTo(1.12);
    expect(effectiveBurnRate({ ...legacy, taxRate: 0 })).toBe(2240);
    expect(effectiveBurnRate({ ...legacy, taxRate: 0.25 })).toBe(2464);
  });
});

describe('talent burn readout', () => {
  test('shows effective burn, the talent factor, base burn, and the mix table', () => {
    const employees = [{ department: 'tech', skillTech: 0.53 }];
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
    expect(section).toHaveTextContent(
      'Burn $2,816 (base $2,200 · talent ×1.2800 · talent cost ×1.00)'
    );
    expect(formatTalentReadout(1)).toBe('1.0000');
    expect(formatTalentReadout(1.28)).toBe('1.2800');
    expect(formatTalentReadout(1.75)).toBe('1.7500');

    const table = within(section).getByRole('table', { name: 'Talent mix' });
    expect(within(table).getByRole('columnheader', { name: 'Department' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Headcount' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Average skill' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Weight' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Contribution' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'tech' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '1' })).toBeInTheDocument();
  });

  test('with no employees says the multiplier is 1.0000', () => {
    render(
      <Dashboard
        state={{
          taxRate: 0.25,
          dataSource: 'local',
          employees: [],
          company: { cash: 15000, burnRate: 2000, hype: 0.3, talentCost: 1, productQuality: 0.4 },
          baselines: { hype: 0.3, talentCost: 1 },
          history: { cash: [15000], burnRate: [2000] },
          activeTriggers: [],
        }}
      />
    );
    expect(screen.getByRole('region', { name: 'Talent and burn' })).toHaveTextContent(
      'No employees. Talent multiplier is 1.0000.'
    );
    expect(screen.getByRole('region', { name: 'Talent and burn' })).toHaveTextContent(
      'Burn $2,200 (base $2,200 · talent ×1.0000 · talent cost ×1.00)'
    );
  });
});
