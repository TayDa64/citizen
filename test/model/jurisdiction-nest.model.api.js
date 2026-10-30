// Model checks: which triggers a campaign gets (nest filter + tier sort).
//
// Pure — no Postgres. One named test per promise. Inputs come from the
// seeded generators in ./gen.js; a failure prints the seed and input.
//
// Code under check: src/jurisdictionNest.js (ancestorChainIds,
// filterTriggersForHome, sortTriggersForRestack, nestTriggersForRestack).
// The Postgres half (SQL CTE vs JS, campaign vs companies vs client) lives
// in jurisdiction-nest-db.model.api.js.
//
// Run: npm run check:model
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  JURISDICTION_SEED,
  TIER_RESTACK_ORDER,
  ancestorChainIds,
  filterTriggersForHome,
  nestTriggersForRestack,
} from '../../src/jurisdictionNest.js';
import { forAll, genForest, genTriggers, triggerFor } from './gen.js';

// Independent oracle: walk parent pointers from home, nothing else.
function oracleChain(homeId, forest) {
  const byId = new Map(forest.map((row) => [row.id, row]));
  if (homeId == null || homeId === '' || !byId.has(homeId)) return [];
  const out = [];
  let current = homeId;
  while (current != null && byId.has(current) && !out.includes(current)) {
    out.push(current);
    current = byId.get(current).parentId ?? byId.get(current).parent_id ?? null;
  }
  return out;
}

function tierOf(jurisdictionId, forest) {
  return forest.find((row) => row.id === jurisdictionId)?.tier ?? null;
}

function genCase(r, size) {
  const forest = genForest(r, size);
  const homeRoll = r.next();
  const homeId = homeRoll < 0.85 ? r.pick(forest).id : homeRoll < 0.9 ? null : homeRoll < 0.95 ? '' : 'nowhere';
  return { forest, homeId, triggers: genTriggers(r, forest, size) };
}

describe('jurisdiction nest model', () => {
  test('NestExactChain: result is exactly the triggers on home + ancestors', () => {
    forAll('NestExactChain', genCase, ({ forest, homeId, triggers }) => {
      const chain = new Set(oracleChain(homeId, forest));
      const expected = triggers.filter((t) => chain.has(t.jurisdictionId)).map((t) => t.id).sort();
      const actual = nestTriggersForRestack(triggers, homeId, forest).map((t) => t.id).sort();
      assert.deepEqual(actual, expected);
    });
  });

  test('NestNoPeersOrStrangers: no sibling, cousin, descendant, NULL or unknown jurisdiction', () => {
    forAll('NestNoPeersOrStrangers', genCase, ({ forest, homeId, triggers }) => {
      const chain = new Set(oracleChain(homeId, forest));
      for (const trigger of nestTriggersForRestack(triggers, homeId, forest)) {
        assert.ok(chain.has(trigger.jurisdictionId), `${trigger.id} @ ${trigger.jurisdictionId} is off the chain`);
      }
    });
  });

  test('NestNoDuplicates: unique ids in, unique ids out, nothing invented', () => {
    forAll('NestNoDuplicates', genCase, ({ forest, homeId, triggers }) => {
      const out = nestTriggersForRestack(triggers, homeId, forest);
      assert.equal(new Set(out.map((t) => t.id)).size, out.length);
      for (const trigger of out) assert.ok(triggers.includes(trigger), 'output must be input objects');
    });
  });

  test('NestTierOrder: federal → state → county → city, then client_id ascending', () => {
    forAll('NestTierOrder', genCase, ({ forest, homeId, triggers }) => {
      const out = nestTriggersForRestack(triggers, homeId, forest);
      for (let i = 1; i < out.length; i += 1) {
        const left = TIER_RESTACK_ORDER[tierOf(out[i - 1].jurisdictionId, forest)];
        const right = TIER_RESTACK_ORDER[tierOf(out[i].jurisdictionId, forest)];
        assert.ok(left < right || (left === right && out[i - 1].id < out[i].id),
          `${out[i - 1].id} must sort before ${out[i].id}`);
      }
    });
  });

  test('NestPermutationStable: reordering the input never changes the output', () => {
    forAll('NestPermutationStable', (r, size) => ({ ...genCase(r, size), order: r.next() }), ({ forest, homeId, triggers }, r) => {
      const base = nestTriggersForRestack(triggers, homeId, forest).map((t) => t.id);
      const shuffled = nestTriggersForRestack(r.shuffle(triggers), homeId, r.shuffle(forest)).map((t) => t.id);
      assert.deepEqual(shuffled, base);
    });
  });

  test('NestIdempotent: filtering an already-filtered stack changes nothing', () => {
    forAll('NestIdempotent', genCase, ({ forest, homeId, triggers }) => {
      const once = nestTriggersForRestack(triggers, homeId, forest);
      const twice = nestTriggersForRestack(once, homeId, forest);
      assert.deepEqual(twice.map((t) => t.id), once.map((t) => t.id));
    });
  });

  test('NestFailClosed: unknown, NULL or empty home and parent cycles give a finite, closed result', () => {
    const forest = [...JURISDICTION_SEED];
    const all = forest.map((row) => triggerFor(`evt-${row.id}`, row.id));
    for (const home of [null, undefined, '', 'nowhere']) {
      assert.deepEqual(nestTriggersForRestack(all, home, forest), []);
    }
    // a ↔ b cycle must terminate and still only bind the cycle members.
    const cyclic = [
      { id: 'a', tier: 'city', parentId: 'b' },
      { id: 'b', tier: 'county', parentId: 'a' },
      { id: 'c', tier: 'county', parentId: null },
    ];
    const ids = nestTriggersForRestack(
      cyclic.map((row) => triggerFor(`evt-${row.id}`, row.id)),
      'a',
      cyclic,
    ).map((t) => t.id);
    assert.deepEqual(ids, ['evt-b', 'evt-a']);
    assert.deepEqual(ancestorChainIds('a', cyclic), ['a', 'b']);
  });

  test('NestSeedLocks: mv binds mv + sc_county + ca + us; sunnyvale and NULL never bind mv', () => {
    const triggers = ['us', 'ca', 'sc_county', 'mv', 'sunnyvale', null].map((j, i) => triggerFor(`evt-${i}`, j));
    const out = nestTriggersForRestack(triggers, 'mv');
    assert.deepEqual(out.map((t) => t.jurisdictionId), ['us', 'ca', 'sc_county', 'mv']);
    assert.deepEqual(
      filterTriggersForHome(triggers, 'sunnyvale').map((t) => t.jurisdictionId).sort(),
      ['ca', 'sc_county', 'sunnyvale', 'us'],
    );
  });
});
