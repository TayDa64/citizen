import { describeTrigger } from '../triggers';

export function simulatedMonthLabel(index) {
  return `T${index + 1}`;
}

export function triggerChartMarkers(state) {
  return (state.activeTriggers ?? []).map((trigger, index) => {
    const value = trigger.appliedAtIndex ?? 0;
    return {
      id: trigger.id,
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

/**
 * Guides for the metrics chart. Always returns both arrays, including when
 * nothing is active. Highcharts Axis.update keeps existing plot lines and
 * bands when the next options omit those keys. An empty array removes them.
 */
export function axisGuideOptions(markers) {
  return {
    plotBands: markers.map((marker) => ({
      id: `${marker.id}-band`,
      from: marker.bandFrom,
      to: marker.bandTo,
      color: 'rgba(251, 191, 36, 0.28)',
      borderColor: '#fbbf24',
      borderWidth: 1,
      zIndex: 2,
    })),
    plotLines: markers.map((marker) => ({
      id: `${marker.id}-line`,
      value: marker.value,
      color: '#fbbf24',
      dashStyle: marker.dashStyle,
      width: marker.width,
      zIndex: 4,
      label: {
        text: marker.text,
        rotation: 0,
        y: marker.labelY + 18,
        style: { color: '#fde68a', fontWeight: '700', fontSize: '11px' },
      },
    })),
  };
}

function pointDescription(noun, events, index, timing) {
  switch (timing) {
    case 'included':
      return `${noun} at this month includes ${events}.`;
    case 'next-month':
      return `${noun} first includes ${events} at ${simulatedMonthLabel(index + 1)}.`;
    default: {
      const neverTiming = timing;
      throw new Error(`Unknown chart point timing: ${String(neverTiming)}`);
    }
  }
}

export function seriesDataWithTriggerNotes(values, triggers, noun, timing = 'included') {
  return values.map((y, index) => {
    const here = (triggers ?? []).filter((trigger) => (trigger.appliedAtIndex ?? 0) === index);
    // Point.applyOptions merges into the previous point. A bare number never
    // deletes accessibility.description, so every point sets it explicitly.
    const description = here.length === 0
      ? null
      : pointDescription(noun, here.map((trigger) => describeTrigger(trigger)).join('; '), index, timing);
    return {
      y,
      accessibility: { description },
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
