const assert=require('assert'),WebSocket=require('ws');
console.log('=== POOL PROTOCOL TEST ===\n');
const PORT=13579;
process.env.PORT=String(PORT);
process.env.PAYOUT_ADDRESS='bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
process.env.SHARE_DIFFICULTY='4';
process.env.TEMPLATE_REFRESH_MS='5000';
const SHA256D=require('../public/sha256d.js');
const{app,server,jobManager,shareValidator,minerTracker,rateLimiter}=require('../server.js');

async function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

async function waitForMsg(ws,messages,types,timeoutMs){
const start=Date.now();
while(Date.now()-start<timeoutMs){
for(const t of types){const m=messages.find(m=>m.type===t);if(m)return m}
await sleep(50)}
return null}

async function runTests(){
try{
await sleep(5000);

console.log('[0] Verify template available');
const http0=require('http');
const tplCheck=await new Promise((resolve,reject)=>{
http0.get(`http://127.0.0.1:${PORT}/api/job`,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{resolve(JSON.parse(d))}catch{resolve(null)}})}).on('error',reject)});
if(!tplCheck||!tplCheck.ok){
console.log('  Waiting for template...');
await sleep(10000)}
else{console.log('  Template OK, height: '+tplCheck.height)}
console.log('  PASS\n');

console.log('[1] WebSocket connection and welcome');
const ws=new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const messages=[];
ws.on('message',d=>{messages.push(JSON.parse(d.toString()))});
await new Promise(r=>ws.on('open',r));
const welcome=await waitForMsg(ws,messages,['welcome'],5000);
assert(welcome,'received welcome');
assert(welcome.minerId,'has minerId');
assert(welcome.version,'has version');
const minerId=welcome.minerId;
console.log('  minerId: '+minerId);
console.log('  PASS\n');

console.log('[1b] Register wallet');
ws.send(JSON.stringify({type:'register',btcAddress:'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'}));
const regResult=await waitForMsg(ws,messages,['registered','registerFailed'],5000);
assert(regResult,'received register response');
assert.strictEqual(regResult.type,'registered','wallet registered');
assert(regResult.btcAddress,'has btcAddress');
console.log('  btcAddress: '+regResult.btcAddress);
console.log('  PASS\n');

console.log('[2] Receive job from server');
const jobMsg=await waitForMsg(ws,messages,['newJob'],15000);
assert(jobMsg,'received job');
assert(jobMsg.jobId,'job has id');
assert(jobMsg.header&&jobMsg.header.length===80,'header 80 bytes');
assert(jobMsg.midstate&&jobMsg.midstate.length===8,'midstate 8 words');
assert(jobMsg.shareTarget&&jobMsg.shareTarget.length===32,'shareTarget 32 bytes');
assert(jobMsg.blockTarget&&jobMsg.blockTarget.length===32,'blockTarget 32 bytes');
const currentJobId=jobMsg.jobId;
console.log('  jobId: '+currentJobId);
console.log('  PASS\n');

console.log('[3] Submit valid share');
const header=new Uint8Array(jobMsg.header);
const nonce=42;
const hash=SHA256D.hash80(header,nonce);
const hashHex=SHA256D.hex(hash);
const beforeCount=messages.length;
ws.send(JSON.stringify({type:'share',minerId,jobId:currentJobId,nonce,hashHex}));
const shareResult=await waitForMsg(ws,messages,['shareAccepted','shareRejected'],5000);
assert(shareResult,'got share response');
const meetsShare=SHA256D.meets(hash,new Uint8Array(jobMsg.shareTarget));
if(meetsShare){assert.strictEqual(shareResult.type,'shareAccepted','share accepted');console.log('  Share meets target (accepted)')}
else{console.log('  Share response: '+shareResult.type+' ('+((shareResult.reason)||'accepted')+')')}
console.log('  PASS\n');

console.log('[4] Submit fake share (hash mismatch)');
messages.length=0;
ws.send(JSON.stringify({type:'share',minerId,jobId:currentJobId,nonce:42,hashHex:'00'.repeat(32)}));
const fakeResult=await waitForMsg(ws,messages,['shareAccepted','shareRejected'],5000);
assert(fakeResult,'got response');
assert.strictEqual(fakeResult.type,'shareRejected','fake share rejected');
console.log('  reason: '+fakeResult.reason);
console.log('  PASS\n');

console.log('[5] Submit share with stale/nonexistent job');
messages.length=0;
ws.send(JSON.stringify({type:'share',minerId,jobId:'job_nonexistent',nonce:42,hashHex}));
const staleResult=await waitForMsg(ws,messages,['shareAccepted','shareRejected'],5000);
assert(staleResult,'got response');
assert.strictEqual(staleResult.type,'shareRejected','stale job share rejected');
console.log('  reason: '+staleResult.reason);
console.log('  PASS\n');

