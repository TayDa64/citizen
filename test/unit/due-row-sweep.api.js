import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  resolveFixtureSignal,
  resolveIngestFixtureId,
  resolveSweepOptions,
  shouldCommitTurnFromSweep,
  shouldPersistTriggers,
} from '../../server/dueRowSweep.js';
import {
  mvCouncilAgenda3367,
  mvLibraryMinutes3458,
  seedAgendaSeen3367,
  seedConfirmed3367,
  seedRow3363MinutesWait,
  seedRow3367Scheduled,
  seedRow3458MinutesWait,
  seedWageBulletinPublicationRow,
  civicWageBulletinPublication,
} from '../../src/calendar/fixtures.js';
import { reduceMeetingRow } from '../../src/calendar/calendarReducer.js';

test('resolveSweepOptions requires --phase-a or --due', () => {
  assert.throws(() => resolveSweepOptions([], {}), (error) => error.code === 'missing_mode');
  assert.deepEqual(resolveSweepOptions(['--phase-a'], {}), {
    mode: 'phase_a',
    now: null,
    campaignId: null,
    seedWage: false,
  });
  assert.equal(resolveSweepOptions(['--due'], {}).mode, 'due');
  assert.equal(resolveSweepOptions([], { CALENDAR_CLOCK_MODE: 'due' }).mode, 'due');
});

test('resolveSweepOptions accepts --now and --campaign UUID', () => {
  const id = '33333333-3333-4333-8333-333333333333';
  const opts = resolveSweepOptions(
    ['--due', '--now', '2026-10-23T17:00:00.000Z', '--campaign', id],
    {},
  );
  assert.equal(opts.mode, 'due');
  assert.equal(opts.now, '2026-10-23T17:00:00.000Z');
  assert.equal(opts.campaignId, id);
  assert.throws(
    () => resolveSweepOptions(['--due', '--campaign', 'nope'], {}),
    (error) => error.code === 'invalid_campaign_flag',
  );
});

test('resolveFixtureSignal: agenda empty before Friday post; revised after stamp', () => {
  const row = seedRow3367Scheduled();
  const early = resolveFixtureSignal(row, mvCouncilAgenda3367.frozenNowEarly);
  assert.equal(early.type, 'agenda_check');
  assert.equal(early.outcome, 'empty');
  const mid = resolveFixtureSignal(row, mvCouncilAgenda3367.frozenNowFirstPost);
  assert.equal(mid.outcome, 'ok');
  assert.equal(mid.agendaPublishedAt, mvCouncilAgenda3367.signalFirst.agendaPublishedAt);
  const late = resolveFixtureSignal(row, mvCouncilAgenda3367.frozenNowRevised);
  assert.equal(late.agendaPublishedAt, mvCouncilAgenda3367.signalRevised.agendaPublishedAt);
});

test('resolveFixtureSignal: morning still_on; library file only after frozenNowFile', () => {
  const agendaSeen = seedAgendaSeen3367();
  assert.equal(resolveFixtureSignal(agendaSeen, '2026-10-27T15:00:00.000Z').outcome, 'still_on');

  const library = seedRow3458MinutesWait(3);
  const waiting = resolveFixtureSignal(library, mvLibraryMinutes3458.frozenNowTPlus1);
  assert.equal(waiting.outcome, 'empty');
  const file = resolveFixtureSignal(library, mvLibraryMinutes3458.frozenNowFile);
  assert.equal(file.outcome, 'ok');
  assert.ok(file.minutesUrl);
});

