/** Deterministic fixture observations for the real-world event pipeline. */
export const civicWageBulletin = Object.freeze({
  adapterId: 'fixture',
  fixtureId: 'civic-wage-bulletin',
  observations: Object.freeze([
    Object.freeze({
      id: 'obs-civic-wage-bulletin-2026-04',
      sourceUrl: 'https://example.local/civic/wage-bulletin-2026-04',
      observedAt: '2026-04-02T14:55:00.000Z',
      evidence:
        'City council posted a living-wage bulletin raising the recommended startup wage band by roughly twelve percent for tech roles in the metro.',
      hints: Object.freeze({
        type: 'policy_change',
        label: 'Wage bulletin',
        effect: Object.freeze({ talentCost: 0.12 }),
        rationale: 'Living-wage bulletin implies higher talent cost for local hires.',
      }),
    }),
    Object.freeze({
      id: 'obs-civic-wage-bulletin-2026-04-revision',
      sourceUrl: 'https://example.local/civic/wage-bulletin-2026-04-rev',
      observedAt: '2026-04-09T11:00:00.000Z',
      evidence:
        'Revision clarifies the wage band applies only to new contracts; net talent-cost pressure revised down to eight percent.',
      supersedes: 'obs-civic-wage-bulletin-2026-04',
      hints: Object.freeze({
        type: 'policy_change',
        label: 'Wage bulletin (revised)',
        effect: Object.freeze({ talentCost: 0.08 }),
        rationale: 'Revision narrows the bulletin; replace prior interpretation without stacking.',
      }),
    }),
  ]),
});