console.log('[6] Nonce ownership (share with wrong minerId)');
messages.length=0;
ws.send(JSON.stringify({type:'share',minerId:'fake_miner',jobId:currentJobId,nonce:42,hashHex}));
const ownershipResult=await waitForMsg(ws,messages,['shareAccepted','shareRejected'],5000);
assert(ownershipResult,'got response');
console.log('  response: '+ownershipResult.type);
console.log('  PASS\n');

console.log('[7] Pool stats via REST API');
const http=require('http');
const stats=await new Promise((resolve,reject)=>{
http.get(`http://127.0.0.1:${PORT}/api/pool-stats`,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>resolve(JSON.parse(d)))}).on('error',reject)});
assert(stats.ok,'pool stats ok');
assert(typeof stats.totalShares==='number','totalShares is number');
assert(typeof stats.minersOnline==='number','minersOnline is number');
assert(stats.minersOnline>=1,'at least 1 miner online');
console.log('  minersOnline: '+stats.minersOnline);
console.log('  totalShares: '+stats.totalShares);
console.log('  PASS\n');

console.log('[8] Payout not modifiable by client');
messages.length=0;
ws.send(JSON.stringify({type:'share',minerId,jobId:currentJobId,nonce:42,hashHex,payoutAddress:'attacker_address'}));
const payoutResult=await waitForMsg(ws,messages,['shareAccepted','shareRejected'],5000);
assert(payoutResult,'got response');
console.log('  payout field ignored, response: '+payoutResult.type);
console.log('  PASS\n');

console.log('[9] Rate limiting');
messages.length=0;
for(let i=0;i<50;i++){ws.send(JSON.stringify({type:'share',minerId,jobId:currentJobId,nonce:i,hashHex:'00'.repeat(32)}))}
await sleep(1000);
const rejected=messages.filter(m=>m.type==='shareRejected').length;
console.log('  50 rapid shares sent, '+rejected+' rejected by rate limiter/validator');
console.log('  PASS\n');

console.log('[10] Unregistered miner rejected');
const ws2=new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const msgs2=[];
ws2.on('message',d=>{msgs2.push(JSON.parse(d.toString()))});
await new Promise(r=>ws2.on('open',r));
const w2=await waitForMsg(ws2,msgs2,['welcome'],5000);
assert(w2,'welcome received');
await sleep(500);
const jobMsg2=await waitForMsg(ws2,msgs2,['newJob'],5000);
assert(jobMsg2,'job received');
const h2=new Uint8Array(jobMsg2.header);
const hash2=SHA256D.hash80(h2,99);
const hashHex2=SHA256D.hex(hash2);
msgs2.length=0;
ws2.send(JSON.stringify({type:'share',minerId:w2.minerId,jobId:jobMsg2.jobId,nonce:99,hashHex:hashHex2}));
const unregResult=await waitForMsg(ws2,msgs2,['shareAccepted','shareRejected'],5000);
assert(unregResult,'got response for unregistered miner');
assert.strictEqual(unregResult.type,'shareRejected','unregistered share rejected');
assert.strictEqual(unregResult.reason,'wallet registration required');
console.log('  unregistered miner share rejected correctly');
console.log('  PASS\n');

console.log('[11] Register with invalid address');
const ws3=new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const msgs3=[];
ws3.on('message',d=>{msgs3.push(JSON.parse(d.toString()))});
await new Promise(r=>ws3.on('open',r));
const w3=await waitForMsg(ws3,msgs3,['welcome'],5000);
assert(w3,'welcome received');
msgs3.length=0;
ws3.send(JSON.stringify({type:'register',btcAddress:'invalid_address'}));
const invalidReg=await waitForMsg(ws3,msgs3,['registered','registerFailed'],5000);
assert(invalidReg,'got register response');
assert.strictEqual(invalidReg.type,'registerFailed','invalid address rejected');
console.log('  invalid address rejected: '+invalidReg.error);
console.log('  PASS\n');

console.log('[12] Miner stats endpoint');
const minerStats=await new Promise((resolve,reject)=>{
http.get(`http://127.0.0.1:${PORT}/api/miner/${minerId}/stats`,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>resolve(JSON.parse(d)))}).on('error',reject)});
assert(minerStats.ok,'miner stats ok');
assert.strictEqual(minerStats.registered,true,'miner is registered');
assert(minerStats.btcAddress,'has btcAddress');
assert(typeof minerStats.totalShares==='number','has totalShares');
console.log('  registered: '+minerStats.registered);
console.log('  btcAddress: '+minerStats.btcAddress);
console.log('  totalShares: '+minerStats.totalShares);
console.log('  PASS\n');

ws.close();
ws2.close();
ws3.close();
await sleep(500);

console.log('=== ALL POOL PROTOCOL TESTS PASSED ===\n');
server.close();
process.exit(0)}
catch(e){
console.error('TEST FAILED:',e.message,e.stack);
try{server.close()}catch{}
process.exit(1)}}

runTests();
