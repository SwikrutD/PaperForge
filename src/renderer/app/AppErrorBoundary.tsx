import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import { ErrorMessageBar } from '../components/surfaces/MessageBar';

interface AppErrorBoundaryProps {
  children: ReactNode;
  /** Identifies the region in diagnostics, e.g. "workspace" or "properties". */
  region: string;
}

interface AppErrorBoundaryState {
  failure: { message: string; details: string } | null;
}

/**
 * Keeps a crash inside one region from taking down the whole window. Heavy
 * panels and document workspaces are each wrapped in their own boundary.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { failure: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { failure: { message: 'This part of PaperForge stopped responding.', details } };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`PaperForge region "${this.props.region}" failed.`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { failure } = this.state;
    if (failure === null) return this.props.children;
    return (
      <div style={{ padding: 'var(--pf-space-300)' }}>
        <ErrorMessageBar
          error={{
            code: 'internal/unexpected',
            message: failure.message,
            details: failure.details,
          }}
        />
      </div>
    ) as ReactElement;
  }
}
