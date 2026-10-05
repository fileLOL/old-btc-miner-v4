class MinerTracker{
constructor(config){
this.config=config;
this.miners=new Map();
this.poolStats={totalShares:0,totalHashrate:0,validBlocks:0,lastBlockHeight:null,lastBlockTime:null};
this.accountManager=null;
this.cleanupInterval=setInterval(()=>this.cleanup(),30000)}
setAccountManager(am){this.accountManager=am}
register(minerId,ws,accountId){
if(this.miners.size>=this.config.MAX_MINERS)return false;
const now=Date.now();
const miner={minerId,connectedAt:now,lastSeen:now,shares:0,hashesReported:0,hashrate:0,ws,staleShares:0,invalidShares:0,accountId:accountId||null,registered:!!accountId};
this.miners.set(minerId,miner);
if(accountId&&this.accountManager){
try{this.accountManager.createSession(minerId,accountId,null)}catch(e){console.error('Session persist error:',e.message)}}
return true}
linkAccount(minerId,accountId,userAgent){
const m=this.miners.get(minerId);
if(!m)return false;
m.accountId=accountId;
m.registered=true;
if(this.accountManager){
try{this.accountManager.createSession(minerId,accountId,userAgent)}catch(e){console.error('Session persist error:',e.message)}}
return true}
unregister(minerId){
const m=this.miners.get(minerId);
if(m&&m.accountId&&this.accountManager){
try{this.accountManager.deleteSession(minerId)}catch(e){}}
this.miners.delete(minerId)}
updateSeen(minerId){
const m=this.miners.get(minerId);
if(!m)return;
m.lastSeen=Date.now();
if(m.accountId&&this.accountManager){
try{this.accountManager.updateSessionLastSeen(minerId)}catch(e){}}}
addShare(minerId,shareData){
const m=this.miners.get(minerId);
if(m){m.shares++;m.lastSeen=Date.now();this.poolStats.totalShares++;
if(m.accountId&&this.accountManager&&shareData){
try{this.accountManager.insertShare(m.accountId,minerId,shareData.jobId,shareData.nonce,shareData.hashHex,shareData.difficulty||1)}catch(e){console.error('Share persist error:',e.message)}}}}
addStaleShare(minerId){const m=this.miners.get(minerId);if(m)m.staleShares++}
addInvalidShare(minerId){const m=this.miners.get(minerId);if(m)m.invalidShares++}
updateHashrate(minerId,hashes){
const m=this.miners.get(minerId);
if(!m)return;
m.hashesReported+=hashes;
const elapsed=(Date.now()-m.connectedAt)/1000;
if(elapsed>0)m.hashrate=Math.round(m.hashesReported/elapsed)}
recordBlock(height,accountId,sessionId,coinbaseValue){
this.poolStats.validBlocks++;
this.poolStats.lastBlockHeight=height;
this.poolStats.lastBlockTime=Date.now();
if(accountId&&this.accountManager){
try{this.accountManager.insertBlock(accountId,sessionId||'',height,coinbaseValue||0)}catch(e){console.error('Block persist error:',e.message)}}}
recalcPoolHashrate(){
let total=0;
for(const[,m]of this.miners){total+=m.hashrate}
this.poolStats.totalHashrate=total}
cleanup(){
const now=Date.now();
const timeout=120000;
for(const[id,m]of this.miners){
if(now-m.lastSeen>timeout){
try{if(m.ws&&m.ws.readyState===1)m.ws.close()}catch{}
if(m.accountId&&this.accountManager){try{this.accountManager.deleteSession(id)}catch(e){}}
this.miners.delete(id)}}
this.recalcPoolHashrate()}
getMiner(minerId){return this.miners.get(minerId)||null}
getMinerCount(){return this.miners.size}
getPoolStats(){
this.recalcPoolHashrate();
return{...this.poolStats,minersOnline:this.miners.size}}
getMinerStats(minerId){
const m=this.miners.get(minerId);
if(!m)return null;
return{minerId:m.minerId,connectedAt:m.connectedAt,shares:m.shares,hashrate:m.hashrate,lastSeen:m.lastSeen,staleShares:m.staleShares,invalidShares:m.invalidShares,accountId:m.accountId,registered:m.registered}}
getAllMinerStats(){
const stats=[];
for(const[id]of this.miners){stats.push(this.getMinerStats(id))}
return stats}
getMinerAccount(minerId){
const m=this.miners.get(minerId);
return m?m.accountId:null}
destroy(){clearInterval(this.cleanupInterval)}
}
module.exports=MinerTracker;
