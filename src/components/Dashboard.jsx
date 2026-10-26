import { useEffect, useState } from 'react';
import { Chart, Title } from '@highcharts/react';
import { LineSeries } from '@highcharts/react/series/Line';
import { talentCostShowsDollars } from '../dataSource';
import { baselineBurnRate, previewBurnRate } from '../simulation';
import {
  deltaPhrase,
  describeTrigger,
  formatDollars,
  formatHypePercent,
  formatTalentDollars,
  formatTalentMultiplier,
} from '../triggers';
import { loadChartAccessibility } from './loadChartAccessibility';
import {
  axisGuideOptions,
  metricsChartDescription,
  seriesDataWithTriggerNotes,
  triggerChartMarkers,
} from './chartModel';

const LIGHT_LABEL = { color: '#e2e8f0', fontSize: '12px' };

function burnDirectionOf(delta) {
  if (delta > 0.0005) return 'up';
  if (delta < -0.0005) return 'down';
  return 'flat';
}

function directionArrow(direction) {
  switch (direction) {
    case 'up':
      return '▲';
    case 'down':
      return '▼';
    case 'flat':
      return '■';
    default: {
      const neverDirection = direction;
      throw new Error(`Unknown direction: ${String(neverDirection)}`);
    }
  }
}

function ReadoutRow({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatTalentValue(value, dataSource) {
  if (talentCostShowsDollars(dataSource)) return formatTalentDollars(value);
  return formatTalentMultiplier(value);
}

function WorldEventEffect({ state }) {
  const active = state.activeTriggers ?? [];
  if (active.length === 0) return null;

  const dataSource = state.dataSource === 'api' ? 'api' : 'local';
  const before = state.baselines ?? { hype: state.company.hype, talentCost: 1 };
  const after = { hype: state.company.hype, talentCost: state.company.talentCost ?? 1 };
  const nextBurn = previewBurnRate(state);
  const baselineBurn = baselineBurnRate(state);
  const burnDelta = baselineBurn === 0 ? 0 : nextBurn / baselineBurn - 1;
  const burnDirection = burnDirectionOf(burnDelta);
  const burnArrow = directionArrow(burnDirection);

  return (
    <section className="trigger-readout" aria-labelledby="world-event-effect-heading">
      <h3 id="world-event-effect-heading">World event effect</h3>
      <p>{state.lastTriggerChange?.announcement ?? describeTrigger(active[active.length - 1])}</p>
      <ul className="trigger-readout__list">
        {active.map((trigger) => (
          <li key={trigger.id}>{describeTrigger(trigger)}</li>
        ))}
      </ul>
      <dl className="trigger-readout__stats">
        <ReadoutRow label="Hype before" value={formatHypePercent(before.hype)} />
        <ReadoutRow
          label="Hype after"
          value={`${formatHypePercent(after.hype)} (${deltaPhrase(after.hype - before.hype)})`}
        />
        <ReadoutRow label="Talent cost before" value={formatTalentValue(before.talentCost, dataSource)} />
        <ReadoutRow
          label="Talent cost after"
          value={`${formatTalentValue(after.talentCost, dataSource)} (${deltaPhrase((after.talentCost - before.talentCost) / (before.talentCost || 1))})`}
        />
      </dl>
      <p className={`delta delta--${burnDirection}`}>
        <span aria-hidden="true">{burnArrow}</span>
        {' '}
        Next month burn {formatDollars(nextBurn)} ({deltaPhrase(burnDelta)}) versus {formatDollars(baselineBurn)} at this tax rate before talent-cost events.
      </p>
    </section>
  );
}

export default function Dashboard({ state }) {
  const { cash, burnRate } = state.history;
  const categories = cash.map((_, i) => `T${i}`);
  const markers = triggerChartMarkers(state);
  const guides = axisGuideOptions(markers);
  const description = metricsChartDescription(state);
  const [ChartAccessibility, setChartAccessibility] = useState(undefined);
  const xAxis = {
    categories,
    labels: { style: LIGHT_LABEL },
    lineColor: '#64748b',
    tickColor: '#64748b',
    plotBands: guides.plotBands,
    plotLines: guides.plotLines,
  };

  useEffect(() => {
    let cancelled = false;
    loadChartAccessibility()
      .then((module) => {
        if (!cancelled) setChartAccessibility(() => module.Accessibility);
      })
      .catch(() => {
        if (!cancelled) setChartAccessibility(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="dashboard" style={{ padding: '1rem', background: '#12121f', color: '#e0e0e0' }}>
      <h3 style={{ margin: '0 0 0.5rem' }}>Company Metrics (Slice 1)</h3>
      <p>
        Cash: ${state.company.cash.toFixed(0)} | Burn/mo: ${state.company.burnRate} | Tax: {(state.taxRate * 100).toFixed(0)}%
      </p>
      <WorldEventEffect state={state} />
      <figure className="metrics-chart" aria-busy={ChartAccessibility === undefined}>
        <figcaption id="metrics-chart-description" className="chart-caption">
          {description}
        </figcaption>
        {ChartAccessibility === undefined ? (
          <div className="metrics-chart__pending" style={{ minHeight: 220 }} />
        ) : (
          <Chart
            options={{
              chart: { backgroundColor: 'transparent', height: markers.length > 0 ? 260 : 220 },
              title: { text: null },
              xAxis,
              yAxis: {
                title: { text: null },
                labels: { style: LIGHT_LABEL },
                gridLineColor: '#334155',
              },
              legend: {
                enabled: true,
                itemStyle: { color: '#f8fafc' },
                itemHoverStyle: { color: '#ffffff' },
              },
              credits: { enabled: false },
            }}
          >
            <Title style={{ color: '#f8fafc', fontSize: '16px', fontWeight: '600' }}>Cash & Burn Rate</Title>
            {ChartAccessibility ? (
              <ChartAccessibility
                linkedDescription="metrics-chart-description"
                series={{ describeSingleSeries: true }}
              />
            ) : null}
            <LineSeries
              name="Cash"
              data={seriesDataWithTriggerNotes(cash, state.activeTriggers, 'Cash')}
              color="#4ade80"
              options={{
                accessibility: {
                  description: 'Company cash balance in dollars at each simulated month.',
                },
              }}
            />
            <LineSeries
              name="Burn Rate"
              data={seriesDataWithTriggerNotes(burnRate, state.activeTriggers, 'Burn rate')}
              color="#f87171"
              options={{
                accessibility: {
                  description: 'Monthly burn rate in dollars. Talent-cost events change burn on the following month.',
                },
              }}
            />
          </Chart>
        )}
      </figure>
    </div>
  );
}
