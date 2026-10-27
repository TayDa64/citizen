import { Handle, Position } from '@xyflow/react';

export default function HireStaffNode({ data }) {
  const headcount = Number(data.headcount) || 0;
  const multiplier = data.talentMultiplier ?? 1;
  const rosterSummary = data.rosterSummary
    || (headcount === 0 ? 'no employees' : `${headcount} employee${headcount === 1 ? '' : 's'}`);
  return (
    <div
      className="hire-staff-node"
      style={{
        padding: 12,
        background: '#1e293b',
        color: '#f8fafc',
        borderRadius: 8,
        border: '1px solid #64748b',
        minWidth: 180,
        width: 200,
        boxSizing: 'border-box',
        fontSize: 12,
        textAlign: 'left',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <strong style={{ whiteSpace: 'pre-line' }}>
        Hire Staff
        {'\n'}
        (Tech / Marketing / Sales)
      </strong>
      <p style={{ margin: '8px 0 4px', fontSize: 11, color: '#cbd5e1' }}>
        Talent ×{Number(multiplier).toFixed(4)}
        {'\n'}
        {rosterSummary}
      </p>
      <button
        type="button"
        data-testid="hire-employee"
        aria-label="Hire tech employee"
        className="nodrag nopan"
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          data.onHire?.({ department: 'tech', skill: 1 });
        }}
        style={{
          marginTop: 4,
          padding: '6px 10px',
          width: '100%',
          cursor: 'pointer',
          background: '#334155',
          color: '#f8fafc',
          border: '1px solid #94a3b8',
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        Hire tech
      </button>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
