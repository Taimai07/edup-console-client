import {el} from './analytics.js';
const names = {US:'美国', DE:'德国', GB:'英国', CA:'加拿大', JP:'日本'};
const batchSize = 30;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidenceText = {
  RATE_MEDIUM: '上次详情页显示退货率为「中」，按当前规则排除。',
  RATE_HIGH: '上次详情页显示退货率为「高」，按当前规则排除。',
  RATE_UNVERIFIED: '上次未能核实详情页退货率，本款暂停，可重新读取核对。',
  RATE_LOW: '上次详情页显示「低」，仍需核对收藏回执。',
  RATE_NA: '上次详情页明确显示 N/A，仍需核对收藏回执。',
  FAVORITE_CONNECTION_CHANGED: '已换浏览器连接，需用当前买家会话重新核验。',
  FAVORITE_EXPIRED: '已有收藏回执已过有效期，需重新核验。',
  FAVORITE_NOT_VERIFIED: '收藏结果尚未核实，需重新核对。',
  RETURN_RATE_NOT_LOW: '退货率未达到当前筛选条件，本款已排除。',
  RETURN_RATE_UNVERIFIED: '详情页退货率未能核实，本款暂停。',
  RESOLVE_FAILED:'未能核实这款 SKU 与大健商品的对应关系。',
  RECONCILIATION_PENDING:'收藏仍待核对，本款没有重复发送。',
  RATE_FRAME_BLOCKED:'详情页被拦截或跳转，退货率待核对。',
  RATE_TIMEOUT:'详情页读取超时，退货率待核对。',
  RATE_SKU_UNVERIFIED:'详情页中未核实到该 SKU，退货率待核对。',
  RATE_LABEL_UNVERIFIED:'详情页未核实到有效退货率标签。',
  RATE_CONFLICT:'详情页出现冲突的退货率标签。',
  SERVER_RECHECK: '服务器要求重新核验这款的收藏回执。'
};
export const favoriteEvidenceText = reason => Object.hasOwn(evidenceText, reason)
  ? evidenceText[reason] : '未找到可用的收藏回执或退货率记录。';
const messages = {
  GIGA_BROWSER_SETUP_REQUIRED:'尚未安装本机浏览器连接组件，请先完成设置。',
  GIGA_BROWSER_NOT_CONNECTED:'尚未连接，请在大健网页的扩展中点击“连接此大健页”。',
  GIGA_BROWSER_UPDATE_REQUIRED:'连接扩展尚未更新。请在Chrome扩展页重新加载“大健本机连接”，再回到大健网页点击连接。',
  GIGA_BROWSER_REGION_MISMATCH:'当前大健账号地区与本次所选站点不一致，请手动打开对应地区账号并重新连接。',
  GIGA_BROWSER_TASK_REQUIRES_RECONCILIATION:'上次浏览器任务尚未核实，请先核对结果，暂不重复执行。',
  GIGA_REGION_MAPPING_NOT_VERIFIED:'这个站点与大健供货地区的映射尚未核实，暂不能自动收藏。'
};
async function checkFavorites(task, active, update) {
  let excluded = [];
  let deadline = Date.now() + 30 * 60 * 1000;
  while (active() && Date.now() < deadline) {
    const receipt = await window.edup.maintenance('giga-browser-task', {id: task.id});
    if (!active()) break;
    if (receipt.state === 'rates_read') {
      const screening = await window.edup.maintenance('giga-browser-screen', {id: task.id});
      const rates = new Map(receipt.items.map(row => [row.sku, row.reason||row.state]));
      excluded = screening.excluded.map(row => ({...row, rate: rates.get(row.sku)}));
      if (!screening.task) return {codes: [], excluded};
      task = screening.task;
      deadline = Date.now() + 30 * 60 * 1000;
      update('正在收藏并核对通过退货率筛选的商品。');
    } else if (receipt.state === 'verified') {
      return {...receipt, excluded: [...excluded,...(receipt.excluded||[])]};
    } else if (receipt.state === 'stopped') {
      throw Error(receipt.code);
    }
    await wait(2000);
  }
  throw Error(active() ? 'GIGA_BROWSER_RECEIPT_UNKNOWN' : 'GIGA_BROWSER_VIEW_CLOSED_CHECK_RECEIPT');
}

