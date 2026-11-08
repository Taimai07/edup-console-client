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
    const info = el('p', '本次固定 ' + scope.codes.length + ' 款商品。扩展读取商品退货率，服务端筛选后再收藏合格商品。');
    const status = el('p'), next = el('button', '已打开，检查并继续'), cancel = el('button', '取消本次操作');
    const guide = el('details'), steps = el('ol'), folder = el('input'), copy = el('button', '复制扩展目录'), folderNote = el('p');
    guide.append(el('summary', '首次安装、更新和连接教程'));
    for (const text of ['首次使用：在Chrome地址栏输入 chrome://extensions/，打开“开发者模式”。',
      '点击“加载已解压的扩展程序”，选择下方显示的扩展目录。这一步需要你在Chrome中确认；工作台不会替你接管浏览器。',
      '已安装后更新：在Chrome扩展页找到“大健本机连接”，点击重新加载；无需重复添加。',
      `回到已登录的大健${names[scope.site] || scope.site}地区账号网页，打开该扩展，点击“连接此大健页”。`,
      '回到工作台，点击“已打开，检查并继续”。账号或地区不符时会暂停，不自动切换账号。']) steps.append(el('li', text));
    folder.readOnly = true; folder.setAttribute('aria-label', '大健浏览器扩展目录'); folder.value = '正在检查本机扩展目录…';
    copy.disabled = true; folder.onclick = () => folder.select();
    window.edup.maintenance('giga-browser-folder').then(value => {if(value.directory){folder.value=value.directory;copy.disabled=false;}else throw Error();})
      .catch(() => {folder.value='本机扩展目录尚未准备';folderNote.textContent='请先完成本机连接组件设置，再按以上步骤加载。';});
    copy.onclick = async () => {try{await window.edup.maintenance('giga-browser-copy-folder');folderNote.textContent='扩展目录已复制。';}catch{folderNote.textContent='复制未完成，请选中上方目录手动复制。';}};
    guide.append(steps, folder, copy, folderNote, el('p', '连接只授权当前选定的大健页面；Cookie留在浏览器内。你可以随时在扩展里断开。'));
    let started = false, timer = null, closed = false;
    const finish = (error, value) => { if (closed) return; closed = true; clearTimeout(timer); if (error) {error.gigaBrowserStep = true; reject(error);} else {box.remove(); resolve(value);} };
    cancel.onclick = () => { if (!started) { box.remove(); finish(Error('GIGA_BROWSER_USER_CANCELLED')); } };
    next.onclick = async () => {
      if (started || closed) return;
      next.disabled = true;
      try {
        let task = await window.edup.maintenance('giga-browser-start', scope);
        let excluded = [];
        started = true; cancel.disabled = true;
        status.textContent = '正在核验大健账号并逐款读取商品退货率。请保持账号不变。';
        const poll = async () => {
          if (closed) return;
          try {
            const receipt = await window.edup.maintenance('giga-browser-task', {id: task.id});
            if (!box.isConnected) { finish(Error('GIGA_BROWSER_VIEW_CLOSED_CHECK_RECEIPT')); return; }
            if (receipt.state === 'rates_read') {
              const screening = await window.edup.maintenance('giga-browser-screen', {id: task.id});
              excluded = screening.excluded;
              if (!screening.task) { finish(null, {codes:[], excluded}); return; }
              task = screening.task;
              status.textContent = '服务端已返回符合条件的商品，正在收藏并核对。';
            }
            if (receipt.state === 'verified') { finish(null, {...receipt, excluded}); return; }
            if (receipt.state === 'stopped') { status.textContent = '收藏检查暂停，原读取/准备尚未启动。' + (messages[receipt.code] || receipt.code); finish(Error(receipt.code)); return; }
            timer = setTimeout(poll, 2000);
          } catch { status.textContent = '暂时无法读取收藏回执，原流程尚未启动。请核对连接后重试读取，勿重复创建任务。'; finish(Error('GIGA_BROWSER_RECEIPT_UNKNOWN')); }
        };
        await poll();
      } catch (error) { status.textContent = messages[error.message] || error.message; next.disabled = false; }
    };
    box.append(el('h3', '先核验大健地区账号并收藏'), note, info, guide, next, cancel, status); target.append(box);
  });
}
