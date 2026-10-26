import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="App" style={{ background: '#0f0f1a', minHeight: '100vh', color: 'white' }}>
          <h1>Citizen</h1>
          <p className="data-source data-source--alert" role="alert">
            This screen could not be drawn. Refresh the page to try again.
          </p>
        </main>
      );
    }
    return this.props.children;
  }
}
