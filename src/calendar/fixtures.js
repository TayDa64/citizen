/**
 * Frozen `now` + fixture signals for the three-phase calendar reducer.
 * Mountain View council alone (wave2 lock). No live Legistar / Firecrawl.
 */

import { createMeetingRow, createPublicationRow } from './calendarReducer.js';
import { agendaWindowInstants, morningAfterMeeting, morningOfMeeting } from './scheduleMath.js';

const TZ = 'America/Los_Angeles';
const SOURCE = 'legistar:mountainview';

/** EventId 3367 — City Council Tue 2026-10-27 5:15 PM Pacific. */
export const MV_COUNCIL_3367_STARTS_AT = '2026-10-28T00:15:00.000Z'; // 2026-10-27 17:15 America/Los_Angeles (PDT UTC-7)

/** EventId 3363 — City Council Tue 2026-08-25 5:00 PM Pacific. */
export const MV_COUNCIL_3363_STARTS_AT = '2026-08-26T00:00:00.000Z';

/** EventId 3458 — Library board Mon 2026-09-21 7:00 PM Pacific. */
export const MV_LIBRARY_3458_STARTS_AT = '2026-09-22T02:00:00.000Z';

export const FIXTURE_IDS = Object.freeze([
  'mv-council-calendar-2026h2',
  'mv-council-agenda-3367',
  'mv-council-morning-3367',
  'mv-council-minutes-3363',
  'mv-library-minutes-3458',
  'civic-wage-bulletin',
]);

/** Phase A — months of events including 3367. No PDF bytes. */
export const mvCouncilCalendar2026h2 = Object.freeze({
  fixtureId: 'mv-council-calendar-2026h2',
  frozenNow: '2026-07-06T20:12:00.000Z',
  events: Object.freeze([
    Object.freeze({
      externalEventId: '3367',
      bodyName: 'City Council',
      startsAt: MV_COUNCIL_3367_STARTS_AT,
      detailUrl: 'https://mountainview.legistar.com/MeetingDetail.aspx?ID=3367',
    }),
    Object.freeze({
      externalEventId: '3363',
      bodyName: 'City Council',
      startsAt: MV_COUNCIL_3363_STARTS_AT,
      detailUrl: 'https://mountainview.legistar.com/MeetingDetail.aspx?ID=3363',
    }),
    Object.freeze({
      externalEventId: '3458',
      bodyName: 'Board of Library Trustees',
      startsAt: MV_LIBRARY_3458_STARTS_AT,
      detailUrl: 'https://mountainview.legistar.com/MeetingDetail.aspx?ID=3458',
    }),
  ]),
  signalOk: Object.freeze({
    type: 'calendar_sync',
    outcome: 'ok',
    fixtureId: 'mv-council-calendar-2026h2',
    events: Object.freeze([
      Object.freeze({
        externalEventId: '3367',
        bodyName: 'City Council',
        startsAt: MV_COUNCIL_3367_STARTS_AT,
        detailUrl: 'https://mountainview.legistar.com/MeetingDetail.aspx?ID=3367',
      }),
    ]),
  }),
  signalBlocked: Object.freeze({
    type: 'calendar_sync',
    outcome: 'blocked',
    error: 'legistar_unreachable',
    fixtureId: 'mv-council-calendar-2026h2',
  }),
});

export function seedRow3367Scheduled() {
  const windows = agendaWindowInstants(MV_COUNCIL_3367_STARTS_AT, TZ);
  return createMeetingRow({
    sourceId: SOURCE,
    externalEventId: '3367',
    bodyName: 'City Council',
    startsAt: MV_COUNCIL_3367_STARTS_AT,
    timezone: TZ,
    nextCheckAt: windows.first,
    phase: 'A',
    status: 'scheduled',
    fixtureId: 'mv-council-calendar-2026h2',
    expectedUrl: 'https://mountainview.legistar.com/MeetingDetail.aspx?ID=3367',
  });
}

