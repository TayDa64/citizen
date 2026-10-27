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
import { triggerDiagramOverlay } from './triggers';

const nodeTypes = { civicLever: CivicLeverNode };

// Default React Flow nodes use a light fill; App sets color:white on ancestors,
// so labels need an explicit readable color (and fill) here.
const DEFAULT_NODE_STYLE = {
  background: '#1e293b',
  color: '#f8fafc',
  border: '1px solid #64748b',
};

const STYLED_NODE = {
  morale: { background: '#4a3f6b', color: '#f8fafc', border: '1px solid #64748b' },
  triggers: { background: '#3a5a6b', color: '#f8fafc', border: '1px solid #64748b' },
  funding: { background: '#3a6b4a', color: '#f8fafc', border: '1px solid #64748b' },
  civic: { background: '#6b3a3a', color: '#f8fafc', border: '1px solid #64748b' },
};

const HYPE_NODE_STYLE = {
  background: '#1e293b',
  color: '#f8fafc',
  border: '2px solid #fde68a',
};

function applyOverlayToNodes(nodes, taxRate, overlay) {
  const existingHype = nodes.find((node) => node.id === 'hype');
  let changed = false;
  const next = [];

  for (const node of nodes) {
    if (node.id === 'hype') continue;
    if (node.id === 'civic-tax' && node.data.value !== taxRate) {
      changed = true;
      next.push({ ...node, data: { ...node.data, value: taxRate } });
      continue;
    }
    const label = overlay.nodeLabels[node.id];
    const ariaLabel = overlay.nodeAriaLabels?.[node.id];
    const labelChanged = Boolean(label) && label !== node.data.label;
    const ariaChanged = ariaLabel !== undefined && ariaLabel !== node.ariaLabel;
    if (labelChanged || ariaChanged) {
      changed = true;
      next.push({
        ...node,
        ariaLabel: ariaLabel ?? node.ariaLabel,
        data: { ...node.data, label: label ?? node.data.label },
      });
      continue;
    }
    next.push(node);
  }

  if (overlay.hypeNode) {
    const label = overlay.hypeNode.label;
    if (!existingHype || existingHype.data.label !== label) changed = true;
    next.push(
      existingHype
        ? { ...existingHype, data: { ...existingHype.data, label }, style: HYPE_NODE_STYLE }
        : {
            id: 'hype',
            data: { label },
            position: { x: 640, y: 70 },
            style: HYPE_NODE_STYLE,
          }
    );
  } else if (existingHype) {
    changed = true;
  }

  return changed ? next : nodes;
}

function applyOverlayToEdges(edges, overlay) {
  const existingHype = edges.find((edge) => edge.id === 'e5-hype');
  let changed = false;
  const next = [];

  for (const edge of edges) {
    if (edge.id === 'e5-hype') continue;
    const label = overlay.edgeLabels[edge.id];
    if (label !== undefined && label !== edge.label) {
      changed = true;
      next.push({ ...edge, label });
      continue;
    }
    next.push(edge);
  }

  if (overlay.hypeNode) {
    const label = overlay.hypeNode.edgeLabel;
    if (!existingHype || existingHype.label !== label) changed = true;
    next.push(
      existingHype
        ? { ...existingHype, label }
        : {
            id: 'e5-hype',
            source: '5',
            target: 'hype',
            label,
          }
    );
  } else if (existingHype) {
    changed = true;
  }

  return changed ? next : edges;
}

export default function WorkflowDiagram({ state, setState, onTick }) {
  const initialNodes = [
    { id: '1', type: 'input', data: { label: 'Found Startup\n(Citizen)' }, position: { x: 300, y: 0 }, style: DEFAULT_NODE_STYLE },
    { id: '2', data: { label: 'Choose Idea\n+ Target Market' }, position: { x: 300, y: 100 }, style: DEFAULT_NODE_STYLE },
    { id: '3', data: { label: 'Hire Staff\n(Tech / Marketing / Sales)' }, position: { x: 80, y: 220 }, style: DEFAULT_NODE_STYLE },
    { id: '4', data: { label: 'Assign Tasks\nDevelop Product' }, position: { x: 520, y: 220 }, style: DEFAULT_NODE_STYLE },
    { id: 'morale', data: { label: 'Employee Morale\n& Happiness' }, position: { x: 80, y: 340 }, style: STYLED_NODE.morale },
    { id: '5', data: { label: 'Real-World Triggers\n(Firecrawl + Events)' }, position: { x: 300, y: 360 }, style: STYLED_NODE.triggers },
    { id: 'funding', data: { label: 'Funding Rounds\n(Angel / Seed / Series)' }, position: { x: 520, y: 340 }, style: STYLED_NODE.funding },
    {
      id: 'civic-tax',
      type: 'civicLever',
      initialWidth: 200,
      initialHeight: 120,
      data: {
        label: 'Civic Lever:\nTax Policy',
        value: state.taxRate,
        onChange: (v) => setState((s) => ({ ...s, taxRate: v }))
      },
      position: { x: 40, y: 480 }
    },
    { id: 'civic-infra', data: { label: 'Civic Lever:\nInfrastructure / Talent' }, position: { x: 220, y: 500 }, style: STYLED_NODE.civic },
    { id: 'civic-reg', data: { label: 'Civic Lever:\nRegulations' }, position: { x: 400, y: 480 }, style: STYLED_NODE.civic },
    { id: '7', data: { label: 'Launch / Market / Sell\nTrack Runway & Hype' }, position: { x: 580, y: 480 }, style: DEFAULT_NODE_STYLE },
    { id: '8', type: 'output', data: { label: 'Exit / IPO / Acquisition\nor Iterate / Pivot' }, position: { x: 300, y: 640 }, style: DEFAULT_NODE_STYLE },
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

  // Keep the tax lever and any world-event labels in sync with simulation state.
  useEffect(() => {
    const overlay = triggerDiagramOverlay(state);
    setNodes((nds) => applyOverlayToNodes(nds, state.taxRate, overlay));
    setEdges((eds) => applyOverlayToEdges(eds, overlay));
  }, [
    state.taxRate,
    state.company.hype,
    state.company.talentCost,
    state.talentMultiplier,
    state.talentMix,
    state.talentCostFactor,
    state.effectiveMultiplier,
    state.employees,
    state.dataSource,
    state.activeTriggers,
    setNodes,
    setEdges,
  ]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  return (
    <div className="workflow-diagram">
      <h2 className="workflow-diagram__title">
        Citizen — Startup + Civic Workflow
      </h2>
      <div className="workflow-diagram__canvas">
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
      <div className="workflow-diagram__tick">
        <button onClick={onTick} style={{ padding: '6px 16px' }}>
          Advance Month (apply effects)
        </button>
      </div>
    </div>
  );
}