export async function reconcileGigaFavorites(id, active, update) {
  const task = await window.edup.maintenance('giga-browser-reconcile', id ? {id} : undefined);
  return checkFavorites(task, active, update);
}

export async function ensureGigaFavorites(target, input, admit) {
  const scope = {site: input.site, codes: Object.freeze([...input.codes])};
  if (!window.edup?.maintenance) return Promise.reject(Error('GIGA_BROWSER_DESKTOP_REQUIRED'));
  let saved;
  if (input.reuse) {
    saved = await window.edup.maintenance('giga-browser-reuse', scope).catch(() => null);
    if (!target.isConnected) return {cancelled: true};
  }
  const segments = (saved?.receipts || []).map(receipt => ({codes: receipt.codes, receipt}));
  const pending = saved?.missing || scope.codes;
  const connection = await window.edup.maintenance('giga-browser-status').catch(() => null);
  const segmentLimit = connection?.accountScopeV2 ? batchSize : 20;
  // Preparation may use verified evidence. Only the explicit read action can
  // open the region and favorite confirmation.
  if (input.reuse && pending.length) {
    return {processed: 0, remaining: scope.codes, verificationRequired: pending, verificationDetails: saved?.missingDetails};
  }
  for (let offset = 0; offset < pending.length; offset += segmentLimit) {
    segments.push({codes: pending.slice(offset, offset + segmentLimit)});
  }
  const count = segments.length;
  return new Promise(resolve => {
    const box = el('section', undefined, 'operation-preview');
    const note = el('p', `请手动打开并登录大健${names[scope.site] || scope.site}地区账号，在扩展中点击“连接此大健页”，再点击下方按钮。`);
    const info = el('p', pending.length ? '需要核验 ' + pending.length + ' 款商品。扩展读取商品退货率，标为低或 N/A 的商品通过筛选后再收藏。'
      : '正在复用 ' + scope.codes.length + ' 款商品已核验的收藏回执。');
    if (pending.length && segments.some(segment => segment.receipt)) info.textContent += ' 其余商品使用已核验回执。';
    if (count > 1) info.textContent += ' 将按顺序处理 ' + count + ' 段，请保持此页面与大健登录。';
    const status = el('p'), next = el('button', '已打开，检查并继续'), cancel = el('button', '取消本次操作');
    const reconcile = el('button','核对上次收藏结果');
    reconcile.hidden=true;
    const guide = el('details'), steps = el('ol'), folder = el('input'), copy = el('button', '复制扩展目录'), folderNote = el('p');
    guide.append(el('summary', '首次安装、更新和连接教程'));
    for (const text of ['首次使用：在Chrome地址栏输入 chrome://extensions/，打开“开发者模式”。',
      '点击“加载已解压的扩展程序”，选择下方显示的扩展目录。这一步需要你在Chrome中确认；工作台不会替你接管浏览器。',
      '已安装后更新：在Chrome扩展页找到“大健本机连接”，点击重新加载；无需重复添加。',
      `回到已登录的大健${names[scope.site] || scope.site}地区账号网页，打开该扩展，点击“连接此大健页”。`,
      '回到工作台，点击“已打开，检查并继续”。账号或地区不符时会暂停，不自动切换账号。']) steps.append(el('li', text));
    folder.readOnly = true; folder.setAttribute('aria-label', '大健浏览器扩展目录'); folder.value = '正在检查本机扩展目录…';
    copy.disabled = true; folder.onclick = () => folder.select();
    if(pending.length)window.edup.maintenance('giga-browser-folder').then(value => {if(value.directory){folder.value=value.directory;copy.disabled=false;}else throw Error();})
      .catch(() => {folder.value='本机扩展目录尚未准备';folderNote.textContent='请先完成本机连接组件设置，再按以上步骤加载。';});
    copy.onclick = async () => {try{await window.edup.maintenance('giga-browser-copy-folder');folderNote.textContent='扩展目录已复制。';}catch{folderNote.textContent='复制未完成，请选中上方目录手动复制。';}};
    guide.append(steps, folder, copy, folderNote, el('p', '连接只授权当前选定的大健页面；Cookie留在浏览器内。你可以随时在扩展里断开。'));
    let started = false, stop = false;
    const active = () => box.isConnected;
    reconcile.onclick=async()=>{
      reconcile.disabled=true;
      next.disabled=true;
      try{
        const receipt=await reconcileGigaFavorites(undefined,active,text=>{status.textContent=text;});
        status.textContent=receipt.excluded.length?'部分收藏仍待核对；这些商品不会重复发送。':'上次收藏已核对。请继续原批次。';
        reconcile.hidden=true;
      }catch(error){
        status.textContent='收藏结果仍待核对。'+(messages[error.message]||'请先检查大健买家账号及收藏状态。');
      }finally{reconcile.disabled=false;next.disabled=false;}
    };
    const finish = value => { clearInterval(viewWatcher); box.remove(); resolve(value); };
    const viewWatcher = setInterval(() => {
      if (!active() && !next.disabled) finish({cancelled: true});
    }, 1000);
    cancel.onclick = () => {
      if (!started) { finish({cancelled: true}); return; }
      stop = true;
      cancel.disabled = true;
      cancel.textContent = '将在当前分段结束后停止';
    };
    next.onclick = async () => {
      if (started || !active()) return;
      next.disabled = true;
      cancel.disabled = true;
      const processed = new Set();
      const outcome = () => ({processed: processed.size, remaining: scope.codes.filter(sku => !processed.has(sku))});
      try {
        for (let offset = 0; offset < count && active() && !stop; offset++) {
          const {codes, receipt: savedReceipt} = segments[offset];
          const index = offset + 1;
          const update = text => { status.textContent = (count > 1 ? `第 ${index}/${count} 段 · ` : '') + text; };
          const allowStop = () => {
            if (stop) return;
            cancel.disabled = false;
            cancel.textContent = '完成当前分段后停止';
          };
          let receipt = savedReceipt;
          if (receipt) {
            update('复用已核验的收藏回执。');
          } else {
            update('正在核验账号并逐款读取商品退货率。');
            const task = await window.edup.maintenance('giga-browser-start', {site: scope.site, codes});
            started = true;
            if (count > 1) allowStop();
            receipt = await checkFavorites(task, active, update);
          }
          started = true;
          if (count > 1) allowStop();
          if (!active()) break;
          if (receipt.codes.length && (receipt.site !== scope.site || receipt.codes.some(sku => !codes.includes(sku)))) {
            throw Error('GIGA_BROWSER_RECEIPT_SCOPE_MISMATCH');
          }
          await admit(receipt, {index, count, codes, update, active, allowStop, stopRequested: () => stop});
          if (!active()) break;
          for (const sku of codes) processed.add(sku);
          if (index < count && active() && !stop) {
            update('本段已结束，稍后开始下一段。');
            await wait(2000);
          }
        }
        finish(outcome());
      } catch (error) {
        if (!started && active()) {
          const code = Object.keys(messages).find(key => String(error.message).includes(key));
          status.textContent = code ? messages[code] : error.message;
          if(code==='GIGA_BROWSER_TASK_REQUIRES_RECONCILIATION')reconcile.hidden=false;
          next.disabled = cancel.disabled = false;
          return;
        }
        finish({...outcome(), error});
      }
    };
    if (pending.length) box.append(el('h3', '先核验大健地区账号并收藏'), note, info, guide, next, cancel, reconcile, status);
    else box.append(info, cancel, status);
    target.append(box);
    if (!pending.length) next.onclick();
  });
}
