const $=id=>document.getElementById(id);
const logLines=[];
const log=msg=>{const t=new Date().toLocaleTimeString();const line='> ['+t+'] '+msg;logLines.push(line);if(logLines.length>200)logLines.shift();if($('log'))$('log').textContent=logLines.join('\n');try{const el=$('log');el.scrollTop=el.scrollHeight}catch{}};
function clock(){if($('clock'))$('clock').textContent=new Date().toLocaleTimeString()}setInterval(clock,1000);clock();

function getBackendHttp(){
const u=window.BACKEND_URL||'';
if(u.startsWith('wss://'))return 'https://'+u.slice(6);
if(u.startsWith('ws://'))return 'http://'+u.slice(5);
return u||''}

function updateNodePanel(status){
const url=window.BACKEND_URL||'';
const host=url.replace(/wss?:\/\//,'').replace(/\/.*$/,'');
if($('backendUrl'))$('backendUrl').textContent=host||'UNKNOWN';
if($('nodeConnection'))$('nodeConnection').textContent='WebSocket: '+status;
if(status==='CONNECTED'){
if($('bitcoinCore'))$('bitcoinCore').textContent='CONNECTED';
if($('bitcoinCore'))$('bitcoinCore').style.color='var(--green)';
}else{
if($('bitcoinCore'))$('bitcoinCore').textContent='DISCONNECTED';
if($('bitcoinCore'))$('bitcoinCore').style.color='var(--red)';
}}

function updateMinerStatusUI(text){
const el=$('minerStatus');if(!el)return;
el.textContent=text;
el.classList.remove('s-mining','s-ok','s-err','s-warn');
if(text==='MINING'||text==='BLOCK CANDIDATE')el.classList.add('s-mining');
else if(text==='BLOCK FOUND!'||text==='BLOCK ACCEPTED!')el.classList.add('s-ok');
else if(text==='STOPPED'||text==='IDLE')el.classList.add('s-warn');
else if(text.includes('ERROR')||text.includes('OFFLINE'))el.classList.add('s-err');
}

async function getJSON(url,opt){const r=await fetch(url,opt);let d={};try{d=await r.json()}catch{}if(!r.ok||d.ok===false)throw Error(d.error||`HTTP ${r.status}`);return d}

async function refresh(){
const base=getBackendHttp();
if(!base){log('BACKEND_URL NOT CONFIGURED');return}
try{const s=await getJSON(base+'/api/status');
$('led').classList.add('on');$('statusText').textContent='CONNECTED';
if($('network'))$('network').textContent=s.chain.toUpperCase();
if($('networkLabel'))$('networkLabel').textContent=s.chain.toUpperCase();
if($('bitcoinNetwork'))$('bitcoinNetwork').textContent=s.chain.toUpperCase();
$('blocks').textContent=s.blocks.toLocaleString();
$('difficulty').textContent=Number(s.difficulty).toLocaleString(undefined,{maximumFractionDigits:2});
$('hashrate').textContent=Number(s.networkhashps).toLocaleString(undefined,{maximumFractionDigits:0})+' H/s';
updateNodePanel('CONNECTED');
log('NODE OK // '+s.chain+' // HEIGHT '+s.blocks);return s}catch(e){
$('led').classList.remove('on');$('statusText').textContent='OFFLINE';
updateNodePanel('DISCONNECTED');
if($('network'))$('network').textContent='---';
if($('bitcoinNetwork'))$('bitcoinNetwork').textContent='UNKNOWN';
log('RPC ERROR // '+e.message);return null}}

let ws=null,minerId=null,workers=[],running=false,jobHeight=0,exhausted=0,total=0,lastRate=performance.now(),hashes=0,myShares=0,rejectedCount=0;
let shareTarget=null,blockTarget=null,currentJob=null;

function stopWorkers(){workers.forEach(w=>{try{w.postMessage({type:'stop'})}catch{};w.terminate()});workers=[];$('workerCount').textContent='0'}
function fmtRate(h){if(h>=1e6)return(h/1e6).toFixed(2)+' MH/s';if(h>=1e3)return(h/1e3).toFixed(2)+' KH/s';return Math.round(h)+' H/s'}
function setMiningRate(h){$('minerHashrate').textContent=fmtRate(h)}

function connectWS(){
const wsUrl=window.BACKEND_URL||'';
if(!wsUrl){log('BACKEND_URL NOT CONFIGURED');return}
try{ws=new WebSocket(wsUrl+'/ws')}catch(e){log('WS CONNECT FAILED: '+e.message);return}
ws.onopen=()=>{
log('WEBSOCKET CONNECTED');
updateNodePanel('CONNECTED');
const btcAddress=$('btcAddress')?.value.trim();

if(!btcAddress){
log('BTC ADDRESS REQUIRED');
updateMinerStatusUI('WALLET REQUIRED');
return;
}

try{
ws.send(JSON.stringify({
type:'register',
btcAddress:btcAddress
}));
log('REGISTERING MINER...');
}catch(e){
log('REGISTER FAILED: '+e.message);
}
};
ws.onmessage=e=>{
const msg=JSON.parse(e.data);
if(msg.type==='welcome'){minerId=msg.minerId;log('MINER ID: '+minerId)}
else if(msg.type==='newJob'){
jobId=msg.jobId;jobHeight=msg.height;shareTarget=msg.shareTarget;blockTarget=msg.blockTarget;
currentJob={jobId:msg.jobId,height:msg.height,header:msg.header,midstate:msg.midstate,target:blockTarget,shareTarget:shareTarget,bodyHex:msg.bodyHex||''};
$('templateHeight').textContent=msg.height;
$('tHeight').textContent=msg.height;
if(msg.bits&&$('bits'))$('bits').textContent=msg.bits;
if(msg.prevHash&&$('prev'))$('prev').textContent=msg.prevHash;
if(running){stopWorkers();startWorkers()}
log('NEW JOB: '+msg.height)}
else if(msg.type==='shareAccepted'){myShares++;updatePoolUI()}
else if(msg.type==='shareRejected'){rejectedCount++;if($('rejectedShares'))$('rejectedShares').textContent=rejectedCount.toString();log('SHARE REJECTED: '+msg.reason)}
else if(msg.type==='poolStats'){updatePoolUI(msg)}
else if(msg.type==='blockFound'){log('BLOCK FOUND BY '+msg.minerId+' AT HEIGHT '+msg.height);updateMinerStatusUI('BLOCK FOUND!')}
else if(msg.type==='blockAccepted'){log('BLOCK ACCEPTED AT HEIGHT '+msg.height);updateMinerStatusUI('BLOCK ACCEPTED!')}
else if(msg.type==='blockRejected'){log('BLOCK REJECTED: '+msg.reason)}
else if(msg.type==='error'){log('SERVER ERROR: '+msg.error)}};
ws.onclose=()=>{log('WS DISCONNECTED // RECONNECTING...');updateNodePanel('DISCONNECTED');setTimeout(connectWS,5000)};
ws.onerror=()=>{}}

function updatePoolUI(stats){
if($('myShares'))$('myShares').textContent=myShares.toString();
if($('validBlocks'))$('validBlocks').textContent=stats?(stats.validBlocks||0).toString():'0';
if($('lastReward'))$('lastReward').textContent='0 BTC';
if($('minersOnline'))$('minersOnline').textContent=stats?(stats.minersOnline||0).toString():'0';
if($('poolHashrate'))$('poolHashrate').textContent=stats?fmtRate(stats.totalHashrate||0):'0 H/s'}

function startWorkers(){
if(!currentJob||!currentJob.header)return;
const n=Math.max(1,Math.min(navigator.hardwareConcurrency||2,16));
const U=0x100000000,span=Math.floor(U/n);
exhausted=0;total=0;hashes=0;lastRate=performance.now();
$('workerCount').textContent=String(n);
for(let i=0;i<n;i++){
const w=new Worker('/worker.js'),fromN=i*span,sp=i===n-1?U-fromN:span;
workers.push(w);
w.onmessage=e=>{const m=e.data||{};
if(m.type==='rate'){total+=m.count;hashes+=m.count;const now=performance.now();if(now-lastRate>=1000){setMiningRate(total*1000/(now-lastRate));total=0;lastRate=now;if(ws&&ws.readyState===1&&minerId){try{ws.send(JSON.stringify({type:'hashrate',hashes:hashes}));hashes=0}catch{}}}}
else if(m.type==='share'){if(ws&&ws.readyState===1){try{ws.send(JSON.stringify({type:'share',minerId,jobId:m.jobId,nonce:m.nonce,hashHex:m.hash}))}catch{}}}
else if(m.type==='nonce'){if(!running)return;updateMinerStatusUI('BLOCK CANDIDATE');log('BLOCK CANDIDATE NONCE '+m.nonce);if(ws&&ws.readyState===1){try{ws.send(JSON.stringify({type:'share',minerId,jobId,nonce:m.nonce,hashHex:m.hash}))}catch{}}}};
w.postMessage({type:'start',job:currentJob,from:fromN,span:sp})}
log('MINING // '+n+' WORKERS // HEIGHT '+jobHeight)}

async function startMining(){
if(running)return;
running=true;updateMinerStatusUI('CONNECTING...');
if(!ws||ws.readyState!==1){connectWS();await new Promise(r=>setTimeout(r,2000))}
if(!currentJob){log('WAITING FOR JOB FROM SERVER...');updateMinerStatusUI('WAITING FOR JOB');return}
updateMinerStatusUI('MINING');startWorkers()}

function stopMining(){running=false;stopWorkers();updateMinerStatusUI('STOPPED');setMiningRate(0);log('MINER STOPPED')}

$('start').onclick=startMining;
$('stop').onclick=stopMining;

(function initUI(){
const url=window.BACKEND_URL||'';
const host=url.replace(/wss?:\/\//,'').replace(/\/.*$/,'');
if($('backendUrl'))$('backendUrl').textContent=host||'UNKNOWN';
})();

refresh();connectWS();
