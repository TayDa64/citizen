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
import HireStaffNode from './nodes/HireStaffNode';
import {
  PATHWAY_BUDGET_HEADROOM_TO_HYPE,
  diagramEdgeFromPathway,
  staticDiagramEdgesFromRegistry,
} from './causalGraph';
import { pathwayDiagramOverlay } from './pathways';
import { triggerDiagramOverlay } from './triggers';

const nodeTypes = { civicLever: CivicLeverNode, hireStaff: HireStaffNode };

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

function mergeHypeOverlay(triggerOverlay, pathwayOverlay) {
  // Pathway always owns a hype endpoint; trigger overlay may refine the label.
  if (triggerOverlay?.hypeNode) {
    return {
      ...triggerOverlay.hypeNode,
      fromPathway: pathwayOverlay.hypeNode.fromPathway,
    };
  }
  return pathwayOverlay.hypeNode;
}

function applyOverlayToNodes(nodes, taxRate, overlay, hireMeta = null, civicMeta = null) {
  const existingHype = nodes.find((node) => node.id === 'hype');
  let changed = false;
  const next = [];

  for (const node of nodes) {
    if (node.id === 'hype') continue;
    if (node.id === 'civic-tax') {
      const headroom = civicMeta?.budgetHeadroom;
      const bias = civicMeta?.hypeBias;
      const taxChanged = node.data.value !== taxRate;
      const headroomChanged = node.data.budgetHeadroom !== headroom;
      const biasChanged = node.data.hypeBias !== bias;
      if (taxChanged || headroomChanged || biasChanged) {
        changed = true;
        next.push({
          ...node,
          data: {
            ...node.data,
            value: taxRate,
            budgetHeadroom: headroom,
            hypeBias: bias,
          },
        });
        continue;
      }
      next.push(node);
      continue;
    }
    if (node.id === '3' && hireMeta) {
      // Hire node owns its readout + control; overlay aria still updates.
      const headcountChanged = node.data.headcount !== hireMeta.headcount;
      const multiplierChanged = node.data.talentMultiplier !== hireMeta.talentMultiplier;
      const rosterChanged = node.data.rosterSummary !== hireMeta.rosterSummary;
      const ariaLabel = overlay.nodeAriaLabels?.[node.id];
      const ariaChanged = ariaLabel !== undefined && ariaLabel !== node.ariaLabel;
      if (headcountChanged || multiplierChanged || rosterChanged || ariaChanged) {
        changed = true;
        next.push({
          ...node,
          ariaLabel: ariaLabel ?? node.ariaLabel,
          data: {
            ...node.data,
            headcount: hireMeta.headcount,
            talentMultiplier: hireMeta.talentMultiplier,
            rosterSummary: hireMeta.rosterSummary,
          },
        });
        continue;
      }
      next.push(node);
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

function applyOverlayToEdges(edges, overlay, pathwayOverlay = null, triggerHypeEdge = null) {
  const existingHype = edges.find((edge) => edge.id === 'e5-hype');
  const pathwayEdgeId = PATHWAY_BUDGET_HEADROOM_TO_HYPE.diagram.edgeId;
  let changed = false;
  const next = [];

  for (const edge of edges) {
    if (edge.id === 'e5-hype') continue;
    const pathwayLabel = pathwayOverlay?.edgeLabels?.[edge.id];
    const label = pathwayLabel ?? overlay.edgeLabels[edge.id];
    if (label !== undefined && label !== edge.label) {
      changed = true;
      next.push({ ...edge, label });
      continue;
    }
    next.push(edge);
  }

  // Pathway edge is always present (derived from registry); refresh label.
  if (pathwayOverlay?.edgeLabels?.[pathwayEdgeId]) {
    const pathwayLabel = pathwayOverlay.edgeLabels[pathwayEdgeId];
    const idx = next.findIndex((edge) => edge.id === pathwayEdgeId);
    if (idx >= 0) {
      if (next[idx].label !== pathwayLabel) {
        changed = true;
        next[idx] = { ...next[idx], label: pathwayLabel };
      }
    } else {
      changed = true;
      next.push(
        diagramEdgeFromPathway(PATHWAY_BUDGET_HEADROOM_TO_HYPE, {
          label: pathwayLabel,
        }),
      );
    }
  }

  // Trigger→hype edge only when world events move hype (separate from pathway).
  if (triggerHypeEdge) {
    const label = triggerHypeEdge.edgeLabel;
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

export default function WorkflowDiagram({ state, setState, onTick, onHire }) {
  const initialNodes = [
    { id: '1', type: 'input', data: { label: 'Found Startup\n(Citizen)' }, position: { x: 300, y: 0 }, style: DEFAULT_NODE_STYLE },
    { id: '2', data: { label: 'Choose Idea\n+ Target Market' }, position: { x: 300, y: 100 }, style: DEFAULT_NODE_STYLE },
    {
      id: '3',
      type: 'hireStaff',
      initialWidth: 200,
      initialHeight: 140,
      data: {
        label: 'Hire Staff\n(Tech / Marketing / Sales)',
        headcount: Array.isArray(state.employees) ? state.employees.length : 0,
        talentMultiplier: state.talentMultiplier ?? 1,
        rosterSummary: 'no employees',
        onHire,
      },
      position: { x: 80, y: 220 },
      style: DEFAULT_NODE_STYLE,
    },
    { id: '4', data: { label: 'Assign Tasks\nDevelop Product' }, position: { x: 520, y: 220 }, style: DEFAULT_NODE_STYLE },
    { id: 'morale', data: { label: 'Employee Morale\n& Happiness' }, position: { x: 80, y: 340 }, style: STYLED_NODE.morale },
    { id: '5', data: { label: 'Real-World Triggers\n(Firecrawl + Events)' }, position: { x: 300, y: 360 }, style: STYLED_NODE.triggers },
    { id: 'funding', data: { label: 'Funding Rounds\n(Angel / Seed / Series)' }, position: { x: 520, y: 340 }, style: STYLED_NODE.funding },
    {
      id: 'civic-tax',
      type: 'civicLever',
      initialWidth: 200,
      initialHeight: 140,
      data: {
        label: 'Civic Lever:\nTax Policy',
        value: state.taxRate,
        budgetHeadroom: state.civic?.budgetHeadroom,
        hypeBias: state.civic?.hypeBias,
        onChange: (v) => setState((s) => ({ ...s, taxRate: v }))
      },
      // Civic band spaced horizontally; Launch sits slightly lower so edge
      // midpoints (burn rate / talent cost / compliance) clear neighbors.
      position: { x: 40, y: 470 }
    },
    {
      id: 'civic-infra',
      data: { label: 'Civic Lever:\nInfrastructure / Talent' },
      position: { x: 330, y: 490 },
      style: { ...STYLED_NODE.civic, minWidth: 170 },
    },
    {
      id: 'civic-reg',
      data: { label: 'Civic Lever:\nRegulations' },
      position: { x: 620, y: 470 },
      style: { ...STYLED_NODE.civic, minWidth: 140 },
    },
    {
      id: '7',
      data: { label: 'Launch / Market / Sell\nTrack Runway & Hype' },
      position: { x: 880, y: 600 },
      style: { ...DEFAULT_NODE_STYLE, minWidth: 240 },
    },
    { id: '8', type: 'output', data: { label: 'Exit / IPO / Acquisition\nor Iterate / Pivot' }, position: { x: 440, y: 740 }, style: DEFAULT_NODE_STYLE },
  ];

  const civicEdgeLabel = {
    labelStyle: { fontSize: 12, fill: '#f8fafc', fontWeight: 600 },
    labelBgStyle: { fill: '#0f0f1a', fillOpacity: 0.95 },
    labelBgPadding: [10, 5],
    labelBgBorderRadius: 4,
  };

  // Executable causal edges (tax→burn, pathway, talentCost) come from the registry.
  const causalEdges = staticDiagramEdgesFromRegistry(civicEdgeLabel);

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
    ...causalEdges,
    { id: 'ereg-7', source: 'civic-reg', target: '7', label: 'compliance', ...civicEdgeLabel },
    { id: 'e7-8', source: '7', target: '8' },
    { id: 'efunding-8', source: 'funding', target: '8', animated: true },
  ];

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Keep the tax lever, hire readout, civic metric, pathway edge, and world-event labels in sync.
  useEffect(() => {
    const triggerOverlay = triggerDiagramOverlay(state);
    const pathwayOverlay = pathwayDiagramOverlay(state);
    const overlay = {
      ...triggerOverlay,
      // Pathway always supplies a hype endpoint; triggers may refine the label.
      hypeNode: mergeHypeOverlay(triggerOverlay, pathwayOverlay),
    };
    const hireLines = String(overlay.nodeLabels?.[3] ?? '').split('\n');
    const rosterSummary = hireLines.length >= 4
      ? hireLines.slice(3).join('\n')
      : (Array.isArray(state.employees) && state.employees.length > 0
        ? `${state.employees.length} employee${state.employees.length === 1 ? '' : 's'}`
        : 'no employees');
    const hireMeta = {
      headcount: Array.isArray(state.employees) ? state.employees.length : 0,
      talentMultiplier: state.talentMultiplier ?? 1,
      rosterSummary,
    };
    const civicMeta = {
      budgetHeadroom: state.civic?.budgetHeadroom,
      hypeBias: state.civic?.hypeBias,
    };
    setNodes((nds) => applyOverlayToNodes(nds, state.taxRate, overlay, hireMeta, civicMeta));
    setEdges((eds) => applyOverlayToEdges(
      eds,
      overlay,
      pathwayOverlay,
      triggerOverlay.hypeNode,
    ));
  }, [
    state.taxRate,
    state.civic?.budgetHeadroom,
    state.civic?.hypeBias,
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
          fitViewOptions={{ padding: 0.14, maxZoom: 1.25 }}
          minZoom={0.45}
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