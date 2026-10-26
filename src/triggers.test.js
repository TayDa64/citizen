import { describe, expect, test } from 'vitest';
import {
  SAMPLE_TRIGGERS,
  TRIGGER_CONTRACT,
  assertValidTrigger,
  describeTrigger,
  formatDollars,
  formatSignedPercent,
  formatTalentDollars,
  projectedTalentDollars,
  triggerDiagramOverlay,
} from './triggers';

const policy = () => SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');
const news = () => SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'news_spike');
const market = () => SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'market_shift');

describe('trigger contract', () => {
  test('documents one payload shape for the backend', () => {
    expect(TRIGGER_CONTRACT.version).toBe(1);
    expect([...TRIGGER_CONTRACT.fields]).toEqual([
      'id',
      'type',
      'label',
      'source',
      'timestamp',
      'effect',
    ]);
    expect([...TRIGGER_CONTRACT.types]).toEqual([
      'news_spike',
      'policy_change',
      'market_shift',
    ]);
    expect(Object.keys(TRIGGER_CONTRACT.effectFields)).toEqual(['hype', 'talentCost']);
  });

  test('sample triggers are frozen local mocks in that shape', () => {
    expect(SAMPLE_TRIGGERS.map((trigger) => trigger.id)).toEqual([
      'evt-policy-wage-ordinance',
      'evt-news-sector-spike',
      'evt-market-cooling',
    ]);

    for (const trigger of SAMPLE_TRIGGERS) {
      expect(Object.keys(trigger).sort()).toEqual([
        'effect',
        'id',
        'label',
        'source',
        'timestamp',
        'type',
      ]);
      expect(trigger.source).toBe('mock:local');
      expect(Number.isNaN(Date.parse(trigger.timestamp))).toBe(false);
      expect(TRIGGER_CONTRACT.types).toContain(trigger.type);
      assertValidTrigger(trigger);
    }

    expect(Object.isFrozen(SAMPLE_TRIGGERS)).toBe(true);
    expect(Object.isFrozen(policy().effect)).toBe(true);
    expect(() => {
      policy().effect.talentCost = 1;
    }).toThrow(TypeError);
  });

  test('policy change announces talent cost +12%', () => {
    expect(policy().effect).toEqual({ talentCost: 0.12 });
    expect(describeTrigger(policy())).toBe('Policy change: talent cost +12%');
    expect(describeTrigger(news())).toBe('News spike: hype +10%');
    expect(describeTrigger(market())).toBe('Market shift: talent cost -8%, hype -5%');
  });

  test('rejects payloads outside the contract', () => {
    expect(() => assertValidTrigger({ id: 'x' })).toThrow(TypeError);
    expect(() =>
      assertValidTrigger({
        id: 'x',
        type: 'alien_invasion',
        label: 'Alien invasion',
        source: 'mock:local',
        timestamp: '2026-04-02T15:00:00.000Z',
        effect: { hype: 0.1 },
      })
    ).toThrow(TypeError);
    expect(() =>
      assertValidTrigger({
        id: 'x',
        type: 'policy_change',
        label: 'Policy change',
        source: 'mock:local',
        timestamp: '2026-04-02T15:00:00.000Z',
        effect: { talentCost: 0.12, burnRate: 1 },
      })
    ).toThrow(/burnRate/);
    expect(() =>
      assertValidTrigger({
        id: 'x',
        type: 'policy_change',
        label: 'Policy change',
        source: 'mock:local',
        timestamp: 'not-a-date',
        effect: { talentCost: 0.12 },
      })
    ).toThrow(TypeError);
  });

  test('accepts only finite deltas inside the API bounds with at most 4 decimal places', () => {
    const base = {
      id: 'x',
      type: 'policy_change',
      label: 'Policy change',
      source: 'mock:local',
      timestamp: '2026-04-02T15:00:00.000Z',
    };

    expect(assertValidTrigger({ ...base, effect: { hype: -1, talentCost: 0 } })).toMatchObject({
      effect: { hype: -1, talentCost: 0 },
    });
    expect(assertValidTrigger({ ...base, effect: { hype: 1 } }).effect.hype).toBe(1);
    expect(assertValidTrigger({ ...base, effect: { talentCost: -100 } }).effect.talentCost).toBe(-100);
    expect(assertValidTrigger({ ...base, effect: { talentCost: 100 } }).effect.talentCost).toBe(100);
    expect(assertValidTrigger({ ...base, effect: { hype: 0.1234 } }).effect.hype).toBe(0.1234);
    expect(assertValidTrigger({ ...base, effect: { hype: 0, talentCost: 0.12 } }).effect).toEqual({
      hype: 0,
      talentCost: 0.12,
    });

    expect(() => assertValidTrigger({ ...base, effect: { hype: Number.POSITIVE_INFINITY } })).toThrow(
      /finite/
    );
    expect(() => assertValidTrigger({ ...base, effect: { talentCost: Number.NaN } })).toThrow(TypeError);
    expect(() => assertValidTrigger({ ...base, effect: { hype: 1.0001 } })).toThrow(/between -1 and 1/);
    expect(() => assertValidTrigger({ ...base, effect: { hype: -1.0001 } })).toThrow(/between -1 and 1/);
    expect(() => assertValidTrigger({ ...base, effect: { talentCost: 100.0001 } })).toThrow(
      /between -100 and 100/
    );
    expect(() => assertValidTrigger({ ...base, effect: { talentCost: -100.0001 } })).toThrow(
      /between -100 and 100/
    );
    expect(() => assertValidTrigger({ ...base, effect: { hype: 0.123456 } })).toThrow(/4 decimal places/);
    expect(() => assertValidTrigger({ ...base, effect: { talentCost: 0.00001 } })).toThrow(/4 decimal places/);
    expect(() => assertValidTrigger({ ...base, effect: { hype: 0, talentCost: 0 } })).toThrow(
      /hype or talentCost/
    );
    expect(() => assertValidTrigger({ ...base, id: 'x'.repeat(201), effect: { hype: 0.1 } })).toThrow(/1–200/);
    expect(assertValidTrigger({ ...base, id: 'x'.repeat(200), effect: { hype: 0.1 } }).id).toHaveLength(200);
  });
});

