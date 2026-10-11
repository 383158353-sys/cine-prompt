import React from 'react';

// 顶层错误边界：包裹整个 App，作为最后防线。
// 注意：此处不再做整树自动重挂——整树重挂会让用户感觉"页面自动刷新"，
// 且生产环境浏览器扩展会反复注入 DOM 形成死循环。
// 整树级崩溃极少见；真发生时显示手动重试/刷新卡片，由用户决定。
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('顶层渲染错误：', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <div className="max-w-md w-full rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground mb-1.5">页面渲染出错</h2>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
              已捕获到一处渲染异常。请尝试刷新页面；若反复出现，请把下方错误信息反馈给开发者。
            </p>
            <pre className="text-[11px] text-destructive/80 bg-muted/40 rounded-lg p-2.5 mb-3 whitespace-pre-wrap break-all max-h-40 overflow-auto">
              {this.state.error?.message || String(this.state.error)}
            </pre>
            <button
              onClick={this.handleReload}
              className="w-full h-9 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}