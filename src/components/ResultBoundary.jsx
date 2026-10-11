import React from 'react';

// 局部错误边界：包裹结果渲染区，崩溃时只影响该卡片，不连累整页。
export default class ResultBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, nonce: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('结果渲染异常（已局部捕获）', error, info);
  }

  handleRetry = () => {
    this.setState({ error: null, nonce: this.state.nonce + 1 });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-destructive/30 bg-destructive/[0.03] p-4 text-center">
          <p className="text-sm text-destructive/80 mb-3">结果渲染失败，可重试或重新生成</p>
          <button
            onClick={this.handleRetry}
            className="text-xs px-3 py-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90"
          >
            重试
          </button>
        </div>
      );
    }
    return <div key={this.state.nonce}>{this.props.children}</div>;
  }
}