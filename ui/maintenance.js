import {message as feedback,friendlyError,notify} from './notices.js';
import {renderNetworkSettings} from './network-settings.js';
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function card(title,text){const c=el('article',undefined,'card');c.append(el('h2',title),el('p',text,'muted'));return c;}
export async function renderMaintenance(view,{api,reload}){
 const box=card('设备配对与连接','每台电脑单独登记密钥，换网络仍可使用。配对码10分钟有效，只能使用一次。');view.append(box);
 if(!window.edup?.maintenance){box.append(el('p','开发网页不提供Windows设备配对，请使用桌面客户端。','muted'));return;}
 const call=(a,b)=>window.edup.maintenance(a,b),result=el('div',undefined,'result');let patchResult=null;
 const server=el('input');server.type='url';server.readOnly=true;server.placeholder='https://console.eduplinkaudio.com';server.className='setting-input';
 const code=el('input');code.type='password';code.autocomplete='off';code.placeholder='一次性配对码';code.className='setting-input';
 const actions=el('div',undefined,'toolbar');
 function button(label,fn){const b=el('button',label);b.onclick=async()=>{b.disabled=true;try{const r=await fn();feedback(result,{level:'success',title:'操作已完成',message:typeof r==='string'?r:'设置已保存'});}catch(e){const m=friendlyError(e);feedback(result,m);notify(m);}finally{b.disabled=false;}};actions.append(b);}
 button('保存连接地址',async()=>{await call('configure',{serverUrl:server.value.trim()});return '连接地址已保存。';});
 button('配对这台电脑',async()=>{await call('pair',{code:code.value});code.value='';await reload();return '设备配对完成，可以读取服务器资料。';});
 button('连接诊断',async()=>{const r=await api('health');return '连接成功 · 后台 '+r.version+' · API '+r.apiVersion+' · 时间 '+r.serverTime;});
 box.append(server,code,actions,result);
 try{const s=await call('settings');server.value=s.serverUrl;patchResult=s.patch?.lastResult;box.append(el('p','客户端 '+s.version+' · '+(s.paired?'这台电脑已配对':'这台电脑尚未配对'),'muted'));}catch(e){feedback(result,friendlyError(e));}
 await renderNetworkSettings(view);
 const update=card('软件更新',''),buttons=el('div',undefined,'toolbar'),state=el('div',undefined,'result');
 const names={idle:'',checking:'正在检查更新…',available:'有可用更新',current:'当前已是最新版本',not_published:'暂未发布正式更新',check_failed:'检查失败，请稍后重试',downloading:'正在下载更新…',ready:'下载已校验，正在准备安装…',download_failed:'下载失败，请稍后重试',cancelled:'已取消更新',installing:'正在启动安装…',restarting:'补丁已就绪，正在重启…'};
 const show=s=>{if(['check_failed','download_failed','update_failed'].includes(s.state)){feedback(state,{level:'error',title:'更新暂未完成',message:'可以继续使用当前版本，稍后再检查更新。',code:s.code||''});return;}state.textContent=(names[s.state]??'正在处理更新')+(s.version&&s.state==='current'?' · '+s.version:'');};
 const check=el('button','检查更新');check.onclick=async()=>{check.disabled=true;state.textContent='正在检查更新…';const poll=setInterval(async()=>{try{show(await call('update-status'));}catch{}},500);try{const r=await call('check-and-install-update');clearInterval(poll);show(r);}catch(e){clearInterval(poll);feedback(state,friendlyError(e));}finally{check.disabled=false;}};
 buttons.append(check);update.append(buttons,state);view.append(update);
 if(['rolled_back','bundled_fallback'].includes(patchResult?.state))feedback(state,{level:'info',title:'已恢复可用版本',message:'上次补丁未能正常启动，软件已退回可用版本。配对和设置保留，可以继续使用。',code:patchResult.reason||''});
 const diagnostics=card('日志与诊断包','运行日志和错误日志分别滚动保留，各最多14份、每份约1MB。记录时间、版本、错误编号、请求编号及脱敏调用位置；不记录商品正文、配对码或API密钥。需要长期留存时可导出。');const exportButton=el('button','导出诊断包');exportButton.onclick=async()=>{try{const r=await call('diagnostics');feedback(result,{level:r.saved?'success':'info',title:r.saved?'诊断包已保存':'已取消导出',message:r.saved?'可用这份文件对应客户端与服务器日志，方便复查。':''});}catch(e){feedback(result,friendlyError(e));}};diagnostics.append(exportButton);view.append(diagnostics);
 view.append(card('数据同步','经营数据和商品资料由服务器定期更新，页面每分钟读取已有结果。访问与转化报表等待平台生成，广告尚未接通。每项数据的实际时间以报表标注为准。'));
}
