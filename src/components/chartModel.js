import { describeTrigger } from '../triggers';

export function triggerChartMarkers(state) {
  return (state.activeTriggers ?? []).map((trigger, index) => {
    const value = trigger.appliedAtIndex ?? 0;
    return {
      value,
      text: describeTrigger(trigger),
      dashStyle: 'Dash',
      width: 2,
      bandFrom: value - 0.5,
      bandTo: value + 0.5,
      labelY: 14 + index * 16,
    };
  });
}

export function seriesDataWithTriggerNotes(values, triggers, noun) {
  return values.map((y, index) => {
    const here = (triggers ?? []).filter((trigger) => (trigger.appliedAtIndex ?? 0) === index);
    if (here.length === 0) return y;
    return {
      y,
      accessibility: {
        description: `${noun} at this month includes ${here.map((trigger) => describeTrigger(trigger)).join('; ')}.`,
      },
    };
  });
}

export function metricsChartDescription(state) {
  const active = state.activeTriggers ?? [];
  if (active.length === 0) {
    return 'Cash and burn rate by simulated month. No world event is active.';
  }
  const events = active.map((trigger) => describeTrigger(trigger)).join('; ');
  return `Cash and burn rate by simulated month. Active world event: ${events}.`;
}
