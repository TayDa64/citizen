import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SAMPLE_TRIGGERS, stackTriggerEffects } from '../../src/triggerContract.js';
import {
  TALENT_COST_FACTOR_MAX,
  TALENT_COST_FACTOR_MIN,
  burnFromTax,
  clampSkill,
  composeTalentMultiplier,
  effectiveMultiplier,
  resolveTalentCostFactor,
  skillFactor,
  talentCostFactor
} from '../../src/talentBurn.js';

const [POLICY, , MARKET] = SAMPLE_TRIGGERS;
const BASELINE = { hype: 0.3, talentCost: 4000 };
const TECH = { department: 'tech', skillTech: 1 };

function trigger(id, effect) {
  return {
    id,
    type: 'market_shift',
    label: id,
    source: 'mock:local',
    timestamp: '2026-06-01T00:00:00.000Z',
    effect
  };
}

function stackedBurn(triggers, { taxRate = 0.25, employees = [] } = {}) {
  const metrics = stackTriggerEffects(BASELINE, triggers);
  const profile = composeTalentMultiplier({ employees });
  const factor = resolveTalentCostFactor(metrics.talentCost, BASELINE.talentCost);
  const burn = burnFromTax(
    taxRate,
    profile.talentMultiplier,
    factor.talentCostFactor,
    factor.talentCostFactorClamped
  );
  return { ...metrics, ...profile, ...factor, ...burn };
}

function burnFor(taxRate, talentMultiplier = 1) {
  return Math.round(2000 * (1 + taxRate * 0.4) * talentMultiplier);
}

function baseFor(taxRate) {
  return Math.round(2000 * (1 + taxRate * 0.4));
}

test('skill 0 is 0.6x, skill 0.5 is 1x, and skill 1 is 1.4x', () => {
  assert.equal(skillFactor(0), 0.6);
  assert.equal(skillFactor(0.5), 1);
  assert.equal(skillFactor(1), 1.4);
  assert.equal(skillFactor(-1), 0.6);
  assert.equal(skillFactor(2), 1.4);
});

test('talentMultiplier stays the employee mean and the cost factor is separate', () => {
  const empty = composeTalentMultiplier({ employees: [] });
  assert.equal(empty.talentMultiplier, 1);
  assert.deepEqual(empty.talentMix, []);
  assert.equal(TALENT_COST_FACTOR_MIN, 0.1);
  assert.equal(TALENT_COST_FACTOR_MAX, 3);
  assert.equal(talentCostFactor(4000, 4000), 1);
  assert.equal(resolveTalentCostFactor(4000, 4000).talentCostFactorClamped, false);
  assert.equal(talentCostFactor(4000, null), 1);
  assert.equal(resolveTalentCostFactor(4000, null).talentCostFactorClamped, false);
  assert.equal(talentCostFactor(4000, 0), 1);
  assert.equal(resolveTalentCostFactor(4000, 0).talentCostFactorClamped, false);
  assert.equal(talentCostFactor(4000, -5), 1);
  assert.equal(resolveTalentCostFactor(4000, -5).talentCostFactorClamped, false);
  assert.equal(talentCostFactor(4000, Number.NaN), 1);
  assert.equal(resolveTalentCostFactor(4000, Number.POSITIVE_INFINITY).talentCostFactorClamped, false);
  assert.equal(talentCostFactor(0, 4000), 0.1);
  assert.equal(resolveTalentCostFactor(0, 4000).talentCostFactorClamped, true);
  assert.equal(talentCostFactor(-1, 4000), 0.1);
  assert.equal(talentCostFactor(400, 4000), 0.1);
  assert.equal(resolveTalentCostFactor(400, 4000).talentCostFactorClamped, false);
  assert.equal(talentCostFactor(0.16, 4000), 0.1);
  assert.equal(talentCostFactor(4480, 4000), 1.12);
  assert.equal(resolveTalentCostFactor(4480, 4000).talentCostFactorClamped, false);
  const tech = composeTalentMultiplier({
    employees: [{ department: 'tech', skillTech: 1 }]
  });
  assert.equal(tech.talentMultiplier, 1.75);
  assert.equal(tech.talentMix[0].contribution, 1.75);
  assert.equal(effectiveMultiplier(tech.talentMultiplier, 1.12), 1.96);
});

