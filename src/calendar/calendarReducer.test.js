import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  createMeetingRow,
  createPublicationRow,
  reduceMeetingRow,
  rowHorizonIso,
} from './calendarReducer.js';
import {
  FIXTURE_IDS,
  civicWageBulletinPublication,
  mvCouncilAgenda3367,
  mvCouncilCalendar2026h2,
  mvCouncilMinutes3363,
  mvCouncilMorning3367,
  mvLibraryMinutes3458,
  seedAgendaSeen3367,
  seedConfirmed3367,
  seedRow3363MinutesWait,
  seedRow3367Scheduled,
  seedRow3458MinutesWait,
  seedWageBulletinPublicationRow,
} from './fixtures.js';
import { isPastHorizon, minutesBackoffCheckAt } from './scheduleMath.js';
import { collectFixtureObservations } from '../adapters/fixtureAdapter.js';
import { ingestObservation, toContractTrigger } from '../eventPipeline.js';
import { applyTrigger, clearTriggers, initialState } from '../simulation.js';
import { effectiveBurnRate } from '../talentMultiplier.js';

describe('calendar reducer — Phase A calendar sync', () => {
  test('mv-council-calendar-2026h2 upserts identity and sets agenda-window next_check', () => {
    const row = seedRow3367Scheduled();
    const now = mvCouncilCalendar2026h2.frozenNow;
    const next = reduceMeetingRow(row, now, mvCouncilCalendar2026h2.signalOk);
    expect(next.status).toBe('scheduled');
    expect(next.phase).toBe('A');
    expect(next.externalEventId).toBe('3367');
    expect(next.fixtureId).toBe('mv-council-calendar-2026h2');
    expect(next.expectedUrl).toContain('3367');
    expect(Date.parse(next.nextCheckAt)).toBeLessThan(Date.parse(row.startsAt));
    expect(next.stdout).toBe('calendar=upserted');
  });

  test('blocked calendar sync never cancels and keeps last-good row', () => {
    const row = seedRow3367Scheduled();
    const next = reduceMeetingRow(
      row,
      mvCouncilCalendar2026h2.frozenNow,
      mvCouncilCalendar2026h2.signalBlocked,
    );
    expect(next.status).toBe('scheduled');
    expect(next.changed).toBe(false);
    expect(next.lastError).toBe('legistar_unreachable');
    expect(next.stdout).toBe('calendar=blocked');
    expect(next.startsAt).toBe(row.startsAt);
  });
});

describe('calendar reducer — Phase B agenda window', () => {
  test('Friday 06:00 empty agenda stays agenda_due (pending), not blocked', () => {
    const row = seedRow3367Scheduled();
    const next = reduceMeetingRow(
      row,
      mvCouncilAgenda3367.frozenNowEarly,
      mvCouncilAgenda3367.signalEmpty,
    );
    expect(next.status).toBe('agenda_due');
    expect(next.phase).toBe('B');
    expect(next.agendaUrl).toBeNull();
    expect(next.stdout).toBe('agenda=pending');
    expect(next.changed).toBe(true);
  });

  test('Friday post stores agenda pointer with zero ingest side-effects (agenda_seen)', () => {
    const row = seedRow3367Scheduled();
    const next = reduceMeetingRow(
      row,
      mvCouncilAgenda3367.frozenNowFirstPost,
      mvCouncilAgenda3367.signalFirst,
    );
    expect(next.status).toBe('agenda_seen');
    expect(next.agendaUrl).toContain('3367_A_');
    expect(next.agendaPublishedAt).toBe('2026-10-23T16:48:00.000Z');
    expect(next.stdout).toBe('agenda=seen');
    expect(next.minutesUrl).toBeNull();
  });

  test('Revised agenda timestamp updates pointer (agenda=revised)', () => {
    const seen = reduceMeetingRow(
      seedRow3367Scheduled(),
      mvCouncilAgenda3367.frozenNowFirstPost,
      mvCouncilAgenda3367.signalFirst,
    );
    const revised = reduceMeetingRow(
      seen,
      mvCouncilAgenda3367.frozenNowRevised,
      mvCouncilAgenda3367.signalRevised,
    );
    expect(revised.status).toBe('agenda_seen');
    expect(revised.agendaPublishedAt).toBe('2026-10-23T22:37:08.307Z');
    expect(revised.stdout).toBe('agenda=revised');
    expect(revised.changed).toBe(true);
  });

  test('blocked agenda fetch keeps last-good pointer', () => {
    const seen = reduceMeetingRow(
      seedRow3367Scheduled(),
      mvCouncilAgenda3367.frozenNowFirstPost,
      mvCouncilAgenda3367.signalFirst,
    );
    const blocked = reduceMeetingRow(
      seen,
      mvCouncilAgenda3367.frozenNowRevised,
      mvCouncilAgenda3367.signalBlocked,
    );
    expect(blocked.status).toBe('agenda_seen');
    expect(blocked.agendaUrl).toBe(seen.agendaUrl);
    expect(blocked.changed).toBe(false);
    expect(blocked.stdout).toBe('agenda=blocked');
  });
});

