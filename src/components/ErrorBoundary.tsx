import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; fallbackMessage: string; retryLabel: string };
type State = { hasError: boolean };

/** Keeps a single Convex/network hiccup from blanking the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Paldrop error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page center-page">
          <div className="panel error-panel" role="alert">
            <p className="panel-text">{this.props.fallbackMessage}</p>
            <button
              className="btn btn-primary btn-block"
              onClick={() => this.setState({ hasError: false })}
            >
              {this.props.retryLabel}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
