const ep = document.getElementById('endpoint');
const au = document.getElementById('appUrl');
const msg = document.getElementById('msg');

chrome.storage.sync.get(['endpoint', 'appUrl'], (res) => {
  ep.value = res.endpoint || '';
  au.value = res.appUrl || '';
});

document.getElementById('save').onclick = () => {
  chrome.storage.sync.set({ endpoint: ep.value.trim(), appUrl: au.value.trim() }, () => {
    msg.textContent = '已保存';
    setTimeout(() => (msg.textContent = ''), 2000);
  });
};