describe('calendar reducer — Phase B morning-of', () => {
  test('still on → confirmed', () => {
    const next = reduceMeetingRow(
      seedAgendaSeen3367(),
      mvCouncilMorning3367.frozenNow,
      mvCouncilMorning3367.signalStillOn,
    );
    expect(next.status).toBe('confirmed');
    expect(next.stdout).toBe('meeting=still_on');
  });

  test('absent from successful calendar → cancelled', () => {
    const next = reduceMeetingRow(
      seedAgendaSeen3367(),
      mvCouncilMorning3367.frozenNow,
      mvCouncilMorning3367.signalAbsent,
    );
    expect(next.status).toBe('cancelled');
    expect(next.stdout).toBe('meeting=cancelled');
    expect(next.changed).toBe(true);
  });

  test('moved meeting resets to scheduled with new windows', () => {
    const next = reduceMeetingRow(
      seedAgendaSeen3367(),
      mvCouncilMorning3367.frozenNow,
      mvCouncilMorning3367.signalMoved,
    );
    expect(next.status).toBe('scheduled');
    expect(next.phase).toBe('A');
    expect(next.startsAt).toBe(mvCouncilMorning3367.signalMoved.startsAt);
    expect(next.agendaUrl).toBeNull();
    expect(next.stdout).toBe('meeting=moved');
  });

  test('blocked morning fetch never cancels', () => {
    const row = seedAgendaSeen3367();
    const next = reduceMeetingRow(
      row,
      mvCouncilMorning3367.frozenNow,
      mvCouncilMorning3367.signalBlocked,
    );
    expect(next.status).toBe('agenda_seen');
    expect(next.changed).toBe(false);
    expect(next.stdout).toBe('meeting=blocked');
    expect(next.lastError).toBe('calendar_blocked');
  });
});

describe('calendar reducer — Phase C minutes', () => {
  test('Final + null file must NOT ingest (mv-council-minutes-3363)', () => {
    const next = reduceMeetingRow(
      seedRow3363MinutesWait(),
      mvCouncilMinutes3363.frozenNowTPlus1,
      mvCouncilMinutes3363.signalFinalNullFile,
    );
    expect(next.status).toBe('minutes_wait');
    expect(next.minutesUrl).toBeNull();
    expect(next.minutesPublishedAt).toBeNull();
    expect(next.stdout).toBe('minutes=wait');
    expect(next.changed).toBe(false);
    expect(next.agendaUrl).toBeTruthy();
  });

  test('media-only stays minutes_wait', () => {
    const next = reduceMeetingRow(
      seedRow3363MinutesWait(),
      mvCouncilMinutes3363.frozenNowTPlus1,
      mvCouncilMinutes3363.signalMediaOnly,
    );
    expect(next.status).toBe('minutes_wait');
    expect(next.stdout).toBe('minutes=media_only');
  });

  test('T+1 null stays wait with changed=false', () => {
    const next = reduceMeetingRow(
      seedRow3458MinutesWait(0),
      mvLibraryMinutes3458.frozenNowTPlus1,
      mvLibraryMinutes3458.signalTPlus1Empty,
    );
    expect(next.status).toBe('minutes_wait');
    expect(next.changed).toBe(false);
    expect(next.backoffIndex).toBe(1);
    expect(Date.parse(next.nextCheckAt)).toBeGreaterThan(
      Date.parse(mvLibraryMinutes3458.frozenNowTPlus1),
    );
  });

  test('library minutes file at +29d upserts once → ingested', () => {
    const waiting = seedRow3458MinutesWait(4);
    const next = reduceMeetingRow(
      waiting,
      mvLibraryMinutes3458.frozenNowFile,
      mvLibraryMinutes3458.signalFile,
    );
    expect(next.status).toBe('ingested');
    expect(next.minutesUrl).toContain('3458_M_');
    expect(next.minutesPublishedAt).toBe('2026-10-20T16:35:16.597Z');
    expect(next.changed).toBe(true);
    expect(next.stdout).toBe('minutes=ingested');

    const replay = reduceMeetingRow(
      next,
      mvLibraryMinutes3458.frozenNowFile,
      mvLibraryMinutes3458.signalFile,
    );
    expect(replay.status).toBe('ingested');
    expect(replay.changed).toBe(false);
  });

  test('blocked minutes fetch never cancels and leaves agenda pointer', () => {
    const row = seedRow3363MinutesWait();
    const next = reduceMeetingRow(
      row,
      mvCouncilMinutes3363.frozenNowTPlus1,
      mvCouncilMinutes3363.signalBlocked,
    );
    expect(next.status).toBe('minutes_wait');
    expect(next.changed).toBe(false);
    expect(next.agendaUrl).toBe(row.agendaUrl);
    expect(next.stdout).toBe('minutes=blocked');
  });

  test('after horizon → unchanged and stay closed (no reopen on later file)', () => {
    const row = seedRow3363MinutesWait();
    const pastHorizon = rowHorizonIso(row);
    const closed = reduceMeetingRow(row, pastHorizon, mvCouncilMinutes3363.signalEmpty);
    expect(closed.status).toBe('unchanged');
    expect(closed.stdout).toBe('minutes=unchanged');

    const lateFile = {
      type: 'minutes_check',
      outcome: 'ok',
      minutesUrl: 'https://example.local/late-minutes.pdf',
      minutesPublishedAt: pastHorizon,
    };
    const stayed = reduceMeetingRow(closed, pastHorizon, lateFile);
    expect(stayed.status).toBe('unchanged');
    expect(stayed.changed).toBe(false);
    expect(stayed.stdout).toBe('unchanged_closed');
    expect(stayed.minutesUrl).toBeNull();
  });

  test('confirmed → minutes_check with file ingests', () => {
    const confirmed = seedConfirmed3367();
    const now = confirmed.nextCheckAt;
    const next = reduceMeetingRow(confirmed, now, {
      type: 'minutes_check',
      outcome: 'ok',
      minutesUrl: 'https://example.local/3367-minutes.pdf',
      minutesPublishedAt: now,
    });
    expect(next.status).toBe('ingested');
  });
});

