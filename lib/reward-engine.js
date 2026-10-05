const{getDb}=require('./db');
function calculatePPLNS(blockId,windowSize,poolFeePercent){
const db=getDb();
const block=db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId);
if(!block)throw new Error('Block not found: '+blockId);
if(block.status!=='confirmed')throw new Error('Block not confirmed: '+block.status);
const coinbaseValue=BigInt(block.coinbase_value);
if(coinbaseValue<=0n)throw new Error('Invalid coinbase value');
const feePercent=BigInt(Math.round(poolFeePercent*100));
const poolFee=coinbaseValue*feePercent/10000n;
const distributable=coinbaseValue-poolFee;
const blockTime=block.created_at;
const shares=db.prepare(
'SELECT account_id, difficulty FROM shares WHERE created_at <= ? ORDER BY created_at DESC LIMIT ?'
).all(blockTime,windowSize);
if(shares.length===0)return{blockId,height:block.height,coinbaseValue:Number(coinbaseValue),poolFee:Number(poolFee),distributable:0,rewards:[],totalShares:0};
let totalDifficulty=0n;
const accountDiff=new Map();
for(const s of shares){
const diff=BigInt(Math.round(s.difficulty*1e8));
totalDifficulty+=diff;
const prev=accountDiff.get(s.account_id)||0n;
accountDiff.set(s.account_id,prev+diff)}
const rewards=[];
for(const[accountId,diff]of accountDiff){
const reward=distributable*diff/totalDifficulty;
if(reward>0n){
rewards.push({account_id:accountId,reward_sat:Number(reward),share_difficulty:Number(diff),total_difficulty:Number(totalDifficulty)})}}
return{blockId,height:block.height,coinbaseValue:Number(coinbaseValue),poolFee:Number(poolFee),poolFeePercent,distributable:Number(distributable),rewards,totalShares:shares.length,totalDifficulty:Number(totalDifficulty)}}
function applyRewards(blockId,windowSize,poolFeePercent){
const db=getDb();
const result=calculatePPLNS(blockId,windowSize,poolFeePercent);
if(result.rewards.length===0)return result;
const now=Date.now();
const updateBalance=db.prepare(
'UPDATE balances SET pending_sat = pending_sat + ?, total_earned_sat = total_earned_sat + ?, updated_at = ? WHERE account_id = ?'
);
const tx=db.transaction(()=>{
for(const r of result.rewards){
updateBalance.run(r.reward_sat,r.reward_sat,now,r.account_id)}});
tx();
return result}
function getSharesInWindow(accountId,windowSize){
const db=getDb();
const now=Date.now();
const cutoff=now-(windowSize*30000);
const result=db.prepare(
'SELECT COUNT(*) as count, SUM(difficulty) as total_difficulty FROM shares WHERE account_id = ? AND created_at >= ?'
).get(accountId,cutoff);
return{count:result?result.count:0,totalDifficulty:result?result.total_difficulty:0}}
function getAccountStats(accountId){
const db=getDb();
const account=db.prepare('SELECT account_id, btc_address, created_at FROM accounts WHERE account_id = ?').get(accountId);
if(!account)return null;
const balance=db.prepare('SELECT * FROM balances WHERE account_id = ?').get(accountId);
const totalShares=db.prepare('SELECT COUNT(*) as count FROM shares WHERE account_id = ?').get(accountId);
const blocksFound=db.prepare("SELECT COUNT(*) as count FROM blocks WHERE account_id = ? AND status IN ('confirmed','mature')").get(accountId);
return{account_id:account.account_id,btc_address:account.btc_address,created_at:account.created_at,shares:totalShares?totalShares.count:0,blocks_found:blocksFound?blocksFound.count:0,balance:balance?{pending_sat:balance.pending_sat,confirmed_sat:balance.confirmed_sat,total_earned_sat:balance.total_earned_sat}:null}}
module.exports={calculatePPLNS,applyRewards,getSharesInWindow,getAccountStats};
