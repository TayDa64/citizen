import { describe, expect, test } from 'vitest';
import { applyTrigger, initialState } from '../simulation';
import { SAMPLE_TRIGGERS } from '../triggers';
import { metricsChartDescription, seriesDataWithTriggerNotes, triggerChartMarkers } from './chartModel';

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');

describe('chart markers', () => {
  test('no trigger leaves series data and markers on the Slice 1 baseline', () => {
    expect(triggerChartMarkers(initialState)).toEqual([]);
    expect(seriesDataWithTriggerNotes(initialState.history.cash, [], 'Cash')).toEqual([15000]);
    expect(seriesDataWithTriggerNotes(initialState.history.burnRate, [], 'Burn rate')).toEqual([
      2000,
    ]);
    expect(metricsChartDescription(initialState)).toBe(
      'Cash and burn rate by simulated month. No world event is active.'
    );
  });

  test('an active policy change annotates the current month', () => {
    const state = applyTrigger(initialState, policy);

    expect(triggerChartMarkers(state)).toEqual([
      {
        value: 0,
        text: 'Policy change: talent cost +12%',
        dashStyle: 'Dash',
        width: 2,
        bandFrom: -0.5,
        bandTo: 0.5,
        labelY: 14,
      },
    ]);
    expect(seriesDataWithTriggerNotes(state.history.cash, state.activeTriggers, 'Cash')).toEqual([
      {
        y: 15000,
        accessibility: {
          description: 'Cash at this month includes Policy change: talent cost +12%.',
        },
      },
    ]);
    expect(metricsChartDescription(state)).toBe(
      'Cash and burn rate by simulated month. Active world event: Policy change: talent cost +12%.'
    );
  });
});
