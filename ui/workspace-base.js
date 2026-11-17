export const ws={context:undefined,DATA:undefined,view:'products',bucket:'active',query:'',onlyIssues:false,focus:null,page:0,reportType:'sales',reportSite:'ALL'};
const el=(t,text,cls)=>{
const n=document.createElement(t);
if(text!==undefined)n.textContent=text;
if(cls)n.className=cls;
return n;};
const $=s=>document.querySelector(s);
const names={DE:'德国',US:'美国',FR:'法国',GB:'英国',NL:'荷兰',BE:'比利时',PL:'波兰',SA:'沙特',IT:'意大利',ES:'西班牙',IE:'爱尔兰',CA:'加拿大',BR:'巴西',MX:'墨西哥',SE:'瑞典'};
const issueNames={'300403':'资料链接无法访问','99022':'商品计数信息待补齐','100476':'字段展示受限','18616':'合规资料待提交','8560':'商品识别资料待核对','90220':'必填属性缺失','18448':'属性内容待完善','100335':'尺寸资料需核对'};
const inventory=p=>p.available===0?'zero':typeof p.available==='number'&&p.available>0?'active':'unknown';
function rank(p){
const actions=(p.issues||[]).flatMap(x=>x.enforcements?.actions||[]).map(x=>x.action);
if(actions.some(x=>['LISTING_SUPPRESSED','SEARCH_SUPPRESSED'].includes(x)))return 0;
if(p.issues.some(x=>x.severity==='ERROR'))return 1;
if(p.available>0&&!p.status.includes('BUYABLE'))return 2;
if(p.issues.length)return 3;
if(p.available>0&&p.available<10)return 4;
return 5;}
const ordered=arr=>arr.slice().sort((a,b)=>rank(a)-rank(b)||b.issues.length-a.issues.length||a.sku.localeCompare(b.sku));
const problem=p=>rank(p)<=3;
const fmt=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2});
const money=n=>n==null?'暂缺':'$'+fmt(n);
const button=(text,fn,cls)=>{
const b=el('button',text,cls);
b.onclick=fn;
return b;};
function info(p){
const r=rank(p);
return r===0?['平台限制','error']:r===1?['优先处理','error']:r===2?['可售状态待核实','neutral']:r===3?['资料待完善','neutral']:r===4?['留意库存','neutral']:['正常',''];}
export {el,$,names,issueNames,inventory,rank,ordered,problem,fmt,money,button,info};
