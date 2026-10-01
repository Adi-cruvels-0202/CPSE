import { Component } from 'react';

/**
 * The last line of defence — checklist 11.16.
 *
 * A render error anywhere below this unmounts the tree and leaves a white
 * screen, which tells a customer nothing and tells us nothing either. This
 * catches it, says so plainly, and offers the one action that usually works.
 *
 * A class because React only exposes `componentDidCatch` to one.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console -- the browser console is the only
    // reporter this app has until an error service is chosen.
    console.error('Unhandled render error', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="stack" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
        <h1>Something broke</h1>
        <p className="muted">
          That is our fault, not yours. Reloading usually clears it.
        </p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
