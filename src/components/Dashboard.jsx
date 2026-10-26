import { Chart, Title } from '@highcharts/react';
import { LineSeries } from '@highcharts/react/series/Line';

import { describeTrigger, formatTalentDollars } from '../triggerContract';

export default function Dashboard({ state }) {
  const { cash, burnRate, hype, talentCost } = state.history;
  const categories = cash.map((_, i) => `T${i}`);
  const triggerCategories = (hype || []).map((_, i) => `E${i}`);

  return (
    <div style={{ padding: '1rem', background: '#12121f', color: '#e0e0e0' }}>
      <h3 style={{ margin: '0 0 0.5rem' }}>Company Metrics</h3>
      <p>
        Cash: <span data-testid="cash-value">${state.company.cash.toFixed(0)}</span>
        {' '}| Burn/mo: <span data-testid="burn-value">${state.company.burnRate}</span>
        {' '}| Base burn: <span data-testid="base-burn-value">${state.company.baseBurnRate ?? state.company.burnRate}</span>
        {' '}| Talent mix: <span data-testid="talent-multiplier-value">{(state.company.talentMultiplier ?? 1).toFixed(4)}</span>
        {' '}| Cost factor: <span data-testid="talent-cost-factor-value">{(state.company.talentCostFactor ?? 1).toFixed(4)}</span>
        {' '}<span data-testid="talent-cost-factor-clamped">{state.company.talentCostFactorClamped ? 'clamped' : 'not clamped'}</span>
        {' '}| Effective: <span data-testid="effective-multiplier-value">{(state.company.effectiveMultiplier ?? 1).toFixed(4)}</span>
        {' '}| Tax: {(state.taxRate * 100).toFixed(0)}%
        {' '}| Hype: <span data-testid="hype-value">{Math.round(state.company.hype * 100)}%</span>
        {' '}| Talent cost: <span data-testid="talent-cost-value">{formatTalentDollars(state.company.talentCost)}</span>
      </p>
      <Chart
        options={{
          chart: { backgroundColor: 'transparent', height: 220 },
          title: { text: null },
          xAxis: { categories },
          yAxis: { title: { text: null } },
          legend: { enabled: true },
          credits: { enabled: false }
        }}
      >
        <Title>Cash & Burn Rate</Title>
        <LineSeries name="Cash" data={cash} color="#4ade80" />
        <LineSeries name="Burn Rate" data={burnRate} color="#f87171" />
      </Chart>
      <Chart
        options={{
          chart: { backgroundColor: 'transparent', height: 160 },
          title: { text: null },
          xAxis: { categories: triggerCategories },
          yAxis: { title: { text: null }, min: 0, max: 1 },
          legend: { enabled: true },
          credits: { enabled: false }
        }}
      >
        <Title>Hype</Title>
        <LineSeries name="Hype" data={hype} color="#60a5fa" />
      </Chart>
      <Chart
        options={{
          chart: { backgroundColor: 'transparent', height: 160 },
          title: { text: null },
          xAxis: { categories: triggerCategories },
          yAxis: { title: { text: null } },
          legend: { enabled: true },
          credits: { enabled: false }
        }}
      >
        <Title>Talent Cost</Title>
        <LineSeries name="Talent cost" data={talentCost} color="#fbbf24" />
      </Chart>
      <div data-testid="talent-mix">
        <h4 style={{ margin: '0.5rem 0' }}>Talent mix</h4>
        {(state.company.talentMix ?? []).length === 0 ? (
          <p data-testid="talent-mix-empty">No employees. Talent multiplier is 1.0000.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {state.company.talentMix.map((group) => (
              <li key={group.department ?? 'none'} data-testid="talent-mix-row">
                {group.department ?? 'unassigned'}: {group.headcount} @ skill {group.avgSkill} × {group.weight} → {group.contribution}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div data-testid="trigger-list">
        <h4 style={{ margin: '0.5rem 0' }}>Real-world triggers</h4>
        {state.triggers.length === 0 ? (
          <p data-testid="trigger-empty">No real-world triggers yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {state.triggers.map((trigger) => (
              <li key={trigger.id} data-testid="trigger-row">
                {describeTrigger(trigger)} — {trigger.source}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}