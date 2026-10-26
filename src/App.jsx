import React from 'react';
import WorkflowDiagram from './WorkflowDiagram';

function App() {
  return (
    <div className="App">
      <header style={{ padding: '1rem', background: '#1a1a2e', color: 'white', textAlign: 'center' }}>
        <h1>Citizen</h1>
        <p>Civic + Startup Simulation</p>
      </header>
      <WorkflowDiagram />
    </div>
  );
}

export default App;