/** Phase B — Friday 09:48-style post, then Revised. Zero triggers. */
export const mvCouncilAgenda3367 = Object.freeze({
  fixtureId: 'mv-council-agenda-3367',
  /** Friday morning before the 09:48 Pacific post — too early. */
  frozenNowEarly: '2026-10-23T13:00:00.000Z', // Fri 06:00 PDT
  /** Friday after 09:48 Pacific agenda post. */
  frozenNowFirstPost: '2026-10-23T17:00:00.000Z', // Fri ~10:00 PDT
  /** Later same day / research day with Revised stamp. */
  frozenNowRevised: '2026-10-24T01:00:00.000Z',
  signalEmpty: Object.freeze({
    type: 'agenda_check',
    outcome: 'empty',
    fixtureId: 'mv-council-agenda-3367',
  }),
  signalFirst: Object.freeze({
    type: 'agenda_check',
    outcome: 'ok',
    fixtureId: 'mv-council-agenda-3367',
    agendaStatus: 'Final',
    agendaUrl:
      'https://legistar1.granicus.com/mountainview/meetings/2026/10/3367_A_City_Council_26-10-27_Agenda_and_Notice.pdf',
    agendaPublishedAt: '2026-10-23T16:48:00.000Z',
  }),
  signalRevised: Object.freeze({
    type: 'agenda_check',
    outcome: 'ok',
    fixtureId: 'mv-council-agenda-3367',
    agendaStatus: 'Revised',
    agendaUrl:
      'https://legistar1.granicus.com/mountainview/meetings/2026/10/3367_A_City_Council_26-10-27_Agenda_and_Notice.pdf',
    agendaPublishedAt: '2026-10-23T22:37:08.307Z',
  }),
  signalBlocked: Object.freeze({
    type: 'agenda_check',
    outcome: 'blocked',
    error: 'agenda_fetch_blocked',
    fixtureId: 'mv-council-agenda-3367',
  }),
});

/** Morning-of: still on / moved / absent / blocked. */
export const mvCouncilMorning3367 = Object.freeze({
  fixtureId: 'mv-council-morning-3367',
  frozenNow: morningOfMeeting(MV_COUNCIL_3367_STARTS_AT, TZ),
  signalStillOn: Object.freeze({
    type: 'morning_check',
    outcome: 'still_on',
    fixtureId: 'mv-council-morning-3367',
  }),
  signalMoved: Object.freeze({
    type: 'morning_check',
    outcome: 'moved',
    startsAt: '2026-11-04T01:15:00.000Z',
    fixtureId: 'mv-council-morning-3367',
  }),
  signalAbsent: Object.freeze({
    type: 'morning_check',
    outcome: 'absent',
    fixtureId: 'mv-council-morning-3367',
  }),
  signalBlocked: Object.freeze({
    type: 'morning_check',
    outcome: 'blocked',
    error: 'calendar_blocked',
    fixtureId: 'mv-council-morning-3367',
  }),
});

/**
 * Phase C negative — EventId 3363: Final minutes status, file null.
 * Must NOT ingest. Media-only also waits.
 */
export const mvCouncilMinutes3363 = Object.freeze({
  fixtureId: 'mv-council-minutes-3363',
  frozenNowTPlus1: morningAfterMeeting(MV_COUNCIL_3363_STARTS_AT, TZ),
  frozenNowResearchDay: '2026-10-27T17:00:00.000Z',
  signalFinalNullFile: Object.freeze({
    type: 'minutes_check',
    outcome: 'ok',
    fixtureId: 'mv-council-minutes-3363',
    minutesStatus: 'Final',
    minutesUrl: null,
    minutesPublishedAt: null,
  }),
  signalMediaOnly: Object.freeze({
    type: 'minutes_check',
    outcome: 'ok',
    fixtureId: 'mv-council-minutes-3363',
    minutesStatus: 'Draft',
    minutesUrl: null,
    minutesPublishedAt: null,
    mediaOnly: true,
  }),
  signalEmpty: Object.freeze({
    type: 'minutes_check',
    outcome: 'empty',
    fixtureId: 'mv-council-minutes-3363',
  }),
  signalBlocked: Object.freeze({
    type: 'minutes_check',
    outcome: 'blocked',
    error: 'minutes_fetch_blocked',
    fixtureId: 'mv-council-minutes-3363',
  }),
});

export function seedRow3363MinutesWait() {
  return createMeetingRow({
    sourceId: SOURCE,
    externalEventId: '3363',
    bodyName: 'City Council',
    startsAt: MV_COUNCIL_3363_STARTS_AT,
    timezone: TZ,
    nextCheckAt: morningAfterMeeting(MV_COUNCIL_3363_STARTS_AT, TZ),
    phase: 'C',
    status: 'minutes_wait',
    fixtureId: 'mv-council-minutes-3363',
    agendaUrl:
      'https://legistar1.granicus.com/mountainview/meetings/2026/8/3363_A_City_Council_Agenda.pdf',
    agendaPublishedAt: '2026-08-20T23:04:15.527Z',
    backoffIndex: 0,
  });
}

