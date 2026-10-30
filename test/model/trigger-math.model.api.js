// Model checks: trigger effect arithmetic, the 0.1×–3× talent-cost factor
// clamp, and the department/skill-weighted talent multiplier.
//
// Pure — no Postgres. One named test per promise; inputs from ./gen.js.
// Client code: src/simulationCore.js (combinedEffects via apply/remove/clear),
// src/talentMultiplier.js, src/turnEngine.js. Server code: src/triggerContract.js
// stackTriggerEffects (recomputeCompanies), src/talentBurn.js (listCompanies).
//
// Run: npm run check:model
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyTurnCommand, createGameState, replayCommands, stableMetrics } from '../../src/turnEngine.js';
import * as client from '../../src/talentMultiplier.js';
import * as server from '../../src/talentBurn.js';
import { stackTriggerEffects, TALENT_COST_COLUMN_MAX } from '../../src/triggerContract.js';
import { decimal, forAll, forEvery, permutations, sequences } from './gen.js';

const BASE = Object.freeze({ hype: 0.3, talentCost: 4000 });

function trigger(id, effect) {
  return { id, type: 'policy_change', label: id, source: 'mock:model', timestamp: '2026-01-01T00:00:00.000Z', effect };
}

/** Contract-valid effect: hype in [-1, 1], talentCost in [-100, 100], 4 dp. Biased toward small values. */
function genEffect(r) {
  const effect = {};
  const pickTalent = () => {
    const roll = r.next();
    if (roll < 0.5) return decimal(r, -0.5, 0.5);
    if (roll < 0.7) return decimal(r, -1, 1);
    if (roll < 0.8) return r.pick([-1, -0.9999, 1, 2]);
    return decimal(r, -5, 5);
  };
  const roll = r.next();
  if (roll < 0.7) effect.talentCost = pickTalent();
  if (roll > 0.4 || effect.talentCost == null) effect.hype = decimal(r, -1, 1);
  if (effect.talentCost === 0 && effect.hype == null) effect.talentCost = 0.01;
  if (effect.hype === 0 && effect.talentCost == null) effect.hype = 0.01;
  return effect;
}

function genStack(r, size) {
  const count = r.int(0, size + 1);
  return Array.from({ length: count }, (_, i) => trigger(`t${i}-${r.int(0, 99)}`, genEffect(r)));
}

function applyAll(state, triggers) {
  return triggers.reduce((s, t) => applyTurnCommand(s, { type: 'apply_trigger', trigger: t }).state, state);
}

function storable(triggers) {
  try {
    stackTriggerEffects(BASE, triggers);
    return true;
  } catch {
    return false;
  }
}

