/**
 * CIT-101 — Phase C positive minutes pack (library EventId 3458).
 * File + document timestamp → TRIGGER_CONTRACT hype and/or talentCost only.
 * Calendar signal timestamps stay aligned with src/calendar/fixtures.js.
 */

export const MV_LIBRARY_MINUTES_SOURCE_URL =
  'https://legistar1.granicus.com/mountainview/meetings/2026/9/3458_M_Board_of_Library_Trustees_26-09-21_Advisory_Board_Minutes.pdf';

/** Document timestamp — identical re-ingest must yield changed=false. */
export const MV_LIBRARY_MINUTES_PUBLISHED_AT = '2026-10-20T16:35:16.597Z';

export const MV_LIBRARY_MINUTES_OBSERVATION_ID = 'obs-mv-library-minutes-3458';

export const mvLibraryMinutes3458Fixture = Object.freeze({
  adapterId: 'fixture',
  fixtureId: 'mv-library-minutes-3458',
  observations: Object.freeze([
    Object.freeze({
      id: MV_LIBRARY_MINUTES_OBSERVATION_ID,
      sourceUrl: MV_LIBRARY_MINUTES_SOURCE_URL,
      observedAt: MV_LIBRARY_MINUTES_PUBLISHED_AT,
      evidence:
        'Board of Library Trustees minutes record a community talent stipend and '
        + 'local attention around the advisory board session; interpret as modest '
        + 'talent-cost pressure plus a small hype bump (contract keys only).',
      hints: Object.freeze({
        type: 'policy_change',
        label: 'Library board minutes',
        effect: Object.freeze({
          talentCost: 0.05,
          hype: 0.04,
        }),
        rationale:
          'Minutes body (not agenda pointer) maps stipend → talentCost and '
          + 'board attention → hype; no taxRate write.',
      }),
    }),
  ]),
});
