import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import Dashboard from './components/Dashboard';
import {
  APPLY_TALENT_COST_TO_BURN,
  SAMPLE_EMPLOYEES,
  baseBurnRate,
  burnMultiplier,
  burnFromStoredBase,
  burnRateFromMultiplier,
  composeTalentMultiplier,
  computeTalentMultiplier,
  departmentWeight,
  formatTalentReadout,
  readTalentMix,
  readTalentMultiplier,
  effectiveBurnRate,
  effectiveMultiplierOf,
  roundedEffectiveMultiplier,
  scaleTalentMultiplier,
  skillFactor,
  talentCostFactor,
  talentCostFactorClampedOf,
  talentCostFactorClampOf,
  talentCostFactorOf,
  talentMixFromEmployees,
  talentMultiplierOf,
} from './talentMultiplier';
import { applyTrigger, initialState } from './simulation';

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
    expect(talentCostFactorClampedOf(staffed)).toBe(false);
    expect(effectiveMultiplierOf(staffed)).toBeCloseTo(1.96);
    expect(effectiveBurnRate(staffed)).toBe(5488);

    const cappedStaff = {
      ...staffed,
      company: { talentCost: 9 },
    };
    expect(talentMultiplierOf(cappedStaff)).toBe(1.75);
    expect(talentCostFactorOf(cappedStaff)).toBe(3);
    expect(talentCostFactorClampedOf(cappedStaff)).toBe(true);
    expect(effectiveBurnRate(cappedStaff)).toBe(14700);

    const flooredStaff = {
      ...staffed,
      company: { talentCost: 0 },
    };
    expect(talentMultiplierOf(flooredStaff)).toBe(1.75);
    expect(talentCostFactorOf(flooredStaff)).toBe(0.1);
    expect(talentCostFactorClampedOf(flooredStaff)).toBe(true);
    expect(effectiveBurnRate(flooredStaff)).toBe(490);

    const apiStaff = {
      dataSource: 'api',
      taxRate: 1,
      talentMultiplier: 1.75,
      company: { talentCost: 12000 },
      baselines: { talentCost: 4000 },
    };
    expect(effectiveBurnRate({ ...apiStaff, talentCostFactor: 3, talentCostFactorClamped: true })).toBe(14700);
    expect(talentCostFactorClampedOf({ ...apiStaff, talentCostFactor: 3, talentCostFactorClamped: true })).toBe(true);
    expect(effectiveBurnRate({ ...apiStaff, talentCostFactor: 0.1, talentCostFactorClamped: true })).toBe(490);
    expect(talentCostFactorOf({ ...apiStaff, talentCostFactor: 0 })).toBe(0.1);
    expect(talentCostFactorClampedOf({ ...apiStaff, talentCostFactor: 0 })).toBe(true);
    expect(talentCostFactorClampedOf({ ...apiStaff, talentCostFactor: 1.12 })).toBe(false);
    expect(effectiveBurnRate({ ...apiStaff, talentCostFactor: 1.12 })).toBe(5488);

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
    expect(effectiveMultiplierOf({ ...server, effectiveMultiplier: 2 })).toBe(1.96);
    expect(effectiveBurnRate({ ...server, effectiveMultiplier: 2 })).toBe(5488);

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

  test('rounds both factors to 4 decimals, and a zero talent cost floors the factor at 0.1', () => {
    expect(talentCostFactor(4480, 4000)).toBe(1.12);
    expect(talentCostFactor(4121.6, 4000)).toBe(1.0304);
    expect(talentCostFactor(4000, 4000)).toBe(1);
    expect(talentCostFactor(0, 4000)).toBe(0.1);
    expect(talentCostFactor(-1, 4000)).toBe(0.1);
    expect(talentCostFactor(100, 0)).toBe(1);
    expect(talentCostFactor(100, null)).toBe(1);
    expect(talentCostFactor(100, -4)).toBe(1);
    expect(talentCostFactor(100, Number.NaN)).toBe(1);
    expect(talentCostFactor(100, Number.POSITIVE_INFINITY)).toBe(1);
    expect(talentCostFactor(100, '')).toBe(1);
    expect(roundedEffectiveMultiplier(1.75, 1.12)).toBe(1.96);
    expect(roundedEffectiveMultiplier(1, 0)).toBe(0);
    expect(burnFromStoredBase(2000, 1.12)).toBe(2240);
    expect(burnFromStoredBase(2000, 0)).toBe(0);

    const zeroed = {
      dataSource: 'local',
      taxRate: 0.25,
      employees: [],
      company: { talentCost: 0 },
      baselines: { talentCost: 4000 },
    };
    expect(talentCostFactorOf(zeroed)).toBe(0.1);
    expect(effectiveMultiplierOf(zeroed)).toBe(0.1);
    expect(effectiveBurnRate(zeroed)).toBe(220);
  });

  test('clamps the talent-cost factor to 0.1 and 3 after rounding', () => {
    expect(talentCostFactor(0.0999, 1)).toBe(0.1);
    expect(talentCostFactor(0.1, 1)).toBe(0.1);
    expect(talentCostFactor(3, 1)).toBe(3);
    expect(talentCostFactor(3.0001, 1)).toBe(3);
    expect(talentCostFactor(1e12, 4000)).toBe(3);
    expect(talentCostFactorClampOf({
      dataSource: 'local',
      company: { talentCost: 0.0999 },
      baselines: { talentCost: 1 },
    })).toBe('floor');
    expect(talentCostFactorClampOf({
      dataSource: 'local',
      company: { talentCost: 0.1 },
      baselines: { talentCost: 1 },
    })).toBeNull();
    expect(talentCostFactorClampOf({
      dataSource: 'local',
      company: { talentCost: 3 },
      baselines: { talentCost: 1 },
    })).toBeNull();
    expect(talentCostFactorClampOf({
      dataSource: 'local',
      company: { talentCost: 3.0001 },
      baselines: { talentCost: 1 },
    })).toBe('cap');

    const hot = {
      dataSource: 'api',
      taxRate: 1,
      talentMultiplier: 5,
      talentCostFactor: 9,
      company: { talentCost: 1 },
      baselines: { talentCost: 1 },
    };
    expect(talentMultiplierOf(hot)).toBe(5);
    expect(talentCostFactorOf(hot)).toBe(3);
    expect(effectiveMultiplierOf(hot)).toBe(15);
    expect(effectiveBurnRate(hot)).toBe(Math.round(2800 * 5 * 3));

    const flagged = {
      dataSource: 'api',
      talentMultiplier: 1,
      talentCostFactor: 0.1,
      talentCostFactorClamped: true,
      company: { talentCost: 400 },
      baselines: { talentCost: 4000 },
    };
    expect(talentCostFactorOf(flagged)).toBe(0.1);
    expect(talentCostFactorClampOf(flagged)).toBe('floor');

    const preferred = {
      dataSource: 'api',
      taxRate: 0.25,
      talentMultiplier: 1,
      talentCostFactor: 1.5,
      company: { talentCost: 40000 },
      baselines: { talentCost: 4000 },
    };
    expect(talentCostFactorOf(preferred)).toBe(1.5);
    expect(talentCostFactorClampOf(preferred)).toBeNull();
    expect(effectiveBurnRate(preferred)).toBe(Math.round(2200 * 1.5));
  });

  test('matches a reference talent-cost burn across random inputs in both modes', () => {
    function referenceRound(value, places) {
      const scale = 10 ** places;
      return Math.round((value + Math.sign(value) * 1e-10) * scale) / scale;
    }

    function referenceFactor(talentCost, baselineTalentCost) {
      if (baselineTalentCost == null || baselineTalentCost === '') return 1;
      const baseline = Number(baselineTalentCost);
      if (!Number.isFinite(baseline) || baseline <= 0) return 1;
      if (talentCost == null || talentCost === '') return 1;
      const cost = Number(talentCost);
      if (!Number.isFinite(cost)) return 1;
      const ratio = cost / baseline;
      if (!Number.isFinite(ratio)) return 1;
      return referenceRound(Math.min(3, Math.max(0.1, ratio)), 4);
    }

    function referenceEffective(employee, factor) {
      const product = employee * factor;
      if (!Number.isFinite(product) || product < 0) return 0;
      return referenceRound(product, 4);
    }

    function referenceBurn(taxRate, employee, factor) {
      const tax = Number.isFinite(taxRate) ? taxRate : 0;
      const base = Math.round(2000 * (1 + tax * 0.4));
      return Math.round(base * employee * factor);
    }

    function mulberry32(seed) {
      let state = seed >>> 0;
      return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    const random = mulberry32(0x5c50);
    const baselines = [null, 0, -4, Number.NaN, Number.POSITIVE_INFINITY, '', 1, 4000];
    for (let index = 0; index < 5000; index += 1) {
      const tax = random();
      const employee = referenceRound(random() * 5, 4);
      const baseline = baselines[Math.floor(random() * baselines.length)];
      const costRoll = random();
      const cost = costRoll < 0.05
        ? 0
        : costRoll < 0.1
          ? -random() * 1000
          : (random() * 20000) * (random() < 0.1 ? 1000 : 1);
      const factor = referenceFactor(cost, baseline);
      const local = {
        dataSource: 'local',
        taxRate: tax,
        employees: [],
        company: { talentCost: cost },
        baselines: { talentCost: baseline },
      };
      const api = {
        dataSource: 'api',
        taxRate: tax,
        talentMultiplier: employee,
        company: { talentCost: cost },
        baselines: { talentCost: baseline },
      };
      expect(talentCostFactor(cost, baseline)).toBe(factor);
      expect(talentCostFactorOf(local)).toBe(factor);
      expect(talentCostFactorOf(api)).toBe(factor);
      expect(effectiveMultiplierOf(local)).toBe(referenceEffective(1, factor));
      expect(effectiveMultiplierOf(api)).toBe(referenceEffective(employee, factor));
      expect(effectiveBurnRate(local)).toBe(referenceBurn(tax, 1, factor));
      expect(effectiveBurnRate(api)).toBe(referenceBurn(tax, employee, factor));

      if (typeof baseline === 'number' && Number.isFinite(baseline) && baseline > 0 && Number.isFinite(cost)) {
        const published = {
          ...api,
          talentCostFactor: cost / baseline,
        };
        expect(talentCostFactorOf(published)).toBe(factor);
        expect(effectiveBurnRate(published)).toBe(referenceBurn(tax, employee, factor));
      }
    }
  });
});

