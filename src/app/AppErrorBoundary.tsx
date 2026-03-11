import { Component, type ErrorInfo, type ReactNode } from "react";
import { safeStorageRemoveItem, safeStorageSetItem } from "../modules/platform/safeStorage";

type Props = {
  children: ReactNode;
};

type State = {
  errorMessage: string | null;
  errorStack: string;
};

const CRASH_LOG_KEY = "storyboard-pro/last-crash/v1";

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    errorMessage: null,
    errorStack: ""
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      errorMessage: error.message || "未知错误",
      errorStack: error.stack || ""
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const payload = {
      at: new Date().toISOString(),
      message: error.message,
      stack: error.stack || "",
      componentStack: errorInfo.componentStack || ""
    };
    safeStorageSetItem(CRASH_LOG_KEY, JSON.stringify(payload));
    console.error("[AppErrorBoundary] Unhandled render error", payload);
  }

  private onReload = () => {
    window.location.reload();
  };

  private onResetLayout = () => {
    const keys = [
      "storyboard-pro/focus-mode/v1",
      "storyboard-pro/layout-debug/v1",
      "storyboard-pro/main-layout/v1",
      "storyboard-pro/timeline-split/v1",
      "storyboard-pro/aux-panel-state/v1"
    ];
    for (const key of keys) {
      safeStorageRemoveItem(key);
    }
    this.onReload();
  };

  render() {
    if (!this.state.errorMessage) {
      return this.props.children;
    }

    return (
      <div className="app-crash-screen">
        <div className="app-crash-card">
          <h1>界面发生错误</h1>
          <p>{this.state.errorMessage}</p>
          <div className="app-crash-actions">
            <button className="btn-primary" onClick={this.onReload} type="button">
              重新加载
            </button>
            <button className="btn-ghost" onClick={this.onResetLayout} type="button">
              重置布局并重启
            </button>
          </div>
          <details>
            <summary>错误详情</summary>
            <pre>{this.state.errorStack || "无堆栈信息"}</pre>
          </details>
        </div>
      </div>
    );
  }
}
