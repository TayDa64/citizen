/**
 * CIT-107 — allowlisted HTTPS fetch (unit, network-off).
 * Recorded bodies → calendar reducer / http_stub; firecrawl stays rejected.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALLOWLISTED_HTTPS_ID,
  extractMeetingDetailIds,
  loadRecordedBody,
  mapFetchToCalendarSignal,
  mapFetchToHttpStubObservations,
  mapFetchToMinutesSignal,
} from '../../src/adapters/allowlistedHttps.js';
import {
  ALLOWLISTED_CALENDAR_URL,
  ALLOWLISTED_HOST,
  assertAllowlistedHttpsUrl,
  isAllowlistedHost,
  listAllowlistedUrls,
} from '../../src/sourceAllowlist.js';
import { reduceMeetingRow } from '../../src/calendar/calendarReducer.js';
import {
  mvCouncilCalendar2026h2,
  seedRow3367Scheduled,
  seedRow3458MinutesWait,
} from '../../src/calendar/fixtures.js';
import {
  resolveAllowlistedFetchOptions,
  mapEnvelope,
  reduceWithMappedSignal,
  main as allowlistedMain,
} from '../../server/allowlistedFetch.js';
import {
  runPipelineIngest,
  validateIngestRequest,
} from '../../server/eventIngest.js';
import { TriggerValidationError } from '../../src/triggerContract.js';
import { effectiveBurnRate } from '../../src/talentMultiplier.js';
import { applyTrigger, clearTriggers, initialState } from '../../src/simulation.js';

test('allowlist accepts mountainview.legistar.com HTTPS catalog URLs only', () => {
  assert.equal(isAllowlistedHost(ALLOWLISTED_HOST), true);
  assert.equal(isAllowlistedHost('evil.example'), false);
  assert.doesNotThrow(() => assertAllowlistedHttpsUrl(ALLOWLISTED_CALENDAR_URL));
  assert.doesNotThrow(() =>
    assertAllowlistedHttpsUrl('https://mountainview.legistar.com/MeetingDetail.aspx?ID=3367'));
  assert.throws(
    () => assertAllowlistedHttpsUrl('http://mountainview.legistar.com/Calendar.aspx'),
    (error) => error.code === 'allowlist_https_required',
  );
  assert.throws(
    () => assertAllowlistedHttpsUrl('https://user:pass@mountainview.legistar.com/Calendar.aspx'),
    (error) => error.code === 'allowlist_userinfo_forbidden',
  );
  assert.throws(
    () => assertAllowlistedHttpsUrl('https://legistar1.granicus.com/mountainview/x'),
    (error) => error.code === 'allowlist_host_rejected',
  );
  assert.throws(
    () => assertAllowlistedHttpsUrl('https://mountainview.legistar.com/Other.aspx'),
    (error) => error.code === 'allowlist_url_rejected',
  );
  assert.ok(listAllowlistedUrls().includes(ALLOWLISTED_CALENDAR_URL));
});

test('recorded calendar body → calendar_sync ok → reducer upserts without network', () => {
  const envelope = loadRecordedBody('calendar');
  const signal = mapFetchToCalendarSignal(envelope);
  assert.equal(signal.type, 'calendar_sync');
  assert.equal(signal.outcome, 'ok');
  assert.equal(signal.via, ALLOWLISTED_HTTPS_ID);
  assert.equal(signal.events.length, 3);
  assert.deepEqual(
    extractMeetingDetailIds(envelope.bodyText).sort(),
    ['3363', '3367', '3458'],
  );

  const row = seedRow3367Scheduled();
  const after = reduceMeetingRow(row, mvCouncilCalendar2026h2.frozenNow, signal);
  assert.equal(after.stdout, 'calendar=upserted');
  assert.equal(after.status, 'scheduled');
  assert.equal(after.lastError, null);
});

test('blocked recorded body → changed=false, pointers kept (no delete)', () => {
  const envelope = loadRecordedBody('calendarBlocked');
  const signal = mapFetchToCalendarSignal(envelope);
  assert.equal(signal.outcome, 'blocked');
  assert.equal(signal.error, 'legistar_unreachable');

  const row = seedRow3367Scheduled();
  const expectedUrl = row.expectedUrl;
  const after = reduceMeetingRow(row, mvCouncilCalendar2026h2.frozenNow, signal);
  assert.equal(after.changed, false);
  assert.equal(after.status, 'scheduled');
  assert.equal(after.expectedUrl, expectedUrl);
  assert.equal(after.stdout, 'calendar=blocked');
});

test('empty calendar body → ok with zero events; reducer missing keeps pointers', () => {
  const envelope = loadRecordedBody('calendarEmpty');
  const signal = mapFetchToCalendarSignal(envelope);
  assert.equal(signal.outcome, 'ok');
  assert.equal(signal.empty, true);
  assert.equal(signal.events.length, 0);

  const row = seedRow3367Scheduled();
  const after = reduceMeetingRow(row, mvCouncilCalendar2026h2.frozenNow, signal);
  assert.equal(after.changed, false);
  assert.equal(after.status, 'scheduled');
  assert.equal(after.stdout, 'calendar=missing');
  assert.equal(after.expectedUrl, row.expectedUrl);
});

test('recorded minutes body → minutes signal + http_stub observations → contract keys', () => {
  const envelope = loadRecordedBody('minutes3458');
  const minutesSignal = mapFetchToMinutesSignal(envelope);
  assert.equal(minutesSignal.outcome, 'ok');
  assert.ok(minutesSignal.minutesUrl);

  const row = seedRow3458MinutesWait(0);
  const after = reduceMeetingRow(row, '2026-10-20T17:00:00.000Z', minutesSignal);
  assert.equal(after.status, 'ingested');
  assert.equal(after.stdout, 'minutes=ingested');

  const observations = mapFetchToHttpStubObservations(envelope);
  assert.equal(observations.length, 1);
  const pipeline = runPipelineIngest({
    adapter: 'http_stub',
    observations,
  });
  assert.equal(pipeline.adapter, 'http_stub');
  assert.equal(pipeline.triggers.length, 1);
  assert.equal(pipeline.triggers[0].effect.talentCost, 0.05);
  assert.equal(pipeline.triggers[0].effect.hype, 0.04);
});

test('blocked minutes envelope → empty observations + minutes=blocked changed=false', () => {
  const envelope = {
    kind: 'minutes_fetch',
    ok: false,
    status: 0,
    error: 'legistar_unreachable',
    fetchedUrl: 'https://mountainview.legistar.com/MeetingDetail.aspx?ID=3458',
    bodyText: '',
    externalEventId: '3458',
  };
  assert.deepEqual(mapFetchToHttpStubObservations(envelope), []);
  const signal = mapFetchToMinutesSignal(envelope);
  assert.equal(signal.outcome, 'blocked');
  const row = seedRow3458MinutesWait(0);
  const after = reduceMeetingRow(row, '2026-10-20T17:00:00.000Z', signal);
  assert.equal(after.changed, false);
  assert.equal(after.status, 'minutes_wait');
  assert.equal(after.stdout, 'minutes=blocked');
  assert.equal(after.agendaUrl, row.agendaUrl);
});

test('adapter firecrawl stays rejected; allowlisted path uses http_stub only', () => {
  assert.equal(validateIngestRequest({ adapter: 'firecrawl' }).ok, false);
  assert.throws(
    () => runPipelineIngest({ adapter: 'firecrawl' }),
    (error) => error instanceof TriggerValidationError,
  );
  assert.equal(validateIngestRequest({ adapter: 'http_stub', observations: [] }).ok, true);
  assert.doesNotMatch(
    ALLOWLISTED_HTTPS_ID,
    /firecrawl/i,
  );
});

test('CLI defaults to recorded / network-off; --live opt-in', () => {
  const recorded = resolveAllowlistedFetchOptions([]);
  assert.equal(recorded.mode, 'recorded');
  assert.equal(recorded.kind, 'calendar');
  const live = resolveAllowlistedFetchOptions(['--live', '--kind', 'minutes']);
  assert.equal(live.mode, 'live');
  assert.equal(live.kind, 'minutes');
  assert.throws(
    () => resolveAllowlistedFetchOptions(['--url', 'https://evil.example/x']),
    (error) => error.code === 'allowlist_host_rejected',
  );
});

test('CLI recorded calendar offline → changed=false line; minutes → ingestable map', async () => {
  const lines = [];
  const calendar = await allowlistedMain(['--recorded', '--kind', 'calendar'], {
    stdout: (line) => lines.push(String(line)),
    stderr: () => {},
  });
  assert.equal(calendar.ok, true);
  assert.equal(calendar.changed, false);
  assert.ok(lines.some((line) => /changed=false/.test(line)));

  const minutes = await allowlistedMain(['--recorded', '--kind', 'minutes'], {
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(minutes.ok, true);
  assert.equal(minutes.after.status, 'ingested');
  assert.equal(minutes.mapped.observations.length, 1);

  const blocked = await allowlistedMain(['--recorded', '--kind', 'blocked'], {
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(blocked.ok, true);
  assert.equal(blocked.changed, false);
  assert.equal(blocked.after.stdout, 'calendar=blocked');
});

test('wage burn 2376 / clear 2200 still hold beside allowlisted http_stub stack', () => {
  let state = { ...initialState, taxRate: 0.25 };
  const wage = runPipelineIngest({
    adapter: 'fixture',
    fixtureId: 'civic-wage-bulletin',
  }).triggers[0];
  state = applyTrigger(state, wage);
  assert.equal(effectiveBurnRate(state), 2376);
  state = clearTriggers(state);
  assert.equal(effectiveBurnRate(state), 2200);

  const observations = mapFetchToHttpStubObservations(loadRecordedBody('minutes3458'));
  const minutesTrigger = runPipelineIngest({
    adapter: 'http_stub',
    observations,
  }).triggers[0];
  state = applyTrigger(state, wage);
  state = applyTrigger(state, minutesTrigger);
  // Same composition as CIT-101 wage+minutes (1.134 → 2495); wage-alone path intact after clear.
  assert.equal(effectiveBurnRate(state), 2495);
  state = clearTriggers(state);
  assert.equal(effectiveBurnRate(state), 2200);
});

test('mapEnvelope wires recorded kinds without resurrecting firecrawl branding', () => {
  const mapped = mapEnvelope(
    { kind: 'calendar' },
    loadRecordedBody('calendar'),
  );
  assert.equal(mapped.calendarSignal.via, ALLOWLISTED_HTTPS_ID);
  assert.equal(mapped.observations.length, 0);
  const offline = reduceWithMappedSignal(
    seedRow3367Scheduled(),
    mvCouncilCalendar2026h2.frozenNow,
    mapped,
  );
  assert.equal(offline.status, 'scheduled');
});