describe('clamped talent-cost factor in the local readout', () => {
  function trigger(id, talentCost) {
    return {
      id,
      type: 'policy_change',
      label: 'Policy change',
      source: 'mock:local',
      timestamp: '2026-04-02T15:00:00.000Z',
      effect: { talentCost },
    };
  }

  test('a -100% talent-cost trigger shows 0.10 and burn $220', () => {
    const wiped = applyTrigger(initialState, trigger('wipe', -1));
    expect(talentCostFactorOf(wiped)).toBe(0.1);
    expect(effectiveBurnRate(wiped)).toBe(220);
    render(<Dashboard state={wiped} />);
    expect(screen.getByTestId('talent-cost-factor-value')).toHaveTextContent('Talent cost factor: 0.10');
    expect(screen.getByTestId('talent-cost-factor-clamp')).toHaveTextContent('floored at 0.1×');
    expect(screen.getByTestId('talent-cost-factor-value')).toHaveAccessibleName(
      'Talent cost factor 0.10, floored at 0.1×'
    );
    expect(screen.getByTestId('burn-value')).toHaveTextContent('Burn/mo: $220');
    expect(screen.getByTestId('effective-multiplier-value')).toHaveTextContent('Effective multiplier: 0.10');
  });

  test('three stacked +100 triggers show the factor capped at 3.00', () => {
    let stacked = initialState;
    for (const id of ['stack-a', 'stack-b', 'stack-c']) {
      stacked = applyTrigger(stacked, trigger(id, 100));
    }
    expect(talentCostFactorOf(stacked)).toBe(3);
    expect(stacked.company.talentCost).toBeGreaterThan(3);
    render(<Dashboard state={stacked} />);
    expect(screen.getByTestId('talent-cost-factor-value')).toHaveTextContent('Talent cost factor: 3.00');
    expect(screen.getByTestId('talent-cost-factor-clamp')).toHaveTextContent('capped at 3×');
    expect(screen.getByTestId('talent-cost-factor-value')).toHaveAccessibleName(
      'Talent cost factor 3.00, capped at 3×'
    );
    expect(screen.getByTestId('effective-multiplier-value')).toHaveTextContent('Effective multiplier: 3.00');
    expect(screen.getByTestId('talent-equation')).toHaveTextContent('cost factor 3.00 = 3.00');
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
