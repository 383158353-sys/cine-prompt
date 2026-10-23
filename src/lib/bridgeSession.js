// PS「优化」打开桌面工作台时，地址是 /?bridge=<sessionId>。
// 分组要在首帧就落到逻辑修复，不能等 bridge-session 请求回来。

export function bridgeIdFromSearch(search = '') {
  const id = new URLSearchParams(search).get('bridge');
  return typeof id === 'string' ? id.trim() : '';
}

export function initialEnhanceGroup(search = '') {
  return bridgeIdFromSearch(search) ? 'repair' : 'character';
}

export function bridgeBannerCopy({ group, completed }) {
  if (group === 'repair') {
    return completed
      ? '逻辑修复已完成，修复提示词已回传 PS；现在可回到 PS 点击生成。'
      : 'PS 已连接：当前为逻辑修复。可标注错误区域并补充说明，生成修复提示词后自动回传 PS。';
  }
  return completed
    ? '已增强并回传 PS；现在可回到 PS 点击生成。'
    : 'PS 已连接：可继续选择角色/环境、方向、风格库和模型，也可拖入新图片；点击增强后自动回传。';
}
