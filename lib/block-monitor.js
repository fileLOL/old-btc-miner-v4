const{getDb}=require('./db');
const{applyRewards}=require('./reward-engine');
const AuditLog=require('./audit');
class BlockMonitor{
constructor(config,btcCliFn){
this.config=config;
this.btcCli=btcCliFn;
this.interval=null;
this.running=false}
start(){
if(this.interval)return;
console.log('[BlockMonitor] Starting block monitor (interval:',this.config.BLOCK_MONITOR_MS+'ms)');
this.checkAll();
this.interval=setInterval(()=>this.checkAll(),this.config.BLOCK_MONITOR_MS)}
stop(){
if(this.interval){
clearInterval(this.interval);
this.interval=null}
console.log('[BlockMonitor] Stopped')}
async checkAll(){
if(this.running)return;
this.running=true;
try{
const db=getDb();
const pendingBlocks=db.prepare("SELECT * FROM blocks WHERE status IN ('submitted','confirmed')").all();
for(const block of pendingBlocks){
await this.checkBlock(block)}}
catch(e){console.error('[BlockMonitor] Error:',e.message)}
finally{this.running=false}}
async checkBlock(block){
const db=getDb();
try{
if(!block.block_hash){
console.log('[BlockMonitor] Block',block.id,'has no hash, cannot monitor');
return}
const result=await this.btcCli(['getblock',block.block_hash]);
const info=JSON.parse(result);
const confirmations=info.confirmations||0;
if(confirmations<0){
console.log('[BlockMonitor] Block',block.id,'at height',block.height,'is orphaned (negative confirmations)');
db.prepare("UPDATE blocks SET status='orphaned' WHERE id=?").run(block.id);
return}
if(confirmations>=1&&block.status==='submitted'){
console.log('[BlockMonitor] Block',block.id,'at height',block.height,'confirmed (',confirmations,'confirmations)');
db.prepare("UPDATE blocks SET status='confirmed' WHERE id=?").run(block.id);
block.status='confirmed'}
if(confirmations>=this.config.COINBASE_MATURITY&&block.status==='confirmed'){
console.log('[BlockMonitor] Block',block.id,'at height',block.height,'mature (',confirmations,'confirmations). Distributing rewards...');
const rewardsResult=applyRewards(block.id,this.config.PPLNS_WINDOW_SIZE,this.config.POOL_FEE_PERCENT);
for(const reward of rewardsResult.rewards){
AuditLog.logBlockReward(reward.account_id,block.id,block.height,reward.reward_sat)}
if(rewardsResult.poolFee>0){
AuditLog.logPoolFee(block.id,rewardsResult.poolFee)}
console.log('[BlockMonitor] Distributed',rewardsResult.distributable,'sat to',rewardsResult.rewards.length,'accounts');
db.prepare("UPDATE blocks SET status='mature' WHERE id=?").run(block.id);
return}
if(confirmations===0&&block.status==='submitted'){
const chainInfo=await this.btcCli(['getblockchaininfo']);
const chain=JSON.parse(chainInfo);
const blocksSince=chain.blocks-block.height;
if(blocksSince>this.config.COINBASE_MATURITY){
console.log('[BlockMonitor] Block',block.id,'at height',block.height,'likely orphaned (',blocksSince,'blocks deep, 0 confirmations)');
db.prepare("UPDATE blocks SET status='orphaned' WHERE id=?").run(block.id)}}}
catch(e){
if(e.message&&e.message.includes('Block not found')){
console.log('[BlockMonitor] Block',block.id,'at height',block.height,'not found in chain, marking orphaned');
db.prepare("UPDATE blocks SET status='orphaned' WHERE id=?").run(block.id)}
else{console.error('[BlockMonitor] Error checking block',block.id,':',e.message)}}}}
module.exports=BlockMonitor;