describe('trigger math model', () => {
  test('FactorWithinClamp: talentCostFactor is in [0.1, 3] for any stack, client and server', () => {
    forAll('FactorWithinClamp', genStack, (stack) => {
      const state = applyAll(createGameState(), stack);
      const clientFactor = client.talentCostFactorOf(state);
      const serverFactor = server.talentCostFactor(state.company.talentCost, BASE.talentCost);
      for (const f of [clientFactor, serverFactor]) {
        assert.ok(f >= 0.1 && f <= 3, `factor ${f} outside [0.1, 3]`);
      }
      const burn = client.effectiveBurnRate(state);
      assert.ok(Number.isFinite(burn) && burn >= 220 && burn <= 6600, `burn ${burn}`);
    }, { maxSize: 12 });
    // Exhaustive edge grid, including API-supplied factors.
    const edges = [-1e9, -1, 0, 0.0999, 0.1, 0.10004, 1, 2.99996, 3, 3.0001, 1e9, NaN, Infinity];
    for (const value of edges) {
      const f = client.resolveTalentCostFactor({ dataSource: 'api', talentCostFactor: value }).factor;
      assert.ok(f >= 0.1 && f <= 3, `api factor ${value} → ${f}`);
    }
  });

  test('CostEffectsAreMonotone: a cost-cutting event never raises talent cost; a cost-raising one never lowers it', () => {
    forAll('CostEffectsAreMonotone', (r, size) => ({ stack: genStack(r, size), extra: trigger('zz-extra', { talentCost: genEffect(r).talentCost ?? -2 }) }), ({ stack, extra }) => {
      const before = applyAll(createGameState(), stack).company.talentCost;
      const after = applyAll(createGameState(), [...stack, extra]).company.talentCost;
      if (extra.effect.talentCost <= 0) assert.ok(after <= before, `cut ${extra.effect.talentCost}: ${before} → ${after}`);
      if (extra.effect.talentCost >= 0) assert.ok(after >= before, `raise ${extra.effect.talentCost}: ${before} → ${after}`);
    }, { maxSize: 6 });
  });

  test('ClearReturnsToBaseline: apply any stack then clear (or remove one by one) gives exactly the Slice 1 numbers', () => {
    forAll('ClearReturnsToBaseline', genStack, (stack) => {
      const applied = applyAll(createGameState(), stack);
      const cleared = applyTurnCommand(applied, { type: 'clear_triggers' }).state;
      let removed = applied;
      for (const t of stack) removed = applyTurnCommand(removed, { type: 'remove_trigger', triggerId: t.id }).state;
      for (const s of [cleared, removed]) {
        assert.equal(s.company.talentCost, 4000);
        assert.equal(s.company.hype, 0.3);
        assert.equal(client.talentCostFactorOf(s), 1);
        assert.equal(client.effectiveBurnRate(s), 2200);
        assert.equal(s.activeTriggers.length, 0);
      }
    }, { maxSize: 10 });
  });

  test('OrderIndependent: every application order of a stack gives identical numbers; re-applying an id does not compound', () => {
    forAll('OrderIndependent', (r, size) => genStack(r, Math.min(size, 4)), (stack) => {
      const commands = (list) => list.map((t) => ({ type: 'apply_trigger', trigger: t }));
      const reference = stableMetrics(replayCommands(createGameState(), commands(stack)).state);
      for (const order of permutations(stack)) {
        const metrics = stableMetrics(replayCommands(createGameState(), commands(order)).state);
        assert.deepEqual(metrics, reference);
      }
      const twice = stableMetrics(replayCommands(createGameState(), commands([...stack, ...stack])).state);
      assert.deepEqual(twice, reference);
    }, { runs: 150 });
  });

  test('TaxAndEventsCommute: set_tax and apply_trigger commute, and a tax round trip restores hype', () => {
    const taxes = [0, 0.1, 0.25, 0.5, 1];
    forAll('TaxAndEventsCommute', (r, size) => ({ stack: genStack(r, size), tax: r.pick(taxes) }), ({ stack, tax }) => {
      const eventsThenTax = applyTurnCommand(applyAll(createGameState(), stack), { type: 'set_tax', taxRate: tax }).state;
      const taxThenEvents = applyAll(applyTurnCommand(createGameState(), { type: 'set_tax', taxRate: tax }).state, stack);
      assert.equal(eventsThenTax.company.hype, taxThenEvents.company.hype, 'hype differs by order');
      assert.equal(client.effectiveBurnRate(eventsThenTax), client.effectiveBurnRate(taxThenEvents));
      const roundTrip = applyTurnCommand(eventsThenTax, { type: 'set_tax', taxRate: 0.25 }).state;
      assert.equal(roundTrip.company.hype, applyAll(createGameState(), stack).company.hype, 'tax round trip');
    }, { maxSize: 6 });
  });

  test('MultiplierAsDocumented: mean of weight(dept) × (1 + 0.8 (skill − 0.5)), rounded to 4 dp; mix sums exactly', () => {
    const WEIGHT = { tech: 1.25, marketing: 1.05, sales: 0.95 };
    const SKILL = { tech: 'skillTech', marketing: 'skillMarketing', sales: 'skillSales' };
    const clamp01 = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0.5 : Math.min(1, Math.max(0, Number(v))));
    const oracle = (employees) => {
      const active = employees.filter((e) => e.isActive !== false);
      if (active.length === 0) return 1;
      const factors = active.map((e) => {
        const dept = typeof e.department === 'string' ? e.department.trim().toLowerCase() : '';
        const skill = SKILL[dept]
          ? clamp01(e[SKILL[dept]])
          : (clamp01(e.skillTech) + clamp01(e.skillMarketing) + clamp01(e.skillSales)) / 3;
        return (WEIGHT[dept] ?? 1) * (1 + 0.8 * (skill - 0.5));
      });
      return Math.round(factors.reduce((a, b) => a + b, 0) / factors.length * 1e4 + 1e-6) / 1e4;
    };
    const genSkill = (r) => r.pick([0, 0.25, 0.5, 1, null, -1, 2, decimal(r, 0, 1, 2)]);
    const genEmployees = (r, size) => Array.from({ length: r.int(0, size) }, (_, i) => ({
      id: `e${i}`,
      department: r.pick(['tech', 'marketing', 'sales', 'Tech ', 'ops', '', null]),
      skillTech: genSkill(r),
      skillMarketing: genSkill(r),
      skillSales: genSkill(r),
      isActive: r.bool(0.85),
    }));
    forAll('MultiplierAsDocumented', genEmployees, (employees) => {
      const { talentMultiplier, talentMix } = client.composeTalentMultiplier({ employees });
      assert.ok(Math.abs(talentMultiplier - oracle(employees)) < 1e-9, `${talentMultiplier} vs oracle ${oracle(employees)}`);
      if (talentMix.length > 0) {
        const sum = talentMix.reduce((acc, g) => acc + Math.round(g.contribution * 1e4), 0);
        assert.equal(sum, Math.round(talentMultiplier * 1e4));
      } else {
        assert.equal(talentMultiplier, 1);
      }
    }, { maxSize: 10 });
  });

  test('Slice1Baselines: burn 2200 with no events, 2376 with the wage event, talent cost 4000 baseline', () => {
    const fresh = createGameState();
    assert.equal(fresh.company.talentCost, 4000);
    assert.equal(client.effectiveBurnRate(fresh), 2200);
    assert.equal(client.talentCostFactorOf(fresh), 1);
    const wage = applyAll(fresh, [trigger('evt-wage', { talentCost: 0.08 })]);
    assert.equal(wage.company.talentCost, 4320);
    assert.equal(client.talentCostFactorOf(wage), 1.08);
    assert.equal(client.effectiveBurnRate(wage), 2376);
    assert.equal(server.burnFromTax(0.25, 1, server.talentCostFactor(4320, 4000)).burnRate, 2376);
    const advanced = applyTurnCommand(wage, { type: 'advance_turn' }).state;
    assert.equal(advanced.company.burnRate, 2376);
    assert.equal(advanced.company.cash, 15000 - 2376 / 12);
  });

  test('ClientMatchesServer: talent cost, hype, factor, clamp flag, multiplier and burn are identical', () => {
    forAll('ClientMatchesServer', genStack, (stack) => {
      if (!storable(stack)) return; // server refuses to store it; client clamps (documented).
      const state = applyAll(createGameState(), stack);
      const stacked = stackTriggerEffects(BASE, stack);
      assert.equal(state.company.talentCost, stacked.talentCost, 'talentCost');
      assert.equal(state.company.hype, stacked.hype, 'hype');
      const s = server.resolveTalentCostFactor(stacked.talentCost, BASE.talentCost);
      assert.equal(client.talentCostFactorOf(state), s.talentCostFactor);
      assert.equal(client.talentCostFactorClampedOf(state), s.talentCostFactorClamped);
      assert.equal(client.effectiveBurnRate(state), server.burnFromTax(state.taxRate, 1, s.talentCostFactor).burnRate);
    }, { maxSize: 10 });
    // Employee multiplier: both modules, every 0–3 person roster over a small grid.
    const people = [];
    for (const department of ['tech', 'marketing', 'sales', 'ops', null]) {
      for (const skill of [0, 0.5, 1]) people.push({ department, skillTech: skill, skillMarketing: skill, skillSales: 1 - skill });
    }
    const checked = forEvery('ClientMatchesServer(multiplier)', sequences(people, 2), (employees) => {
      const a = client.composeTalentMultiplier({ employees });
      const b = server.composeTalentMultiplier({ employees });
      assert.deepEqual(a, b);
      for (const tax of [0, 0.25, 1]) {
        for (const factor of [0.1, 1, 1.08, 3]) {
          const state = { taxRate: tax, employees, dataSource: 'local', company: { talentCost: 4000 * factor }, baselines: BASE };
          assert.equal(client.effectiveBurnRate(state), server.burnFromTax(tax, b.talentMultiplier, factor).burnRate);
          assert.equal(client.effectiveMultiplierOf(state), server.effectiveMultiplier(b.talentMultiplier, factor));
        }
      }
    });
    assert.ok(checked > 200);
    assert.ok(TALENT_COST_COLUMN_MAX > 0);
  });
});
