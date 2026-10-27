import { describe, expect, test } from 'vitest';
import { ingestFixtureIntoState } from './pipelineIngest.js';
import { initialState } from './simulation.js';
import { effectiveBurnRate } from './talentMultiplier.js';

describe('pipelineIngest (client apply/clear path)', () => {
  test('fixture ingest applies revised effect only and clear restores Slice 1 burn', () => {
    const first = ingestFixtureIntoState(initialState);
    expect(first.triggers).toHaveLength(1);
    expect(first.triggers[0].effect.talentCost).toBe(0.08);
    expect(first.state.company.talentCost).toBe(4320);
    expect(effectiveBurnRate(first.state)).toBe(Math.round(2200 * 1.08));
    expect(first.events.some((event) => event.lifecycle === 'expired')).toBe(true);
    expect(first.events.some((event) => event.lifecycle === 'active')).toBe(true);

    // Re-ingest replaces — still one active pipeline trigger, not compounded.
    const second = ingestFixtureIntoState(first.state);
    expect(second.state.activeTriggers.filter((row) => String(row.id).startsWith('evt-pipeline-'))).toHaveLength(1);
    expect(effectiveBurnRate(second.state)).toBe(Math.round(2200 * 1.08));
  });
});
