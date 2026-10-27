import { Handle, Position } from '@xyflow/react';
import { formatBudgetHeadroom, formatHypeBias } from '../civicFeedback.js';

export default function CivicLeverNode({ data }) {
  const headroom = data.budgetHeadroom;
  const bias = data.hypeBias;
  const headroomText = Number.isFinite(Number(headroom))
    ? formatBudgetHeadroom(headroom)
    : null;
  const biasText = Number.isFinite(Number(bias)) ? formatHypeBias(bias) : null;

  return (
    <div style={{
      padding: 12,
      background: '#6b3a3a',
      color: 'white',
      borderRadius: 8,
      minWidth: 180,
      width: 200,
      boxSizing: 'border-box',
      fontSize: 12
    }}>
      <Handle type="target" position={Position.Top} />
      <strong>{data.label || 'Civic Lever'}</strong>
      <div style={{ marginTop: 8 }}>
        <label htmlFor="civic-tax-rate" style={{ display: 'block', marginBottom: 4 }}>
          Tax rate: {(data.value * 100).toFixed(0)}%
        </label>
        <input
          id="civic-tax-rate"
          type="range"
          min="0"
          max="1"
          step="0.05"
          aria-label="Tax rate"
          value={data.value ?? 0.25}
          onChange={(e) => data.onChange?.(parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
        {headroomText ? (
          <p
            data-testid="civic-budget-headroom"
            style={{ margin: '6px 0 0', fontSize: 11, lineHeight: 1.35 }}
          >
            Budget headroom: {headroomText}
            {biasText && biasText !== '0' ? ` · hype ${biasText}` : ''}
          </p>
        ) : null}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}