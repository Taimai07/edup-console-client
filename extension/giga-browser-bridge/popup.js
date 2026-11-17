'use strict';
const status = document.getElementById('status');
async function call(type) {
  try {
    const result = await chrome.runtime.sendMessage({type});
    status.textContent = JSON.stringify(result, null, 2);
  } catch { status.textContent = '扩展未就绪，请重新加载后重试。'; }
}
document.getElementById('connect').onclick = () => call('connect');
document.getElementById('disconnect').onclick = () => call('disconnect');
call('status');
