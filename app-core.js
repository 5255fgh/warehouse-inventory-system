'use strict';
const DB='warehouse_inventory_pro', STORE='state', KEY='current';
let data=[], byId=new Map(), byCode=new Map(), workbook=null, importRows=[], headers=[], activeReason='', actions=[], logs=[], saveTimer=null, searchTimer=null;
let scanActive=false, pasteCodeSet=null, pendingDupScan=null, printMode=false;
let state={filter:'all',moreFilter:'',sort:'index',keyword:'',round:'first',operator:'',warehouse:'',fileName:'',hasPrice:false,savedAt:''};
const reasons=['破损','丢失','漏入库','漏出库','账目错误','单位换算','待复核'];
const $=id=>document.getElementById(id);
const els={file:$('file'),restore:$('restore'),tbody:$('tbody'),cards:$('cards'),status:$('status'),scanner:$('scanner'),scanmsg:$('scanmsg')};
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
function norm(v){return String(v??'').trim().toLowerCase().replace(/\s+/g,'').replace(/[（）()【】\[\]_-]/g,'')}
function codeNorm(v){return String(v??'').trim().replace(/[\r\n\t\s]+/g,'')}
function num(v){if(v===null||v===undefined||v==='')return{ok:false,v:0};const n=Number(String(v).replace(/,/g,'').trim());return{ok:Number.isFinite(n),v:Number.isFinite(n)?n:0}}
function round(v,d=6){const f=10**d;return Math.round((v+Number.EPSILON)*f)/f}
function money(v){return Number(v||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}
function qty(v){return Number.isInteger(v)?String(v):Number(v).toLocaleString('zh-CN',{maximumFractionDigits:6})}
function now(){return new Date().toLocaleString('zh-CN')}
function safeName(v){return String(v||'').trim().replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,'_')}
function setStatus(t,c=''){els.status.textContent=t;els.status.className='status '+c}
function setScan(t,c=''){els.scanmsg.textContent=t;els.scanmsg.className='scanmsg '+c}
function setSave(mode,text=''){const d=$('saveDot'),t=$('saveText');d.className='save-dot '+mode;t.textContent=text||({saving:'保存中',saved:'已保存',failed:'保存失败'}[mode]||'未保存')}
function flashScanner(ok){els.scanner.classList.remove('scan-ok','scan-fail');void els.scanner.offsetWidth;els.scanner.classList.add(ok?'scan-ok':'scan-fail');setTimeout(()=>els.scanner.classList.remove('scan-ok','scan-fail'),550)}
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function dbSet(v){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(v,KEY);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function dbGet(){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).get(KEY);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function dbDel(){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(KEY);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
function rebuild(){byId=new Map(data.map(x=>[x.id,x]));byCode=new Map();for(const x of data){const c=codeNorm(x.code);if(!c)continue;if(!byCode.has(c))byCode.set(c,[]);byCode.get(c).push(x)}}
function diff(x){const final=x.reviewQty!==''?num(x.reviewQty):num(x.firstQty);if(!final.ok)return{entered:false,valid:true,final:null,dq:null,da:null};if(final.v<0)return{entered:true,valid:false,final:null,dq:null,da:null};const dq=round(final.v-x.sysQty);return{entered:true,valid:true,final:final.v,dq,da:state.hasPrice?round(dq*x.price,2):null}}
function logChange(item,field,oldVal,newVal,label=''){actions.push({type:'single',id:item.id,field,oldVal,newVal});if(actions.length>100)actions.shift();logs.unshift({time:now(),code:item.code,name:item.name,field:label||field,oldVal,newVal});if(logs.length>500)logs.pop();$('undo').disabled=!actions.length}
function logBatch(changes,label){actions.push({type:'batch',changes});logs.unshift({time:now(),code:'批量操作',name:label,field:'批量',oldVal:'',newVal:`影响 ${changes.length} 条`});$('undo').disabled=!actions.length}
function scheduleSave(){clearTimeout(saveTimer);setSave('saving');saveTimer=setTimeout(saveAll,250)}
async function saveAll(){try{state.savedAt=new Date().toISOString();await dbSet({version:4,data,state,logs});setSave('saved',new Date().toLocaleTimeString('zh-CN'));setTimeout(()=>setSave('', '已自动保存'),800)}catch(e){console.error(e);setSave('failed','保存失败');setStatus('自动保存失败，请导出进度备份。','err')}}
function enable(v){['backup','historyBtn','exportDiff','exportAll','printBtn','clear','search','filter','moreFilter','sort','operator','warehouse','round','scanMode','scanDirection','scanner','focusScan','batchConfirm','clearSearch','pasteCodesBtn'].forEach(id=>$(id).disabled=!v)}
function stats(){let done=0,plus=0,minus=0,zero=0,amount=0;for(const x of data){const d=diff(x);if(!d.entered||!d.valid)continue;done++;if(d.dq>0)plus++;else if(d.dq<0)minus++;else zero++;if(state.hasPrice)amount+=d.da}const total=data.length,todo=total-done,rate=total?Math.round(done/total*100):0;$('sTotal').textContent=total;$('sDone').textContent=done;$('sTodo').textContent=todo;$('sRate').textContent=rate+'%';$('sPlus').textContent=plus;$('sMinus').textContent=minus;$('sZero').textContent=zero;$('sAmount').textContent=state.hasPrice?money(amount):'未提供单价';$('stats').style.display=total?'grid':'none';$('progressWrap').style.display=total?'block':'none';$('progress').style.width=rate+'%'}
function baseList(){let a=[...data],kw=state.keyword.toLowerCase();if(kw)a=a.filter(x=>[x.code,x.name,x.location,x.batch].some(v=>String(v).toLowerCase().includes(kw)));if(pasteCodeSet)a=a.filter(x=>pasteCodeSet.has(codeNorm(x.code)));a=a.filter(x=>{const d=diff(x);switch(state.filter){case'todo':return!d.entered;case'done':return d.entered&&d.valid;case'diff':return d.entered&&d.valid&&d.dq!==0;case'plus':return d.entered&&d.valid&&d.dq>0;case'minus':return d.entered&&d.valid&&d.dq<0;case'zero':return d.entered&&d.valid&&d.dq===0;default:return true}});if(state.moreFilter==='reason')a=a.filter(x=>!!x.reason);if(state.moreFilter==='noprice')a=a.filter(x=>!x.price);return a}
function list(){let a=baseList();const s=state.sort;if(s==='code')a.sort((a,b)=>a.code.localeCompare(b.code,'zh-CN',{numeric:true}));if(s==='name')a.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));if(s==='sysDesc')a.sort((a,b)=>b.sysQty-a.sysQty);if(s==='diffAbs')a.sort((a,b)=>Math.abs(diff(b).dq||0)-Math.abs(diff(a).dq||0));if(s==='amountAbs')a.sort((a,b)=>Math.abs(diff(b).da||0)-Math.abs(diff(a).da||0));return a}
function printList(){return data.filter(x=>{const d=diff(x);return !d.entered||(d.valid&&d.dq!==0)})}
function reasonInput(x){return `<input class="reason" data-id="${x.id}" value="${esc(x.reason)}" placeholder="差异原因">`}
function rowHtml(x){const d=diff(x),cl=d.entered&&d.valid&&d.dq>0?'row-plus':d.entered&&d.valid&&d.dq<0?'row-minus':'',dc=d.dq>0?'pos':d.dq<0?'neg':'';return `<tr class="${cl}" data-id="${x.id}">
<td class="sticky1">${esc(x.code)}</td><td class="sticky2">${esc(x.name)}</td><td>${esc(x.location)}</td><td>${esc(x.batch)}</td><td>${esc(x.unit)}</td>
<td>${qty(x.sysQty)}</td><td>${state.hasPrice?money(x.price):'-'}</td>
<td><input type="number" min="0" step="any" class="q first ${d.valid?'':'invalid'}" data-id="${x.id}" value="${esc(x.firstQty)}"></td>
<td><input type="number" min="0" step="any" class="q review ${d.valid?'':'invalid'}" data-id="${x.id}" value="${esc(x.reviewQty)}"></td>
<td>${d.entered&&d.valid?qty(d.final):'-'}</td><td><span class="${dc}">${d.entered&&d.valid?(d.dq>0?'+':'')+qty(d.dq):'-'}</span></td><td><span class="${dc}">${state.hasPrice&&d.entered&&d.valid?(d.da>0?'+':'')+money(d.da):'-'}</span></td><td>${reasonInput(x)}</td></tr>`}
function cardHtml(x){const d=diff(x),cl=d.entered&&d.valid&&d.dq>0?'row-plus':d.entered&&d.valid&&d.dq<0?'row-minus':'';return `<div class="mcard ${cl}" data-id="${x.id}">
<div class="mline"><label>编码</label><b>${esc(x.code)}</b></div><div class="mline"><label>名称</label><span>${esc(x.name)}</span></div>
<div class="mline"><label>库位/批次</label><span>${esc(x.location)} ${esc(x.batch)}</span></div><div class="mline"><label>系统数量</label><span>${qty(x.sysQty)}</span></div>
<div class="mline"><label>初盘数量</label><input type="number" min="0" step="any" class="q first" data-id="${x.id}" value="${esc(x.firstQty)}"></div>
<div class="mline"><label>复盘数量</label><input type="number" min="0" step="any" class="q review" data-id="${x.id}" value="${esc(x.reviewQty)}"></div>
<div class="mline"><label>最终/差异</label><span>${d.entered&&d.valid?qty(d.final)+' / '+(d.dq>0?'+':'')+qty(d.dq):'-'}</span></div>
<div class="mline"><label>差异原因</label>${reasonInput(x)}</div></div>`}
function render(){const a=printMode?printList():list();if(!a.length){const initial=!data.length;els.tbody.innerHTML=`<tr><td colspan="13"><div class="emptybox">${initial?'尚未导入库存数据':'当前搜索与过滤条件下没有匹配商品'}<br><button class="outline empty-demo">${initial?'加载演示数据':'清除搜索和过滤'}</button></div></td></tr>`;els.cards.innerHTML=`<div class="emptybox">${initial?'尚未导入库存数据':'当前没有匹配商品'}<br><button class="outline empty-demo">${initial?'加载演示数据':'清除搜索和过滤'}</button></div>`}else{els.tbody.innerHTML=a.map(rowHtml).join('');els.cards.innerHTML=a.map(cardHtml).join('')}stats();$('matchTip').textContent=data.length&&!printMode?`当前匹配 ${a.length} 条${state.keyword?`，搜索“${state.keyword}”`:''}`:''}
function clearFilters(){state.keyword='';state.filter='all';state.moreFilter='';pasteCodeSet=null;$('search').value='';$('filter').value='all';$('moreFilter').value='';render()}
