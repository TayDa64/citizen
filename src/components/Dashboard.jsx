import { Chart, Title } from '@highcharts/react';
import { LineSeries } from '@highcharts/react/series/Line';

export default function Dashboard({ state }) {
  const { cash, burnRate } = state.history;
  const categories = cash.map((_, i) => `T${i}`);

  return (
    <div style={{ padding: '1rem', background: '#12121f', color: '#e0e0e0' }}>
      <h3 style={{ margin: '0 0 0.5rem' }}>Company Metrics (Slice 1)</h3>
      <p>
        Cash: ${state.company.cash.toFixed(0)} | Burn/mo: ${state.company.burnRate} | Tax: {(state.taxRate * 100).toFixed(0)}%
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
    </div>
  );
}