test('shouldPersistTriggers: publication wage + library minutes; not Final+null/empty', () => {
  const pub = seedWageBulletinPublicationRow();
  const ingested = reduceMeetingRow(
    pub,
    civicWageBulletinPublication.frozenNow,
    civicWageBulletinPublication.signalBody,
  );
  assert.equal(ingested.status, 'ingested');
  assert.equal(shouldPersistTriggers(pub, ingested), true);

  const library = seedRow3458MinutesWait(4);
  const libraryIngested = reduceMeetingRow(
    library,
    mvLibraryMinutes3458.frozenNowFile,
    mvLibraryMinutes3458.signalFile,
  );
  assert.equal(libraryIngested.status, 'ingested');
  assert.equal(libraryIngested.stdout, 'minutes=ingested');
  assert.equal(shouldPersistTriggers(library, libraryIngested), true);

  const meeting = seedConfirmed3367();
  const minutes = reduceMeetingRow(
    meeting,
    '2026-10-28T15:00:00.000Z',
    { type: 'minutes_check', outcome: 'empty' },
  );
  assert.equal(shouldPersistTriggers(meeting, minutes), false);

  const nullFile = seedRow3363MinutesWait();
  const finalNull = reduceMeetingRow(
    nullFile,
    '2026-08-27T15:00:00.000Z',
    { type: 'minutes_check', outcome: 'ok', minutesUrl: null, minutesPublishedAt: null },
  );
  assert.equal(finalNull.status, 'minutes_wait');
  assert.equal(shouldPersistTriggers(nullFile, finalNull), false);
});

test('resolveIngestFixtureId maps wage publication and library minutes packs', () => {
  const pub = reduceMeetingRow(
    seedWageBulletinPublicationRow(),
    civicWageBulletinPublication.frozenNow,
    civicWageBulletinPublication.signalBody,
  );
  assert.equal(resolveIngestFixtureId(pub), 'civic-wage-bulletin');

  const library = reduceMeetingRow(
    seedRow3458MinutesWait(4),
    mvLibraryMinutes3458.frozenNowFile,
    mvLibraryMinutes3458.signalFile,
  );
  assert.equal(resolveIngestFixtureId(library), 'mv-library-minutes-3458');

  const agenda = reduceMeetingRow(
    seedRow3367Scheduled(),
    mvCouncilAgenda3367.frozenNowFirstPost,
    mvCouncilAgenda3367.signalFirst,
  );
  assert.equal(resolveIngestFixtureId(agenda), null);
});

test('shouldCommitTurnFromSweep requires trigger changed', () => {
  assert.equal(shouldCommitTurnFromSweep({ triggerChanged: false, triggerCount: 1 }), false);
  assert.equal(shouldCommitTurnFromSweep({ triggerChanged: true, triggerCount: 0 }), false);
  assert.equal(shouldCommitTurnFromSweep({ triggerChanged: true, triggerCount: 1 }), true);
});

test('agenda-seen reducer path stays changed=false for trigger restack gate', () => {
  const row = seedRow3367Scheduled();
  const next = reduceMeetingRow(
    row,
    mvCouncilAgenda3367.frozenNowFirstPost,
    mvCouncilAgenda3367.signalFirst,
  );
  assert.equal(next.status, 'agenda_seen');
  assert.equal(shouldPersistTriggers(row, next), false);
  assert.equal(shouldCommitTurnFromSweep({ triggerChanged: false, triggerCount: 0 }), false);
});

test('60d unchanged stays closed on replay', () => {
  const row = {
    ...seedRow3363MinutesWait(),
    status: 'unchanged',
    phase: 'C',
  };
  const again = reduceMeetingRow(row, '2026-12-01T00:00:00.000Z', {
    type: 'minutes_check',
    outcome: 'ok',
    minutesUrl: 'https://example.local/late.pdf',
    minutesPublishedAt: '2026-12-01T00:00:00.000Z',
  });
  assert.equal(again.status, 'unchanged');
  assert.equal(again.changed, false);
  assert.equal(again.stdout, 'unchanged_closed');
});

test('calendar-ingest workflow locks :12 + dispatch; no T-3 06:00-only', () => {
  const body = fs.readFileSync('.github/workflows/calendar-ingest.yml', 'utf8');
  assert.match(body, /cron:\s*'12 14 \* \* 1'/);
  assert.match(body, /cron:\s*'12 6,18 \* \* \*'/);
  assert.match(body, /workflow_dispatch/);
  assert.match(body, /calendar:clock/);
  assert.doesNotMatch(body, /cron:\s*'0 6 /);
  assert.doesNotMatch(body, /npm run ingest:once/);
  assert.doesNotMatch(body, /adapter:\s*'firecrawl'|adapter:\s*"firecrawl"/i);
});
