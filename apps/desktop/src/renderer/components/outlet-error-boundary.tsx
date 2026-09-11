import { Component, type ReactNode } from "react";

import { Notice } from "./ui.js";

interface OutletErrorBoundaryProps {
  resetKey: string;
  children: ReactNode;
}

interface OutletErrorBoundaryState {
  error: Error | null;
}

/** 特性页抛错时保住应用壳，切走路由后重置。 */
export class OutletErrorBoundary extends Component<
  OutletErrorBoundaryProps,
  OutletErrorBoundaryState
> {
  public override state: OutletErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): OutletErrorBoundaryState {
    return { error };
  }

  public override componentDidUpdate(prevProps: OutletErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  public override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="wf-page">
          <Notice tone="danger" title="页面无法显示">
            <p className="wf-body-note">{this.state.error.message}</p>
          </Notice>
        </div>
      );
    }
    return this.props.children;
  }
}