test('NaN and Infinity skill count as 0.5', () => {
  assert.equal(clampSkill(Number.NaN), 0.5);
  assert.equal(clampSkill(Number.POSITIVE_INFINITY), 0.5);
  assert.equal(clampSkill(Number.NEGATIVE_INFINITY), 0.5);
  assert.equal(clampSkill(null), 0.5);
  assert.equal(skillFactor(Number.NaN), 1);
  assert.equal(
    composeTalentMultiplier({
      employees: [{ department: 'tech', skillTech: Number.NaN }]
    }).talentMultiplier,
    1.25
  );
});

test('department weights, skill clamp, null department, and mean aggregation', () => {
  const tech = composeTalentMultiplier({
    employees: [
      { department: 'tech', skillTech: 1 },
      { department: 'Tech', skill_tech: 1 },
      { department: 'tech', skillTech: 1 },
      { department: 'tech', skillTech: 1 }
    ]
  });
  assert.equal(tech.talentMultiplier, 1.75);
  assert.deepEqual(tech.talentMix, [
    { department: 'tech', headcount: 4, avgSkill: 1, weight: 1.25, contribution: 1.75 }
  ]);

  assert.equal(
    composeTalentMultiplier({
      employees: [{ department: 'marketing', skillMarketing: 0.5 }]
    }).talentMultiplier,
    1.05
  );
  assert.equal(
    composeTalentMultiplier({
      employees: [{ department: 'sales', skillSales: 0.5 }]
    }).talentMultiplier,
    0.95
  );
  const missing = composeTalentMultiplier({
    employees: [{ department: null, skillTech: 0.5, skillMarketing: 0.5, skillSales: 0.5 }]
  });
  assert.equal(missing.talentMultiplier, 1);
  assert.equal(missing.talentMix[0].department, null);
  assert.equal(missing.talentMix[0].weight, 1);
  assert.equal(missing.talentMix[0].avgSkill, 0.5);

  const clamped = composeTalentMultiplier({
    employees: [{ department: 'tech', skillTech: 1.8 }]
  });
  assert.equal(clamped.talentMultiplier, 1.75);
  assert.equal(clamped.talentMix[0].avgSkill, 1);
  assert.equal(
    composeTalentMultiplier({
      employees: [{ department: 'tech', skillTech: -3 }]
    }).talentMultiplier,
    0.75
  );
  assert.equal(
    composeTalentMultiplier({
      employees: [{ department: null, skillTech: 0, skillMarketing: 0, skillSales: 0 }]
    }).talentMultiplier,
    0.6
  );

  const inactive = composeTalentMultiplier({
    employees: [
      { department: 'tech', skillTech: 1, isActive: true },
      { department: 'sales', skillSales: 1, is_active: false }
    ]
  });
  assert.equal(inactive.talentMultiplier, 1.75);
  assert.equal(inactive.talentMix.length, 1);

  const thirds = composeTalentMultiplier({
    employees: [
      { department: 'c', skillTech: 0.5, skillMarketing: 0.5, skillSales: 0.5 },
      { department: 'a', skillTech: 0.5, skillMarketing: 0.5, skillSales: 0.5 },
      { department: 'b', skillTech: 0.5, skillMarketing: 0.5, skillSales: 0.5 }
    ]
  });
  assert.equal(thirds.talentMultiplier, 1);
  assert.deepEqual(
    thirds.talentMix.map((group) => group.department),
    ['a', 'b', 'c']
  );
  assert.deepEqual(
    thirds.talentMix.map((group) => group.contribution),
    [0.3333, 0.3333, 0.3334]
  );
  const sum = thirds.talentMix.reduce((total, group) => total + group.contribution, 0);
  assert.equal(Math.round(sum * 10000) / 10000, thirds.talentMultiplier);
});

