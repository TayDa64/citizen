import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SAMPLE_TRIGGERS } from '../../src/triggerContract.js';
import {
  applyEffects,
  applyTriggerEffect,
  initialState,
  setTaxRate
} from '../../src/simulation.js';
import {
  TALENT_COST_FACTOR_MAX,
  TALENT_COST_FACTOR_MIN,
  clampSkill,
  composeTalentMultiplier,
  effectiveMultiplier,
  resolveTalentCostFactor,
  skillFactor,
  talentCostFactor
} from '../../src/talentBurn.js';

const [POLICY] = SAMPLE_TRIGGERS;

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

describe('Slice 1 burn with the employee multiplier', () => {
  test('tax 0, 0.25, and 1 stay 2000, 2200, and 2800 with no employees', () => {
    for (const taxRate of [0, 0.25, 1]) {
      const next = applyEffects(setTaxRate(initialState, taxRate));
      assert.equal(next.company.baseBurnRate, baseFor(taxRate));
      assert.equal(next.company.burnRate, burnFor(taxRate));
      assert.equal(next.company.talentMultiplier, 1);
      assert.deepEqual(next.company.talentMix, []);
      assert.equal(next.company.burnRate, [2000, 2200, 2800][[0, 0.25, 1].indexOf(taxRate)]);
    }
    const second = applyEffects(applyEffects(setTaxRate(initialState, 0.25)));
    assert.equal(second.company.burnRate, 2200);
    assert.equal(second.company.cash, 15000 - 2200 / 12 - 2200 / 12);
  });

  test('a tech-heavy roster raises burn once and a second tick does not compound', () => {
    const staffed = {
      ...initialState,
      employees: [
        { department: 'tech', skillTech: 1 },
        { department: 'tech', skillTech: 1 },
        { department: 'tech', skillTech: 1 }
      ]
    };
    const taxed = applyEffects(setTaxRate(staffed, 1));
    assert.equal(taxed.company.talentMultiplier, 1.75);
    assert.equal(taxed.company.baseBurnRate, 2800);
    assert.equal(taxed.company.burnRate, 4900);
    assert.equal(taxed.company.cash, 15000 - 4900 / 12);
    const second = applyEffects(taxed);
    assert.equal(second.company.burnRate, 4900);
    assert.equal(second.company.talentMultiplier, 1.75);
    assert.equal(second.company.cash, 15000 - 4900 / 12 - 4900 / 12);

    const triggered = applyTriggerEffect(taxed, POLICY);
    assert.equal(triggered.company.talentCost, 4480);
    assert.equal(triggered.company.talentMultiplier, 1.75);
    assert.equal(triggered.company.talentCostFactor, 1.12);
    assert.equal(triggered.company.effectiveMultiplier, 1.96);
    assert.equal(triggered.company.burnRate, 5488);
    assert.equal(triggered.company.baseBurnRate, 2800);
    assert.equal(triggered.company.hype, taxed.company.hype);
    assert.equal(triggered.company.cash, taxed.company.cash);
    const afterTrigger = applyEffects(triggered);
    assert.equal(afterTrigger.company.burnRate, 5488);
    assert.equal(afterTrigger.company.effectiveMultiplier, 1.96);
  });

  test('tax 0.25 with no employees and the policy trigger is round(2200 * 1.12)', () => {
    const triggered = applyTriggerEffect(initialState, POLICY);
    assert.equal(triggered.company.talentMultiplier, 1);
    assert.deepEqual(triggered.company.talentMix, []);
    assert.equal(triggered.company.talentCost, 4480);
    assert.equal(triggered.company.talentCostFactor, 1.12);
    assert.equal(triggered.company.effectiveMultiplier, 1.12);
    assert.equal(triggered.company.baseBurnRate, 2200);
    assert.equal(triggered.company.burnRate, 2464);
    assert.equal(triggered.company.burnRate, Math.round(2200 * 1.12));
    assert.equal(triggered.company.hype, 0.3);
    assert.equal(triggered.company.cash, 15000);
    const second = applyEffects(applyEffects(triggered));
    assert.equal(second.company.burnRate, 2464);
    assert.equal(second.company.cash, 15000 - 2464 / 12 - 2464 / 12);
    assert.equal(second.company.hype, 0.3);
  });

  test('tax 1 with no employees and the policy trigger is round(2800 * 1.12)', () => {
    const triggered = applyTriggerEffect(setTaxRate(initialState, 1), POLICY);
    assert.equal(triggered.company.talentMultiplier, 1);
    assert.equal(triggered.company.talentCostFactor, 1.12);
    assert.equal(triggered.company.burnRate, 3136);
    assert.equal(triggered.company.baseBurnRate, 2800);
  });

  test('four tech employees plus the policy trigger at tax 1 burn 5488', () => {
    const staffed = setTaxRate(
      {
        ...initialState,
        employees: [
          { department: 'tech', skillTech: 1 },
          { department: 'tech', skillTech: 1 },
          { department: 'tech', skillTech: 1 },
          { department: 'tech', skillTech: 1 }
        ]
      },
      1
    );
    const triggered = applyTriggerEffect(staffed, POLICY);
    assert.equal(triggered.company.talentMultiplier, 1.75);
    assert.equal(triggered.company.talentCostFactor, 1.12);
    assert.equal(triggered.company.effectiveMultiplier, 1.96);
    assert.equal(triggered.company.burnRate, 5488);
    assert.equal(triggered.company.burnRate, Math.round(2800 * 1.96));
    const ticked = applyEffects(applyEffects(triggered));
    assert.equal(ticked.company.burnRate, 5488);
    assert.equal(ticked.company.hype, 0.3);
  });

  test('a stacked market shift uses the stacked talent-cost ratio', () => {
    const [, , market] = SAMPLE_TRIGGERS;
    const stacked = applyTriggerEffect(applyTriggerEffect(initialState, POLICY), market);
    assert.equal(stacked.company.talentCost, 4121.6);
    assert.equal(stacked.company.talentCostFactor, 1.0304);
    assert.equal(stacked.company.talentCostFactor, 4121.6 / 4000);
    assert.equal(stacked.company.hype, 0.25);
    assert.equal(stacked.company.burnRate, Math.round(2200 * 1.0304));
  });

  test('replacing an id does not stack the talent-cost factor', () => {
    const replaced = applyTriggerEffect(
      applyTriggerEffect(initialState, POLICY),
      { ...POLICY, effect: { talentCost: 0.2 } }
    );
    assert.equal(replaced.company.talentCost, 4800);
    assert.equal(replaced.company.talentCostFactor, 1.2);
    assert.notEqual(replaced.company.talentCost, 4480 * 1.2);
    assert.equal(replaced.company.burnRate, Math.round(2200 * 1.2));
  });

  test('a talent cost of 0 clamps the factor to 0.1 and keeps burn above 0', () => {
    const floored = applyTriggerEffect(initialState, {
      id: 'evt-shock',
      type: 'market_shift',
      label: 'Shock',
      source: 'mock:local',
      timestamp: '2026-06-01T00:00:00.000Z',
      effect: { talentCost: -5 }
    });
    assert.equal(floored.company.talentCost, 0);
    assert.equal(floored.company.talentCostFactor, 0.1);
    assert.equal(floored.company.talentCostFactorClamped, true);
    assert.equal(floored.company.effectiveMultiplier, 0.1);
    assert.equal(floored.company.burnRate, 220);
    assert.equal(floored.company.hype, 0.3);
    assert.equal(Number.isFinite(floored.company.burnRate), true);
    assert.ok(floored.company.burnRate > 0);
  });

  test('a single -100% trigger and stacked near-zero triggers clamp the factor to 0.1', () => {
    const wiped = applyTriggerEffect(initialState, {
      id: 'evt-wipe',
      type: 'market_shift',
      label: 'Wipe',
      source: 'mock:local',
      timestamp: '2026-06-01T00:00:00.000Z',
      effect: { talentCost: -1 }
    });
    assert.equal(wiped.company.talentCost, 0);
    assert.equal(wiped.company.talentCostFactor, 0.1);
    assert.equal(wiped.company.talentCostFactorClamped, true);
    assert.equal(wiped.company.burnRate, 220);
    assert.equal(wiped.company.hype, 0.3);
    assert.ok(wiped.company.burnRate > 0);

    const near = ['evt-near-a', 'evt-near-b'].reduce(
      (state, id) =>
        applyTriggerEffect(state, {
          id,
          type: 'market_shift',
          label: id,
          source: 'mock:local',
          timestamp: '2026-06-01T00:00:00.000Z',
          effect: { talentCost: -0.99 }
        }),
      initialState
    );
    assert.ok(near.company.talentCost > 0);
    assert.ok(near.company.talentCost < 400);
    assert.equal(near.company.talentCostFactor, 0.1);
    assert.equal(near.company.talentCostFactorClamped, true);
    assert.equal(near.company.burnRate, 220);
    assert.equal(near.company.hype, 0.3);
  });

  test('three +100 triggers clamp the stacked factor to 3 and leave talent cost raw', () => {
    const stacked = ['evt-max-a', 'evt-max-b', 'evt-max-c'].reduce(
      (state, id) =>
        applyTriggerEffect(state, {
          id,
          type: 'policy_change',
          label: id,
          source: 'mock:local',
          timestamp: '2026-06-01T00:00:00.000Z',
          effect: { talentCost: 100 }
        }),
      initialState
    );
    assert.equal(stacked.company.talentCost, 4121204000);
    assert.equal(stacked.company.talentCostFactor, 3);
    assert.equal(stacked.company.talentCostFactorClamped, true);
    assert.equal(stacked.company.hype, 0.3);
    assert.equal(stacked.company.talentMultiplier, 1);
  });

  test('four tech employees stay at 1.75 and burn 14700 or 490 at the factor bounds', () => {
    const staffed = setTaxRate(
      {
        ...initialState,
        employees: [
          { department: 'tech', skillTech: 1 },
          { department: 'tech', skillTech: 1 },
          { department: 'tech', skillTech: 1 },
          { department: 'tech', skillTech: 1 }
        ]
      },
      1
    );
    const maximized = ['evt-max-a', 'evt-max-b', 'evt-max-c'].reduce(
      (state, id) =>
        applyTriggerEffect(state, {
          id,
          type: 'policy_change',
          label: id,
          source: 'mock:local',
          timestamp: '2026-06-01T00:00:00.000Z',
          effect: { talentCost: 100 }
        }),
      staffed
    );
    assert.equal(maximized.company.talentMultiplier, 1.75);
    assert.equal(maximized.company.talentCostFactor, 3);
    assert.equal(maximized.company.effectiveMultiplier, 5.25);
    assert.equal(maximized.company.burnRate, 14700);
    assert.equal(maximized.company.burnRate, 2800 * 1.75 * 3);
    assert.equal(Number.isFinite(maximized.company.burnRate), true);

    const minimized = applyTriggerEffect(staffed, {
      id: 'evt-wipe',
      type: 'market_shift',
      label: 'Wipe',
      source: 'mock:local',
      timestamp: '2026-06-01T00:00:00.000Z',
      effect: { talentCost: -1 }
    });
    assert.equal(minimized.company.talentMultiplier, 1.75);
    assert.equal(minimized.company.talentCostFactor, 0.1);
    assert.equal(minimized.company.talentCost, 0);
    assert.equal(minimized.company.burnRate, 490);
    assert.equal(minimized.company.burnRate, 2800 * 1.75 * 0.1);
    assert.ok(minimized.company.burnRate > 0);
  });
});

