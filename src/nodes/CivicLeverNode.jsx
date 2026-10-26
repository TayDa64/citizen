import { Handle, Position } from '@xyflow/react';

export default function CivicLeverNode({ data }) {
  return (
    <div style={{
      padding: 12,
      background: '#6b3a3a',
      color: 'white',
      borderRadius: 8,
      minWidth: 180,
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
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}