describe('burn uses the employee multiplier and the clamped cost factor once', () => {
  test('tax 0, 0.25, and 1 stay 2000, 2200, and 2800 with no employees', () => {
    for (const taxRate of [0, 0.25, 1]) {
      const next = stackedBurn([], { taxRate });
      assert.equal(next.baseBurnRate, baseFor(taxRate));
      assert.equal(next.burnRate, burnFor(taxRate));
      assert.equal(next.talentMultiplier, 1);
      assert.deepEqual(next.talentMix, []);
      assert.equal(next.talentCostFactor, 1);
      assert.equal(next.talentCostFactorClamped, false);
      assert.equal(next.burnRate, [2000, 2200, 2800][[0, 0.25, 1].indexOf(taxRate)]);
      assert.equal(burnFromTax(taxRate, 1, 1).burnRate, next.burnRate);
    }
  });

  test('a tech-heavy roster raises burn once and the policy trigger keeps the employee mean', () => {
    const employees = [TECH, TECH, TECH];
    const taxed = stackedBurn([], { taxRate: 1, employees });
    assert.equal(taxed.talentMultiplier, 1.75);
    assert.equal(taxed.baseBurnRate, 2800);
    assert.equal(taxed.burnRate, 4900);
    assert.equal(burnFromTax(1, 1.75, 1).burnRate, 4900);

    const triggered = stackedBurn([POLICY], { taxRate: 1, employees });
    assert.equal(triggered.talentCost, 4480);
    assert.equal(triggered.talentMultiplier, 1.75);
    assert.equal(triggered.talentCostFactor, 1.12);
    assert.equal(triggered.effectiveMultiplier, 1.96);
    assert.equal(triggered.burnRate, 5488);
    assert.equal(triggered.baseBurnRate, 2800);
    assert.equal(triggered.hype, 0.3);
    assert.equal(burnFromTax(1, 1.75, 1.12).burnRate, 5488);
  });

  test('tax 0.25 with no employees and the policy trigger is round(2200 * 1.12)', () => {
    const triggered = stackedBurn([POLICY]);
    assert.equal(triggered.talentMultiplier, 1);
    assert.deepEqual(triggered.talentMix, []);
    assert.equal(triggered.talentCost, 4480);
    assert.equal(triggered.talentCostFactor, 1.12);
    assert.equal(triggered.effectiveMultiplier, 1.12);
    assert.equal(triggered.baseBurnRate, 2200);
    assert.equal(triggered.burnRate, 2464);
    assert.equal(triggered.burnRate, Math.round(2200 * 1.12));
    assert.equal(triggered.hype, 0.3);
    assert.equal(burnFromTax(0.25, 1, 1.12).burnRate, 2464);
  });

  test('tax 1 with no employees and the policy trigger is round(2800 * 1.12)', () => {
    const triggered = stackedBurn([POLICY], { taxRate: 1 });
    assert.equal(triggered.talentMultiplier, 1);
    assert.equal(triggered.talentCostFactor, 1.12);
    assert.equal(triggered.burnRate, 3136);
    assert.equal(triggered.baseBurnRate, 2800);
  });

  test('four tech employees plus the policy trigger at tax 1 burn 5488', () => {
    const triggered = stackedBurn([POLICY], { taxRate: 1, employees: [TECH, TECH, TECH, TECH] });
    assert.equal(triggered.talentMultiplier, 1.75);
    assert.equal(triggered.talentCostFactor, 1.12);
    assert.equal(triggered.effectiveMultiplier, 1.96);
    assert.equal(triggered.burnRate, 5488);
    assert.equal(triggered.burnRate, Math.round(2800 * 1.96));
    assert.equal(triggered.hype, 0.3);
  });

  test('a stacked market shift uses the stacked talent-cost ratio', () => {
    const stacked = stackedBurn([POLICY, MARKET]);
    assert.equal(stacked.talentCost, 4121.6);
    assert.equal(stacked.talentCostFactor, 1.0304);
    assert.equal(stacked.talentCostFactor, 4121.6 / 4000);
    assert.equal(stacked.hype, 0.25);
    assert.equal(stacked.burnRate, Math.round(2200 * 1.0304));
  });

  test('a replaced id uses only the new talent-cost delta', () => {
    const replaced = stackedBurn([{ ...POLICY, effect: { talentCost: 0.2 } }]);
    assert.equal(replaced.talentCost, 4800);
    assert.equal(replaced.talentCostFactor, 1.2);
    assert.notEqual(replaced.talentCost, 4480 * 1.2);
    assert.equal(replaced.burnRate, Math.round(2200 * 1.2));
  });

  test('a talent cost of 0 clamps the factor to 0.1 and keeps burn above 0', () => {
    const floored = stackedBurn([trigger('evt-shock', { talentCost: -5 })]);
    assert.equal(floored.talentCost, 0);
    assert.equal(floored.talentCostFactor, 0.1);
    assert.equal(floored.talentCostFactorClamped, true);
    assert.equal(floored.effectiveMultiplier, 0.1);
    assert.equal(floored.burnRate, 220);
    assert.equal(floored.hype, 0.3);
    assert.equal(Number.isFinite(floored.burnRate), true);
    assert.ok(floored.burnRate > 0);
  });

  test('a single -100% trigger and stacked near-zero triggers clamp the factor to 0.1', () => {
    const wiped = stackedBurn([trigger('evt-wipe', { talentCost: -1 })]);
    assert.equal(wiped.talentCost, 0);
    assert.equal(wiped.talentCostFactor, 0.1);
    assert.equal(wiped.talentCostFactorClamped, true);
    assert.equal(wiped.burnRate, 220);
    assert.equal(wiped.hype, 0.3);
    assert.ok(wiped.burnRate > 0);

    const near = stackedBurn([
      trigger('evt-near-a', { talentCost: -0.99 }),
      trigger('evt-near-b', { talentCost: -0.99 })
    ]);
    assert.ok(near.talentCost > 0);
    assert.ok(near.talentCost < 400);
    assert.equal(near.talentCostFactor, 0.1);
    assert.equal(near.talentCostFactorClamped, true);
    assert.equal(near.burnRate, 220);
    assert.equal(near.hype, 0.3);
  });

  test('three +100 triggers clamp the stacked factor to 3 and leave talent cost raw', () => {
    const stacked = stackedBurn([
      trigger('evt-max-a', { talentCost: 100 }),
      trigger('evt-max-b', { talentCost: 100 }),
      trigger('evt-max-c', { talentCost: 100 })
    ]);
    assert.equal(stacked.talentCost, 4121204000);
    assert.equal(stacked.talentCostFactor, 3);
    assert.equal(stacked.talentCostFactorClamped, true);
    assert.equal(stacked.hype, 0.3);
    assert.equal(stacked.talentMultiplier, 1);
  });

  test('four tech employees stay at 1.75 and burn 14700 or 490 at the factor bounds', () => {
    const employees = [TECH, TECH, TECH, TECH];
    const maximized = stackedBurn(
      [
        trigger('evt-max-a', { talentCost: 100 }),
        trigger('evt-max-b', { talentCost: 100 }),
        trigger('evt-max-c', { talentCost: 100 })
      ],
      { taxRate: 1, employees }
    );
    assert.equal(maximized.talentMultiplier, 1.75);
    assert.equal(maximized.talentCostFactor, 3);
    assert.equal(maximized.effectiveMultiplier, 5.25);
    assert.equal(maximized.burnRate, 14700);
    assert.equal(maximized.burnRate, 2800 * 1.75 * 3);
    assert.equal(Number.isFinite(maximized.burnRate), true);

    const minimized = stackedBurn([trigger('evt-wipe', { talentCost: -1 })], {
      taxRate: 1,
      employees
    });
    assert.equal(minimized.talentMultiplier, 1.75);
    assert.equal(minimized.talentCostFactor, 0.1);
    assert.equal(minimized.talentCost, 0);
    assert.equal(minimized.burnRate, 490);
    assert.equal(minimized.burnRate, 2800 * 1.75 * 0.1);
    assert.ok(minimized.burnRate > 0);
  });
});

