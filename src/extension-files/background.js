/* global chrome */
// 后台服务：监听全局快捷键，向当前标签页发送切换指令
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-enhancer') return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    if (!/^https?:\/\//.test(tab.url || '')) return; // 系统页无法注入
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_ENHANCER' }, () => {
      void chrome.runtime.lastError;
    });
  });
});