describe('talent cost dollars', () => {
  test('formats talent cost with the same thousands separator as burn and cash', () => {
    expect(projectedTalentDollars(4000, 0.12)).toBe(4480);
    expect(formatTalentDollars(4480)).toBe('$4,480');
    expect(formatTalentDollars(projectedTalentDollars(4000, 0.12))).toBe('$4,480');
    expect(formatDollars(4480)).toBe(formatTalentDollars(4480));
    expect(formatDollars(15000)).toBe('$15,000');
    expect(formatDollars(2200)).toBe('$2,200');
    expect(formatSignedPercent(0.12)).toBe('+12%');
    expect(formatTalentDollars(4121.6)).toBe('$4,121.60');
    expect(formatDollars(4121.6)).toBe('$4,121.60');
    expect(formatTalentDollars(-4121.6)).toBe('-$4,121.60');
    expect(projectedTalentDollars(4000, -0.08)).toBe(3680);
  });
});

describe('formatSignedPercent', () => {
  test('formats positive, negative, and fractional deltas', () => {
    expect(formatSignedPercent(0.12)).toBe('+12%');
    expect(formatSignedPercent(-0.08)).toBe('-8%');
    expect(formatSignedPercent(0)).toBe('0%');
    expect(formatSignedPercent(0.0304)).toBe('+3%');
  });
});

describe('triggerDiagramOverlay', () => {
  const quiet = {
    company: { hype: 0.3, talentCost: 1 },
    baselines: { hype: 0.3, talentCost: 1 },
    activeTriggers: [],
  };

  test('matches the Slice 1 labels when no trigger is active', () => {
    expect(triggerDiagramOverlay(quiet)).toEqual({
      nodeLabels: {
        3: 'Hire Staff\n(Tech / Marketing / Sales)\nTalent ×1.0000\nno employees',
        5: 'Real-World Triggers\n(Firecrawl + Events)',
        7: 'Launch / Market / Sell\nTrack Runway & Hype\nBurn: $2,200 (base $2,200)',
        'civic-infra': 'Civic Lever:\nInfrastructure / Talent',
      },
      edgeLabels: {
        'einfra-7': 'talent cost',
      },
      hypeNode: null,
    });
  });

  test('shows a talent-cost delta on the infrastructure node and edge', () => {
    const overlay = triggerDiagramOverlay({
      company: { hype: 0.3, talentCost: 1.12 },
      baselines: { hype: 0.3, talentCost: 1 },
      activeTriggers: [policy()],
    });

    expect(overlay.nodeLabels['5']).toBe(
      'Real-World Triggers\n(Firecrawl + Events)\nPolicy change'
    );
    expect(overlay.nodeLabels['civic-infra']).toContain('▲');
    expect(overlay.nodeLabels['civic-infra']).toContain('talent cost +12%');
    expect(overlay.edgeLabels['einfra-7']).toBe('talent cost +12%');
    expect(overlay.hypeNode).toBeNull();
  });

  test('shows an API talent multiplier on the infrastructure edge', () => {
    const overlay = triggerDiagramOverlay({
      dataSource: 'api',
      talentMultiplier: 1.28,
      company: { hype: 0.3, talentCost: 4000 },
      baselines: { hype: 0.3, talentCost: 4000 },
      activeTriggers: [],
    });
    expect(overlay.edgeLabels['einfra-7']).toBe('×1.2800 talent');
    expect(overlay.nodeLabels['civic-infra']).toContain('×1.2800 talent');
    expect(overlay.nodeLabels[3]).toContain('Talent ×1.2800');
    expect(overlay.nodeLabels[3]).toContain('no employees');
    expect(overlay.nodeLabels[7]).toBe(
      'Launch / Market / Sell\nTrack Runway & Hype\nBurn: $2,816 (base $2,200)'
    );
  });

  test('adds a hype node only when hype moved', () => {
    const overlay = triggerDiagramOverlay({
      company: { hype: 0.4, talentCost: 1 },
      baselines: { hype: 0.3, talentCost: 1 },
      activeTriggers: [news()],
    });

    expect(overlay.nodeLabels['civic-infra']).toBe('Civic Lever:\nInfrastructure / Talent');
    expect(overlay.hypeNode).toMatchObject({
      id: 'hype',
      label: expect.stringContaining('hype +10%'),
    });
    expect(overlay.hypeNode.edgeLabel).toContain('hype +10%');
  });
});