/**
 * Phase C positive — library EventId 3458: file ~29 days later → one upsert.
 */
export const mvLibraryMinutes3458 = Object.freeze({
  fixtureId: 'mv-library-minutes-3458',
  frozenNowTPlus1: morningAfterMeeting(MV_LIBRARY_3458_STARTS_AT, TZ),
  frozenNowFile: '2026-10-20T17:00:00.000Z',
  signalTPlus1Empty: Object.freeze({
    type: 'minutes_check',
    outcome: 'empty',
    fixtureId: 'mv-library-minutes-3458',
  }),
  signalFile: Object.freeze({
    type: 'minutes_check',
    outcome: 'ok',
    fixtureId: 'mv-library-minutes-3458',
    minutesStatus: 'Final',
    minutesUrl:
      'https://legistar1.granicus.com/mountainview/meetings/2026/9/3458_M_Board_of_Library_Trustees_26-09-21_Advisory_Board_Minutes.pdf',
    minutesPublishedAt: '2026-10-20T16:35:16.597Z',
  }),
});

export function seedRow3458MinutesWait(backoffIndex = 0) {
  return createMeetingRow({
    sourceId: SOURCE,
    externalEventId: '3458',
    bodyName: 'Board of Library Trustees',
    startsAt: MV_LIBRARY_3458_STARTS_AT,
    timezone: TZ,
    nextCheckAt: morningAfterMeeting(MV_LIBRARY_3458_STARTS_AT, TZ),
    phase: 'C',
    status: 'minutes_wait',
    fixtureId: 'mv-library-minutes-3458',
    agendaUrl:
      'https://legistar1.granicus.com/mountainview/meetings/2026/9/3458_A_Board_of_Library_Trustees_26-09-21_Advisory_Board_Agenda.pdf',
    agendaPublishedAt: '2026-09-18T16:48:28.953Z',
    backoffIndex,
  });
}

/**
 * Publication path — civic-wage-bulletin. Phase C at observedAt.
 * Burn pack 2376 / clear 2200 stays on the existing fixture ingest path (untouched here).
 */
export const civicWageBulletinPublication = Object.freeze({
  fixtureId: 'civic-wage-bulletin',
  observedAt: '2026-04-02T14:55:00.000Z',
  frozenNow: '2026-04-02T14:55:00.000Z',
  sourceUrl: 'https://example.local/civic/wage-bulletin-2026-04',
  signalBody: Object.freeze({
    type: 'publication_check',
    outcome: 'ok',
    bodyPresent: true,
    observedAt: '2026-04-02T14:55:00.000Z',
    sourceUrl: 'https://example.local/civic/wage-bulletin-2026-04',
    fixtureId: 'civic-wage-bulletin',
  }),
  signalEmpty: Object.freeze({
    type: 'publication_check',
    outcome: 'empty',
    bodyPresent: false,
    fixtureId: 'civic-wage-bulletin',
  }),
});

export function seedWageBulletinPublicationRow() {
  return createPublicationRow({
    externalEventId: 'obs-civic-wage-bulletin-2026-04',
    startsAt: civicWageBulletinPublication.observedAt,
    timezone: 'UTC',
    nextCheckAt: civicWageBulletinPublication.observedAt,
    phase: 'A',
    status: 'scheduled',
    fixtureId: 'civic-wage-bulletin',
    expectedUrl: civicWageBulletinPublication.sourceUrl,
    bodyName: 'Wage bulletin',
  });
}

export function seedAgendaSeen3367() {
  const row = seedRow3367Scheduled();
  return {
    ...row,
    status: 'agenda_seen',
    phase: 'B',
    nextCheckAt: morningOfMeeting(MV_COUNCIL_3367_STARTS_AT, TZ),
    agendaUrl: mvCouncilAgenda3367.signalRevised.agendaUrl,
    agendaPublishedAt: mvCouncilAgenda3367.signalRevised.agendaPublishedAt,
    fixtureId: 'mv-council-agenda-3367',
  };
}

export function seedConfirmed3367() {
  const row = seedAgendaSeen3367();
  return {
    ...row,
    status: 'confirmed',
    phase: 'B',
    nextCheckAt: morningAfterMeeting(MV_COUNCIL_3367_STARTS_AT, TZ),
    fixtureId: 'mv-council-morning-3367',
  };
}
