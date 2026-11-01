const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function card(title,text){const c=el('article',undefined,'card');c.append(el('h2',title),el('p',text,'muted'));return c;}
export async function renderMaintenance(view,{api,reload}){
 const box=card('设备配对与连接','每台电脑单独登记密钥，换网络仍可使用。配对码10分钟有效，只能使用一次。');view.append(box);
 if(!window.edup?.maintenance){box.append(el('p','开发网页不提供Windows设备配对，请使用桌面客户端。','muted'));return;}
 const call=(a,b)=>window.edup.maintenance(a,b),result=el('div',undefined,'result');
 const server=el('input');server.type='url';server.placeholder='https://console.eduplinkaudio.com';server.className='setting-input';
 const code=el('input');code.type='password';code.autocomplete='off';code.placeholder='一次性配对码';code.className='setting-input';
 const actions=el('div',undefined,'toolbar');
 function button(label,fn){const b=el('button',label);b.onclick=async()=>{b.disabled=true;try{const r=await fn();result.textContent=typeof r==='string'?r:JSON.stringify(r,null,2);}catch(e){result.textContent=e.message;}finally{b.disabled=false;}};actions.append(b);}
 button('保存连接地址',()=>call('configure',{serverUrl:server.value.trim()}));
 button('配对这台电脑',async()=>{const r=await call('pair',{code:code.value});code.value='';await reload();return '设备配对完成：'+r.deviceId;});
 button('连接诊断',async()=>{const r=await api('health');return '连接成功 · 后台 '+r.version+' · API '+r.apiVersion+' · 时间 '+r.serverTime;});
 box.append(server,code,actions,result);
 try{const s=await call('settings');server.value=s.serverUrl;box.append(el('p','客户端 '+s.version+' · 设备 '+s.deviceId+' · '+(s.paired?'已配对':'尚未配对'),'muted'));}catch(e){result.textContent=e.message;}
 const update=card('软件更新','从公开发布页获取更新，校验签名和文件后下载。覆盖安装保留配对与设置；应用内安装前生成加密恢复副本。安装后重新打开软件核验，失败不会自动恢复或重新安装。');const buttons=el('div',undefined,'toolbar'),state=el('div',undefined,'result');
 const names={idle:'尚未检查',checking:'正在检查',available:'有可用更新',current:'当前已是最新版本',not_published:'尚无已签名的正式更新',check_failed:'更新检查暂不可用',downloading:'正在下载',ready:'下载已校验，可以安装',download_failed:'下载未完成，请稍后重试'};
 const show=s=>{state.textContent=(names[s.state]||s.state)+(s.version?' · '+s.version:'')+(s.notes?'\n'+s.notes:'')+(s.code?'\n错误编号：'+s.code:'');};
 for(const [label,action] of [['检查更新','check-update'],['下载更新','download-update'],['安装更新并退出','install-update']]){const b=el('button',label);b.onclick=async()=>{b.disabled=true;try{show(await call(action));}catch(e){state.textContent=e.message;}finally{b.disabled=false;}};buttons.append(b);}
 update.append(buttons,state);view.append(update);try{show(await call('update-status'));}catch{}
 const diagnostics=card('日志与诊断包','滚动保留客户端与服务端运行日志。导出包包含版本、错误编号和请求编号，不包含商品明细、配对码或API密钥。');const exportButton=el('button','导出诊断包');exportButton.onclick=async()=>{try{const r=await call('diagnostics');result.textContent=r.saved?'诊断包已保存':'已取消导出';}catch(e){result.textContent=e.message;}};diagnostics.append(exportButton);view.append(diagnostics);
 view.append(card('数据同步','商品与库存拟按5—15分钟刷新；财务及广告按数据可用性每日更新并回补。当前仍为历史快照，定时采集等待接入。'));
}
