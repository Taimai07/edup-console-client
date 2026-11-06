import {el} from './analytics.js';
const names = {US:'美国', DE:'德国', GB:'英国', CA:'加拿大', JP:'日本'};
const messages = {
  GIGA_BROWSER_SETUP_REQUIRED:'尚未安装本机浏览器连接组件，请先完成设置。',
  GIGA_BROWSER_NOT_CONNECTED:'尚未连接，请在大健网页的扩展中点击“连接此大健页”。',
  GIGA_BROWSER_UPDATE_REQUIRED:'连接扩展尚未更新。请在Chrome扩展页重新加载“大健本机连接”，再回到大健网页点击连接。',
  GIGA_BROWSER_REGION_MISMATCH:'当前大健账号地区与本次所选站点不一致，请手动打开对应地区账号并重新连接。',
  GIGA_BROWSER_TASK_REQUIRES_RECONCILIATION:'上次浏览器任务尚未核实，请先核对结果，暂不重复执行。',
  GIGA_REGION_MAPPING_NOT_VERIFIED:'这个站点与大健供货地区的映射尚未核实，暂不能自动收藏。'
};
export function ensureGigaFavorites(target, input) {
  const scope = {site: input.site, codes: Object.freeze([...input.codes])};
  if (!window.edup?.maintenance) return Promise.reject(Error('GIGA_BROWSER_DESKTOP_REQUIRED'));
  return new Promise((resolve, reject) => {
    const box = el('section', undefined, 'operation-preview');
    const note = el('p', `请手动打开并登录大健${names[scope.site] || scope.site}地区账号，在扩展中点击“连接此大健页”，再点击下方按钮。`);
    const info = el('p', '本次固定 ' + scope.codes.length + ' 款商品。核验地区和收藏后，才继续原来的读取或准备；这一步不会提交亚马逊。');
    const status = el('p'), next = el('button', '已打开，检查并继续'), cancel = el('button', '取消本次操作');
    let started = false, timer = null, closed = false;
    const finish = (error, value) => { if (closed) return; closed = true; clearTimeout(timer); if (error) {error.gigaBrowserStep = true; reject(error);} else {box.remove(); resolve(value);} };
    cancel.onclick = () => { if (!started) { box.remove(); finish(Error('GIGA_BROWSER_USER_CANCELLED')); } };
    next.onclick = async () => {
      if (started || closed) return;
      next.disabled = true;
      try {
        const task = await window.edup.maintenance('giga-browser-start', scope);
        started = true; cancel.disabled = true;
        status.textContent = '正在核验大健账号、逐款查询与收藏。请保持账号不变；可在浏览器扩展中断开并暂停后续请求。';
        const poll = async () => {
          if (closed) return;
          try {
            const receipt = await window.edup.maintenance('giga-browser-task', {id: task.id});
            if (!box.isConnected) { finish(Error('GIGA_BROWSER_VIEW_CLOSED_CHECK_RECEIPT')); return; }
            if (receipt.state === 'verified') { finish(null, receipt); return; }
            if (receipt.state === 'stopped') { status.textContent = '收藏检查暂停，原读取/准备尚未启动。' + (messages[receipt.code] || receipt.code); finish(Error(receipt.code)); return; }
            timer = setTimeout(poll, 2000);
          } catch { status.textContent = '暂时无法读取收藏回执，原流程尚未启动。请核对连接后重试读取，勿重复创建任务。'; finish(Error('GIGA_BROWSER_RECEIPT_UNKNOWN')); }
        };
        await poll();
      } catch (error) { status.textContent = messages[error.message] || error.message; next.disabled = false; }
    };
    box.append(el('h3', '先核验大健地区账号并收藏'), note, info, next, cancel, status); target.append(box);
  });
}