describe('calendar reducer — publication Phase C (wage bulletin)', () => {
  test('publication ingests at observedAt (Phase C; skips agenda)', () => {
    const row = seedWageBulletinPublicationRow();
    const agendaAttempt = reduceMeetingRow(
      row,
      civicWageBulletinPublication.frozenNow,
      { type: 'agenda_check', outcome: 'ok', agendaUrl: 'https://example.local/nope' },
    );
    expect(agendaAttempt.status).toBe('scheduled');
    expect(agendaAttempt.stdout).toBe('agenda=skipped_publication');

    const ingested = reduceMeetingRow(
      row,
      civicWageBulletinPublication.frozenNow,
      civicWageBulletinPublication.signalBody,
    );
    expect(ingested.status).toBe('ingested');
    expect(ingested.phase).toBe('C');
    expect(ingested.observedSourceUrl).toBe(civicWageBulletinPublication.sourceUrl);
    expect(ingested.fixtureId).toBe('civic-wage-bulletin');
  });

  test('wage bulletin fixture pack still burns 2376 / clear 2200 (untouched)', () => {
    const observations = collectFixtureObservations('civic-wage-bulletin');
    const pending = ingestObservation(observations[1]);
    const trigger = toContractTrigger(pending);
    let state = applyTrigger(initialState, trigger);
    expect(effectiveBurnRate(state)).toBe(Math.round(2200 * 1.08));
    expect(effectiveBurnRate(state)).toBe(2376);
    state = clearTriggers(state);
    expect(effectiveBurnRate(state)).toBe(2200);
  });
});

describe('calendar reducer — fixture registry + guards', () => {
  test('wave2 fixture ids are listed', () => {
    expect(FIXTURE_IDS).toEqual([
      'mv-council-calendar-2026h2',
      'mv-council-agenda-3367',
      'mv-council-morning-3367',
      'mv-council-minutes-3363',
      'mv-library-minutes-3458',
      'civic-wage-bulletin',
    ]);
  });

  test('createMeetingRow rejects unknown status; unknown signal throws', () => {
    expect(() => createMeetingRow({ startsAt: '2026-01-01T00:00:00.000Z', status: 'nope' }))
      .toThrow(/status/);
    const row = createPublicationRow({
      externalEventId: 'x',
      startsAt: '2026-04-02T14:55:00.000Z',
    });
    expect(() => reduceMeetingRow(row, '2026-04-02T14:55:00.000Z', { type: 'nope' }))
      .toThrow(/unknown signal/);
  });

  test('backoff helpers stay before horizon for early indices', () => {
    const row = seedRow3458MinutesWait(0);
    const check = minutesBackoffCheckAt(row.startsAt, row.timezone, 0);
    expect(isPastHorizon(row.startsAt, check, row.horizonDays)).toBe(false);
  });

  test('no GitHub Actions schedule: creep and no migration 007 in calendar reducer', () => {
    const workflows = readdirSync('.github/workflows');
    for (const name of workflows) {
      const body = readFileSync(`.github/workflows/${name}`, 'utf8');
      expect(/^\s*schedule\s*:/m.test(body)).toBe(false);
    }
    const migrations = readdirSync('migrations');
    // 006 nest may land after CIT-79; calendar reducer still must not ship 007.
    expect(migrations.some((n) => n.startsWith('007'))).toBe(false);
  });
});
