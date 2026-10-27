import { useEffect, useState } from 'react';
import { Chart, Title } from '@highcharts/react';
import { LineSeries } from '@highcharts/react/series/Line';
import {
  computeCivicFromTax,
  formatBudgetHeadroom,
  formatHypeBias,
} from '../civicFeedback';
import { talentCostShowsDollars } from '../dataSource';
import { BASE_TALENT_COST, previewBurnRate } from '../simulation';
import {
  baseBurnRate,
  effectiveMultiplierOf,
  formatTalentCostFactor,
  formatTalentReadout,
  talentCostFactorClampOf,
  talentCostFactorOf,
  talentMixOf,
  talentMultiplierOf,
} from '../talentMultiplier';
import {
  deltaPhrase,
  describeTrigger,
  clampHype,
  clampTalentCost,
  formatBurnBreakdown,
  formatCurrency,
  formatHypePercent,
  formatTalentDollars,
  formatTalentMultiplier,
  talentCostFactorClampNote,
  talentEquation,
} from '../triggers';
import { loadChartAccessibility } from './loadChartAccessibility';
import {
  axisGuideOptions,
  metricsChartDescription,
  seriesDataWithTriggerNotes,
  simulatedMonthLabel,
  triggerChartMarkers,
} from './chartModel';

const LIGHT_LABEL = { color: '#e2e8f0', fontSize: '12px' };

