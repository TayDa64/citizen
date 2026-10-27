import { describe, expect, test } from 'vitest';
import { collectFixtureObservations } from './adapters/fixtureAdapter.js';
import { collectHttpStubObservations } from './adapters/httpStubAdapter.js';
import {
  LIFECYCLE,
  activateInRegistry,
  activeTriggersFromRegistry,
  clearRegistry,
  discoverObservation,
  emptyPipelineRegistry,
  expireInRegistry,
  ingestObservation,
  ingestObservationsIntoRegistry,
  interpretEvent,
  normalizeEvent,
  toContractTrigger,
} from './eventPipeline.js';
import { applyTrigger, clearTriggers, initialState } from './simulation.js';
import { effectiveBurnRate } from './talentMultiplier.js';

describe('event pipeline — observation → interpretation → effect', () => {
  test('keeps observation, interpretation, and contract effect separate', () => {
    const [raw] = collectFixtureObservations();
    const discovered = discoverObservation(raw);
    expect(discovered.lifecycle).toBe(LIFECYCLE.DISCOVERED);
    expect(discovered.observation.sourceUrl).toContain('wage-bulletin');
    expect(discovered.observation.evidence.length).toBeGreaterThan(20);
    expect(discovered.interpretation).toBeNull();
    expect(discovered.effect).toBeNull();

    const normalized = normalizeEvent(discovered);
    expect(normalized.lifecycle).toBe(LIFECYCLE.NORMALIZED);

    const pending = interpretEvent(normalized);
    expect(pending.lifecycle).toBe(LIFECYCLE.PENDING);
    expect(pending.interpretation.type).toBe('policy_change');
    expect(pending.interpretation.label).toBe('Wage bulletin');
    expect(pending.effect).toEqual({ talentCost: 0.12 });
    expect(pending.provenance.sourceUrl).toBe(raw.sourceUrl);

    const trigger = toContractTrigger(pending);
    expect(trigger).toEqual({
      id: 'evt-pipeline-obs-civic-wage-bulletin-2026-04',
      type: 'policy_change',
      label: 'Wage bulletin',
      source: raw.sourceUrl,
      timestamp: '2026-04-02T14:55:00.000Z',
      effect: { talentCost: 0.12 },
    });
    // Observation evidence never leaks onto the wire trigger.
    expect(trigger.evidence).toBeUndefined();
    expect(trigger.provenance).toBeUndefined();
  });

  test('fixture adapter produces contract-valid triggers with provenance source', () => {
    const observations = collectFixtureObservations('civic-wage-bulletin');
    expect(observations).toHaveLength(2);
    expect(observations[0].adapterId).toBe('fixture');
    const pending = ingestObservation(observations[0]);
    const trigger = toContractTrigger(pending);
    expect(trigger.source).toMatch(/^https:\/\/example\.local\//);
  });

  test('http stub adapter shares the same Observation shape (Firecrawl plug-in point)', () => {
    const observations = collectHttpStubObservations([
      {
        id: 'obs-stub-news',
        sourceUrl: 'https://example.local/news/sector',
        observedAt: '2026-04-18T13:30:00.000Z',
        evidence: 'Stub headline: sector hype rises.',
        hints: {
          type: 'news_spike',
          label: 'Stub news',
          effect: { hype: 0.1 },
          rationale: 'Headline implies hype.',
        },
      },
    ]);
    const pending = ingestObservation(observations[0]);
    expect(pending.provenance.adapterId).toBe('http_stub');
    expect(toContractTrigger(pending).effect).toEqual({ hype: 0.1 });
  });
});

describe('event pipeline — lifecycle + no compounding', () => {
  test('re-activating the same observation replaces instead of stacking', () => {
    const [raw] = collectFixtureObservations();
    let registry = emptyPipelineRegistry();
    const first = ingestObservation(raw);
    ({ registry } = activateInRegistry(registry, first));
    expect(activeTriggersFromRegistry(registry)).toHaveLength(1);

    const again = ingestObservation({
      ...raw,
      hints: {
        ...raw.hints,
        effect: { talentCost: 0.2 },
        label: 'Wage bulletin (updated)',
      },
    });
    ({ registry } = activateInRegistry(registry, again));
    const active = activeTriggersFromRegistry(registry);
    expect(active).toHaveLength(1);
    expect(active[0].effect.talentCost).toBe(0.2);
    expect(active[0].label).toBe('Wage bulletin (updated)');
  });

  test('supersession expires prior event so effects do not compound', () => {
    const observations = collectFixtureObservations();
    const { registry } = ingestObservationsIntoRegistry(emptyPipelineRegistry(), observations);
    const active = activeTriggersFromRegistry(registry);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('evt-pipeline-obs-civic-wage-bulletin-2026-04-revision');
    expect(active[0].effect.talentCost).toBe(0.08);

    const prior = registry.events.find((event) => event.observation.id === observations[0].id);
    expect(prior.lifecycle).toBe(LIFECYCLE.EXPIRED);

    // Sim stack: only the superseding 8% factor, not 1.12 * 1.08.
    let state = initialState;
    for (const trigger of active) {
      state = applyTrigger(state, trigger);
    }
    expect(state.activeTriggers).toHaveLength(1);
    expect(state.company.talentCost).toBe(4320);
    expect(effectiveBurnRate(state)).toBe(Math.round(2200 * 1.08));
  });

  test('clear removes active effects without residual compounding', () => {
    const observations = collectFixtureObservations();
    let { registry } = ingestObservationsIntoRegistry(emptyPipelineRegistry(), observations);
    let state = initialState;
    for (const trigger of activeTriggersFromRegistry(registry)) {
      state = applyTrigger(state, trigger);
    }
    expect(effectiveBurnRate(state)).toBe(Math.round(2200 * 1.08));

    registry = clearRegistry(registry);
    expect(activeTriggersFromRegistry(registry)).toHaveLength(0);
    expect(registry.events.every((event) => (
      event.lifecycle === LIFECYCLE.CLEARED || event.lifecycle === LIFECYCLE.EXPIRED
    ))).toBe(true);

    state = clearTriggers(state);
    expect(state.activeTriggers).toHaveLength(0);
    expect(state.company.talentCost).toBe(4000);
    expect(effectiveBurnRate(state)).toBe(2200);
  });

  test('expire drops one event and leaves other actives', () => {
    const observations = collectFixtureObservations();
    // Activate first only (no supersession yet).
    let { registry } = ingestObservationsIntoRegistry(
      emptyPipelineRegistry(),
      [observations[0]],
    );
    expect(activeTriggersFromRegistry(registry)).toHaveLength(1);
    registry = expireInRegistry(registry, observations[0].id);
    expect(activeTriggersFromRegistry(registry)).toHaveLength(0);
    expect(registry.events[0].lifecycle).toBe(LIFECYCLE.EXPIRED);
  });

  test('campaign-shaped apply/clear path: pipeline triggers restack like SAMPLE', () => {
    const observations = collectFixtureObservations();
    const { registry } = ingestObservationsIntoRegistry(
      emptyPipelineRegistry(),
      [observations[0]],
    );
    const triggers = activeTriggersFromRegistry(registry);
    let state = applyTrigger(initialState, triggers[0]);
    expect(state.activeTriggers.map((row) => row.id)).toEqual([triggers[0].id]);
    // Re-apply same id replaces — burn stays 1.12×, not 1.12².
    state = applyTrigger(state, triggers[0]);
    expect(state.activeTriggers).toHaveLength(1);
    expect(effectiveBurnRate(state)).toBe(Math.round(2200 * 1.12));
    state = clearTriggers(state);
    expect(effectiveBurnRate(state)).toBe(2200);
  });
});
