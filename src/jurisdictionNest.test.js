import { describe, expect, test } from 'vitest';
import { collectFixtureObservations } from './adapters/fixtureAdapter.js';
import { runPipelineIngest, validateIngestRequest } from '../server/eventIngest.js';
import { ingestObservation, toContractTrigger } from './eventPipeline.js';
import {
  FILTER_TRIGGERS_FOR_HOME_SQL,
  JURISDICTION_CHAIN_CTE,
  JURISDICTION_SEED,
  ancestorChainIds,
  filterTriggersForHome,
  resolveJurisdictionForClientId,
} from './jurisdictionNest.js';
import { applyTrigger, clearTriggers, initialState } from './simulation.js';
import { effectiveBurnRate } from './talentMultiplier.js';
import { TriggerValidationError, stackTriggerEffects } from './triggerContract.js';

const mvWage = Object.freeze({
  id: 'evt-pipeline-obs-civic-wage-bulletin-2026-04-revision',
  type: 'policy_change',
  label: 'Wage bulletin (revised)',
  source: 'https://example.local/civic/wage-bulletin-2026-04-rev',
  timestamp: '2026-04-09T11:00:00.000Z',
  effect: Object.freeze({ talentCost: 0.08 }),
  jurisdictionId: 'mv',
});

const sunnyvalePeer = Object.freeze({
  id: 'evt-sunnyvale-peer-wage',
  type: 'policy_change',
  label: 'Sunnyvale peer wage',
  source: 'mock:sunnyvale',
  timestamp: '2026-04-09T11:00:00.000Z',
  effect: Object.freeze({ talentCost: 0.5 }),
  jurisdictionId: 'sunnyvale',
});

const countyStack = Object.freeze({
  id: 'evt-sc-county-fee',
  type: 'policy_change',
  label: 'County operating fee',
  source: 'mock:sc-county',
  timestamp: '2026-04-01T00:00:00.000Z',
  effect: Object.freeze({ talentCost: 0.02 }),
  jurisdictionId: 'sc_county',
});

const nullJurisdiction = Object.freeze({
  ...mvWage,
  id: 'evt-null-jurisdiction',
  jurisdictionId: null,
});

describe('CIT-80 jurisdiction nest filter', () => {
  test('home mv chain is mv → sc_county → ca → us', () => {
    expect(ancestorChainIds('mv')).toEqual(['mv', 'sc_county', 'ca', 'us']);
    expect(JURISDICTION_SEED.map((row) => row.id)).toEqual([
      'us',
      'ca',
      'sc_county',
      'mv',
      'sunnyvale',
    ]);
  });

  test('home mv sees mv + ancestors; sunnyvale peer does not apply', () => {
    const applicable = filterTriggersForHome(
      [mvWage, sunnyvalePeer, countyStack, nullJurisdiction],
      'mv',
    );
    expect(applicable.map((trigger) => trigger.id).sort()).toEqual([
      mvWage.id,
      countyStack.id,
    ].sort());
    expect(applicable.some((trigger) => trigger.jurisdictionId === 'sunnyvale')).toBe(false);
  });

  test('NULL jurisdiction matches no campaign (fail closed)', () => {
    expect(filterTriggersForHome([nullJurisdiction], 'mv')).toEqual([]);
    expect(filterTriggersForHome([mvWage], null)).toEqual([]);
    expect(filterTriggersForHome([mvWage], 'unknown-city')).toEqual([]);
  });

  test('missing outer tier is identity — city wage alone still burns 2376 / clear 2200', () => {
    const applicable = filterTriggersForHome([mvWage], 'mv');
    expect(applicable).toHaveLength(1);
    expect(applicable[0].jurisdictionId).toBe('mv');
    // No federal/state/county rows in the filtered set → identity for those tiers.
    expect(applicable.every((trigger) => trigger.jurisdictionId === 'mv')).toBe(true);

    let state = applyTrigger(initialState, applicable[0]);
    expect(effectiveBurnRate(state)).toBe(Math.round(2200 * 1.08));
    expect(effectiveBurnRate(state)).toBe(2376);
    state = clearTriggers(state);
    expect(effectiveBurnRate(state)).toBe(2200);

    const stacked = stackTriggerEffects(
      { hype: 0.3, talentCost: 4000 },
      applicable.map(({ id, effect }) => ({ id, effect })),
    );
    expect(stacked.talentCost).toBe(4320);
  });

  test('sunnyvale peer alone does not move mv burn (stays 2200)', () => {
    const applicable = filterTriggersForHome([sunnyvalePeer], 'mv');
    expect(applicable).toEqual([]);
    expect(effectiveBurnRate(initialState)).toBe(2200);
  });

  test('wage bulletin fixture pack still burns 2376 after nest filter (wage→mv)', () => {
    const observations = collectFixtureObservations('civic-wage-bulletin');
    const pending = ingestObservation(observations[1]);
    const trigger = {
      ...toContractTrigger(pending),
      jurisdictionId: resolveJurisdictionForClientId(
        toContractTrigger(pending).id,
      ),
    };
    expect(trigger.jurisdictionId).toBe('mv');
    const applicable = filterTriggersForHome([trigger, sunnyvalePeer], 'mv');
    expect(applicable).toHaveLength(1);
    let state = applyTrigger(initialState, applicable[0]);
    expect(effectiveBurnRate(state)).toBe(2376);
    state = clearTriggers(state);
    expect(effectiveBurnRate(state)).toBe(2200);
  });

  test('firecrawl still rejected at pipeline entry', () => {
    expect(validateIngestRequest({ adapter: 'firecrawl' }).ok).toBe(false);
    expect(() => runPipelineIngest({ adapter: 'firecrawl' })).toThrow(TriggerValidationError);
  });

  test('SQL chain CTE matches wave2 recursive shape', () => {
    expect(JURISDICTION_CHAIN_CTE).toMatch(/WITH RECURSIVE chain AS/i);
    expect(JURISDICTION_CHAIN_CTE).toMatch(/JOIN chain c ON j\.id = c\.parent_id/);
    expect(FILTER_TRIGGERS_FOR_HOME_SQL).toMatch(
      /jurisdiction_id IN \(SELECT id FROM chain\)/,
    );
  });
});