function ReadoutRow({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function shownHype(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clampHype(numeric) : 0;
}

function shownTalent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clampTalentCost(numeric) : 0;
}

function formatTalentValue(value, dataSource, baseline) {
  if (talentCostShowsDollars(dataSource)) return formatTalentDollars(value);
  const numeric = Number(value);
  const base = Number(baseline);
  const ratio = Number.isFinite(numeric) && Number.isFinite(base) && base > 0 ? numeric / base : numeric;
  return formatTalentMultiplier(Number.isFinite(ratio) ? ratio : 0);
}

function TalentMixTable({ rows }) {
  return (
    <table className="talent-mix">
      <caption>Talent mix</caption>
      <thead>
        <tr>
          <th scope="col">Department</th>
          <th scope="col">Headcount</th>
          <th scope="col">Average skill</th>
          <th scope="col">Weight</th>
          <th scope="col">Contribution</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.department ?? 'unknown'}-${row.headcount}-${row.avgSkill}`}>
            <td>{row.department ?? 'Unassigned'}</td>
            <td>{String(row.headcount)}</td>
            <td>{formatTalentReadout(row.avgSkill)}</td>
            <td>{formatTalentReadout(row.weight)}</td>
            <td>{formatTalentReadout(row.contribution)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TalentBurnSummary({ state }) {
  const mix = talentMixOf(state);
  const equation = talentEquation(state);

  return (
    <section className="talent-burn" aria-labelledby="talent-burn-heading">
      <h3 id="talent-burn-heading">Talent and burn</h3>
      <p>{formatBurnBreakdown(state)}</p>
      <p data-testid="talent-equation" role="group" aria-label={equation.name}>
        {equation.visible}
      </p>
      {mix.length > 0 ? (
        <TalentMixTable rows={mix} />
      ) : (
        <p>No employees. Talent multiplier is 1.0000.</p>
      )}
    </section>
  );
}

function CivicFeedbackReadout({ state }) {
  const civic = state.civic ?? computeCivicFromTax(state.taxRate);
  return (
    <section className="civic-feedback" aria-labelledby="civic-feedback-heading">
      <h3 id="civic-feedback-heading">Civic feedback</h3>
      <p>
        Tax moves city budget headroom; headroom folds into company hype (bias 0 at 25% tax so tax-only burn baselines stay put).
      </p>
      <dl className="civic-feedback__stats">
        <ReadoutRow
          label="Budget headroom"
          value={
            <span data-testid="civic-budget-headroom-value">
              {formatBudgetHeadroom(civic.budgetHeadroom)}
            </span>
          }
        />
        <ReadoutRow
          label="Civic hype bias"
          value={
            <span data-testid="civic-hype-bias-value">
              {formatHypeBias(civic.hypeBias)}
            </span>
          }
        />
        <ReadoutRow
          label="Company hype"
          value={
            <span data-testid="civic-company-hype-value">
              {formatHypePercent(shownHype(state.company.hype))}
            </span>
          }
        />
      </dl>
    </section>
  );
}

function WorldEventEffect({ state }) {
  const active = state.activeTriggers ?? [];
  if (active.length === 0) return null;

  const dataSource = state.dataSource === 'api' ? 'api' : 'local';
  const rawBefore = state.baselines ?? { hype: state.company.hype, talentCost: BASE_TALENT_COST };
  const before = { hype: shownHype(rawBefore.hype), talentCost: shownTalent(rawBefore.talentCost) };
  const after = {
    hype: shownHype(state.company.hype),
    talentCost: shownTalent(state.company.talentCost ?? before.talentCost),
  };

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
        <ReadoutRow label="Talent cost before" value={formatTalentValue(before.talentCost, dataSource, before.talentCost)} />
        <ReadoutRow
          label="Talent cost after"
          value={`${formatTalentValue(after.talentCost, dataSource, before.talentCost)} (${deltaPhrase((after.talentCost - before.talentCost) / (before.talentCost || 1))})`}
        />
      </dl>
    </section>
  );
}

export default function Dashboard({ state }) {
  const factorClampNote = talentCostFactorClampNote(talentCostFactorClampOf(state));
  const { cash, burnRate } = state.history;
  const categories = cash.map((_, i) => simulatedMonthLabel(i));
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
      <h3 style={{ margin: '0 0 0.5rem' }}>Company Metrics</h3>
      <dl className="metrics-grid">
        <div>
          <dt>Cash</dt>
          <dd>
            <span data-testid="cash-value">Cash: ${state.company.cash.toFixed(0)}</span>
          </dd>
        </div>
        <div>
          <dt>Burn / month</dt>
          <dd>
            <span id="burn-value" data-testid="burn-value">
              Burn/mo: {formatCurrency(previewBurnRate(state))}
            </span>
          </dd>
        </div>
        <div>
          <dt>Base burn</dt>
          <dd>
            <span id="base-burn-value" data-testid="base-burn-value">
              Base burn: {formatCurrency(baseBurnRate(state.taxRate))}
            </span>
          </dd>
        </div>
        <div>
          <dt>Talent multiplier</dt>
          <dd>
            <span id="talent-multiplier-value" data-testid="talent-multiplier-value">
              Talent multiplier: {formatTalentReadout(talentMultiplierOf(state))}
            </span>
          </dd>
        </div>
        <div>
          <dt>Talent cost factor</dt>
          <dd>
            <span
              id="talent-cost-factor-value"
              data-testid="talent-cost-factor-value"
              role="group"
              aria-label={`Talent cost factor ${formatTalentCostFactor(talentCostFactorOf(state))}${factorClampNote ? `, ${factorClampNote}` : ''}`}
            >
              Talent cost factor: {formatTalentCostFactor(talentCostFactorOf(state))}
            </span>
            {factorClampNote ? (
              <>
                {' '}
                <span data-testid="talent-cost-factor-clamp">{factorClampNote}</span>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Effective multiplier</dt>
          <dd>
            <span id="effective-multiplier-value" data-testid="effective-multiplier-value">
              Effective multiplier: {formatTalentCostFactor(effectiveMultiplierOf(state))}
            </span>
          </dd>
        </div>
        <div>
          <dt>Tax</dt>
          <dd>Tax: {(state.taxRate * 100).toFixed(0)}%</dd>
        </div>
      </dl>
      <TalentBurnSummary state={state} />
      <CivicFeedbackReadout state={state} />
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
              data={seriesDataWithTriggerNotes(burnRate, state.activeTriggers, 'Burn rate', 'next-month')}
              color="#f87171"
              options={{
                accessibility: {
                  description: 'Monthly burn rate in dollars after tax, the employee talent multiplier, and the talent-cost factor. The talent-cost factor is limited to 0.10× through 3.00×. A talent-cost event is included in this series on the following month.',
                },
              }}
            />
          </Chart>
        )}
      </figure>
    </div>
  );
}
