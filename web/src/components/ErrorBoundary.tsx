import type { ReactNode } from "react";
import React from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // keep it simple: log for debugging
    // eslint-disable-next-line no-console
    console.error("[TaskBubble] Uncaught error", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <div className="card" style={{ maxWidth: 720 }}>
            <h1 style={{ marginTop: 0 }}>TaskBubble crashed</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              This usually happens if Supabase env vars aren’t loaded or the database schema doesn’t match what the app
              expects.
            </p>
            <div className="errorBox" style={{ marginTop: 14, whiteSpace: "pre-wrap" }}>
              {this.state.error.message}
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="primaryBtn" type="button" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              If this keeps happening, confirm <code>web/.env</code> is present and restart <code>npm run dev</code>.
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}


