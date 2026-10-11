import React from 'react';

// 局部可恢复边界：包裹易崩溃的交互面板（增强/反推）。
// 当子树渲染抛出 DOM 协调类错误（insertBefore/removeChild 等，多由浏览器扩展
// 注入 textarea/input 引发）时，通过更换 key 把"这一块"子树卸载重建，
// 清除 DOM 失同步——只重挂当前面板，页面其余部分不受影响，不会出现"整页刷新"。
// 最多自动重挂 maxRetries 次（默认 3），仍失败则显示一个紧凑的重试按钮。
export default class RecoverableBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, key: 0 };
    this.retries = 0;
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('局部渲染错误，尝试自动恢复：', error, info);
    const max = this.props.maxRetries ?? 3;
    if (this.retries < max) {
      this.retries += 1;
      // 清错态 + 换 key → 子树整体重挂，清除 DOM 失同步
      this.setState((s) => ({ error: null, key: s.key + 1 }));
    }
  }

  handleRetry = () => {
    this.retries = 0;
    this.setState((s) => ({ error: null, key: s.key + 1 }));
  };

  render() {
    if (this.state.error) {
      // 仍在自动恢复次数内时，componentDidCatch 会立刻换 key 重挂，
      // 这里渲染 null 避免闪烁可见的回退卡片。
      if (this.retries < (this.props.maxRetries ?? 3)) {
        return null;
      }
      return (
        <div className="rounded-xl border border-border/60 bg-card p-4 text-center">
          <p className="text-xs text-muted-foreground mb-2.5">渲染异常，已多次自动恢复仍未成功</p>
          <button
            onClick={this.handleRetry}
            className="px-3 py-1.5 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90"
          >
            重试
          </button>
        </div>
      );
    }
    return <React.Fragment key={this.state.key}>{this.props.children}</React.Fragment>;
  }
}