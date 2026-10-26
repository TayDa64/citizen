import React, { useState, useCallback } from 'react';
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

const initialNodes = [
  { id: '1', type: 'input', data: { label: 'Found Startup (Citizen)' }, position: { x: 250, y: 0 } },
  { id: '2', data: { label: 'Choose Idea + Market' }, position: { x: 250, y: 100 } },
  { id: '3', data: { label: 'Hire Staff (Tech/Marketing/Sales)' }, position: { x: 100, y: 200 } },
  { id: '4', data: { label: 'Assign Tasks / Develop Product' }, position: { x: 400, y: 200 } },
  { id: '5', data: { label: 'Real-World Triggers (Firecrawl)' }, position: { x: 250, y: 300 } },
  { id: '6', data: { label: 'Civic Policies / Budgets Affect' }, position: { x: 50, y: 400 } },
  { id: '7', data: { label: 'Launch / Market / Sell' }, position: { x: 450, y: 400 } },
  { id: '8', type: 'output', data: { label: 'Exit / IPO / Acquisition or Iterate' }, position: { x: 250, y: 500 } },
];

const initialEdges = [
  { id: 'e1-2', source: '1', target: '2', animated: true },
  { id: 'e2-3', source: '2', target: '3' },
  { id: 'e2-4', source: '2', target: '4' },
  { id: 'e3-5', source: '3', target: '5' },
  { id: 'e4-5', source: '4', target: '5' },
  { id: 'e5-6', source: '5', target: '6', label: 'modulates' },
  { id: 'e5-7', source: '5', target: '7', label: 'modulates' },
  { id: 'e6-8', source: '6', target: '8' },
  { id: 'e7-8', source: '7', target: '8' },
];

export default function WorkflowDiagram() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  return (
    <div style={{ width: '100vw', height: '80vh' }}>
      <h2>Citizen Game: Startup + Civic Workflow</h2>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}