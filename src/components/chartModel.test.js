import { describe, expect, test } from 'vitest';
import { applyTrigger, initialState } from '../simulation';
import { SAMPLE_TRIGGERS } from '../triggers';
import {
  axisGuideOptions,
  metricsChartDescription,
  seriesDataWithTriggerNotes,
  triggerChartMarkers,
} from './chartModel';

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');

describe('chart markers', () => {
  test('no trigger leaves series data and markers on the Slice 1 baseline', () => {
    expect(triggerChartMarkers(initialState)).toEqual([]);
    expect(axisGuideOptions([])).toEqual({ plotBands: [], plotLines: [] });
    expect(seriesDataWithTriggerNotes(initialState.history.cash, [], 'Cash')).toEqual([
      { y: 15000, accessibility: { description: null } },
    ]);
    expect(seriesDataWithTriggerNotes(initialState.history.burnRate, [], 'Burn rate')).toEqual([
      { y: 2000, accessibility: { description: null } },
    ]);
    expect(metricsChartDescription(initialState)).toBe(
      'Cash and burn rate by simulated month. No world event is active.'
    );
  });

  test('an active policy change annotates the current month', () => {
    const state = applyTrigger(initialState, policy);

    expect(triggerChartMarkers(state)).toEqual([
      {
        id: 'evt-policy-wage-ordinance',
        value: 0,
        text: 'Policy change: talent cost +12%',
        dashStyle: 'Dash',
        width: 2,
        bandFrom: -0.5,
        bandTo: 0.5,
        labelY: 14,
      },
    ]);
    expect(axisGuideOptions(triggerChartMarkers(state)).plotLines).toEqual([
      expect.objectContaining({ id: 'evt-policy-wage-ordinance-line', value: 0 }),
    ]);
    expect(axisGuideOptions(triggerChartMarkers(state)).plotBands).toEqual([
      expect.objectContaining({ id: 'evt-policy-wage-ordinance-band', from: -0.5, to: 0.5 }),
    ]);
    expect(seriesDataWithTriggerNotes(state.history.cash, state.activeTriggers, 'Cash')).toEqual([
      {
        y: 15000,
        accessibility: {
          description: 'Cash at this month includes Policy change: talent cost +12%.',
        },
      },
    ]);
    expect(seriesDataWithTriggerNotes(state.history.burnRate, state.activeTriggers, 'Burn rate', 'next-month')).toEqual([
      {
        y: 2000,
        accessibility: {
          description: 'Burn rate first includes Policy change: talent cost +12% at T2.',
        },
      },
    ]);
    expect(metricsChartDescription(state)).toBe(
      'Cash and burn rate by simulated month. Active world event: Policy change: talent cost +12%.'
    );
  });
});
