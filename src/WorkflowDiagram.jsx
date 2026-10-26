import React, { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import CivicLeverNode from './nodes/CivicLeverNode';
import { describeTrigger, formatTalentDollars } from './triggerContract';

const nodeTypes = { civicLever: CivicLeverNode };

export default function WorkflowDiagram({
  state,
  setState,
  onTick,
  onMockTrigger,
  triggerError,
  triggerPending
}) {
  const initialNodes = [
    { id: '1', type: 'input', data: { label: 'Found Startup\n(Citizen)' }, position: { x: 300, y: 0 } },
    { id: '2', data: { label: 'Choose Idea\n+ Target Market' }, position: { x: 300, y: 100 } },
    { id: '3', data: { label: 'Hire Staff\n(Tech / Marketing / Sales)' }, position: { x: 80, y: 220 } },
    { id: '4', data: { label: 'Assign Tasks\nDevelop Product' }, position: { x: 520, y: 220 } },
    { id: 'morale', data: { label: 'Employee Morale\n& Happiness' }, position: { x: 80, y: 340 }, style: { background: '#4a3f6b' } },
    { id: '5', data: { label: 'Real-World Triggers\n(Firecrawl + Events)' }, position: { x: 300, y: 360 }, style: { background: '#3a5a6b' } },
    { id: 'funding', data: { label: 'Funding Rounds\n(Angel / Seed / Series)' }, position: { x: 520, y: 340 }, style: { background: '#3a6b4a' } },
    {
      id: 'civic-tax',
      type: 'civicLever',
      data: {
        label: 'Civic Lever:\nTax Policy',
        value: state.taxRate,
        onChange: (v) => setState((s) => ({ ...s, taxRate: v }))
      },
      position: { x: 40, y: 480 }
    },
    { id: 'civic-infra', data: { label: 'Civic Lever:\nInfrastructure / Talent' }, position: { x: 220, y: 500 }, style: { background: '#6b3a3a' } },
    { id: 'civic-reg', data: { label: 'Civic Lever:\nRegulations' }, position: { x: 400, y: 480 }, style: { background: '#6b3a3a' } },
    { id: '7', data: { label: 'Launch / Market / Sell\nTrack Runway & Hype' }, position: { x: 580, y: 480 } },
    { id: '8', type: 'output', data: { label: 'Exit / IPO / Acquisition\nor Iterate / Pivot' }, position: { x: 300, y: 640 } },
  ];

  const initialEdges = [
    { id: 'e1-2', source: '1', target: '2', animated: true },
    { id: 'e2-3', source: '2', target: '3' },
    { id: 'e2-4', source: '2', target: '4' },
    { id: 'e3-morale', source: '3', target: 'morale' },
    { id: 'e4-5', source: '4', target: '5' },
    { id: 'em-5', source: 'morale', target: '5', label: 'affects' },
    { id: 'e5-funding', source: '5', target: 'funding', label: 'modulates' },
    { id: 'e5-civic-tax', source: '5', target: 'civic-tax' },
    { id: 'e5-civic-infra', source: '5', target: 'civic-infra' },
    { id: 'e5-civic-reg', source: '5', target: 'civic-reg' },
    { id: 'efunding-7', source: 'funding', target: '7' },
    { id: 'etax-7', source: 'civic-tax', target: '7', label: 'burn rate' },
    { id: 'einfra-7', source: 'civic-infra', target: '7', label: 'talent cost' },
    { id: 'ereg-7', source: 'civic-reg', target: '7', label: 'compliance' },
    { id: 'e7-8', source: '7', target: '8' },
    { id: 'efunding-8', source: 'funding', target: '8', animated: true },
  ];

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Keep lever readouts in sync. civic-tax stays the tax control.
  useEffect(() => {
    const latest = state.triggers[0];
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === 'civic-tax') {
          return { ...n, data: { ...n.data, value: state.taxRate } };
        }
        if (n.id === '5') {
          const detail = latest ? `\n${describeTrigger(latest)}` : '';
          return {
            ...n,
            data: {
              ...n.data,
              label: `Real-World Triggers\n(Firecrawl + Events)${detail}`
            }
          };
        }
        if (n.id === 'civic-infra') {
          return {
            ...n,
            data: {
              ...n.data,
              label: `Civic Lever:\nInfrastructure / Talent\nTalent cost: ${formatTalentDollars(state.company.talentCost)}`
            }
          };
        }
        if (n.id === '7') {
          return {
            ...n,
            data: {
              ...n.data,
              label: `Launch / Market / Sell\nTrack Runway & Hype\nHype: ${Math.round(state.company.hype * 100)}%`
            }
          };
        }
        return n;
      })
    );
  }, [state, setNodes]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  return (
    <div>
      <h2 style={{ textAlign: 'center', margin: '8px 0', color: '#e0e0e0' }}>
        Citizen — Startup + Civic Workflow
      </h2>
      <div style={{ width: '100%', height: '60vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background color="#222" gap={16} />
        <Controls />
        <MiniMap />
      </ReactFlow>
      </div>
      <div style={{ textAlign: 'center', margin: '8px 0 12px' }}>
        <button type="button" onClick={onTick} style={{ padding: '6px 16px' }}>
          Advance Month (apply effects)
        </button>
        <button
          type="button"
          data-testid="mock-hype-trigger"
          onClick={() => onMockTrigger?.('news_spike')}
          disabled={triggerPending}
          style={{ padding: '6px 16px', marginLeft: 8 }}
        >
          Apply news spike
        </button>
        <button
          type="button"
          data-testid="mock-talent-trigger"
          onClick={() => onMockTrigger?.('policy_change')}
          disabled={triggerPending}
          style={{ padding: '6px 16px', marginLeft: 8 }}
        >
          Apply policy change
        </button>
        <button
          type="button"
          data-testid="mock-market-trigger"
          onClick={() => onMockTrigger?.('market_shift')}
          disabled={triggerPending}
          style={{ padding: '6px 16px', marginLeft: 8 }}
        >
          Apply market shift
        </button>
        {triggerError ? (
          <p data-testid="trigger-error" style={{ color: '#f87171' }}>{triggerError}</p>
        ) : null}
      </div>
    </div>
  );
}