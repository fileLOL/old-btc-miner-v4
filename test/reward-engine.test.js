const assert=require('assert'),path=require('path'),fs=require('fs');
const{getDb,closeDb,resetDb}=require('../lib/db');
const am=require('../lib/account-manager');
const re=require('../lib/reward-engine');

console.log('=== REWARD ENGINE TEST ===\n');

const TEST_DB=path.join(__dirname,'..','data','test_reward.db');
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);

const db=getDb(TEST_DB);

console.log('[1] Create accounts');
const acc1=am.getOrCreateAccount('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
const acc2=am.getOrCreateAccount('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
console.log('  account1:',acc1.account_id);
console.log('  account2:',acc2.account_id);
console.log('  PASS\n');

console.log('[2] Insert shares for PPLNS window');
for(let i=0;i<10;i++){
am.insertShare(acc1.account_id,'session1','job1',i,'aa'.repeat(32),16)}
for(let i=0;i<5;i++){
am.insertShare(acc2.account_id,'session2','job1',i+100,'bb'.repeat(32),16)}
console.log('  acc1: 10 shares, acc2: 5 shares');
console.log('  PASS\n');

console.log('[3] Insert a block');
const blockResult=am.insertBlock(acc1.account_id,'session1',800000,312500000,'000000000000000000021ef0test');
console.log('  block id:',blockResult.blockId);
console.log('  PASS\n');

console.log('[4] Calculate PPLNS (block not confirmed yet)');
try{
re.calculatePPLNS(blockResult.blockId,10000,2);
assert.fail('Should throw error for non-confirmed block')}
catch(e){
assert(e.message.includes('not confirmed'),'correct error');
console.log('  PASS\n')}

console.log('[5] Mark block as confirmed');
db.prepare("UPDATE blocks SET status='confirmed' WHERE id=?").run(blockResult.blockId);
console.log('  PASS\n');

console.log('[6] Calculate PPLNS distribution');
const result=re.calculatePPLNS(blockResult.blockId,10000,2);
console.log('  coinbase:',result.coinbaseValue,'sat');
console.log('  pool fee:',result.poolFee,'sat');
console.log('  distributable:',result.distributable,'sat');
console.log('  total shares:',result.totalShares);
console.log('  rewards:',result.rewards.length,'accounts');
assert.strictEqual(result.coinbaseValue,312500000,'coinbase correct');
assert.strictEqual(result.poolFee,6250000,'2% fee');
assert.strictEqual(result.distributable,306250000,'distributable');
assert.strictEqual(result.totalShares,15,'15 shares');
assert.strictEqual(result.rewards.length,2,'2 accounts rewarded');
const acc1Reward=result.rewards.find(r=>r.account_id===acc1.account_id);
const acc2Reward=result.rewards.find(r=>r.account_id===acc2.account_id);
assert(acc1Reward,'acc1 has reward');
assert(acc2Reward,'acc2 has reward');
console.log('  acc1 reward:',acc1Reward.reward_sat,'sat (10/15 of distributable)');
console.log('  acc2 reward:',acc2Reward.reward_sat,'sat (5/15 of distributable)');
const expectedAcc1=Math.floor(306250000*10/15);
const expectedAcc2=Math.floor(306250000*5/15);
assert.strictEqual(acc1Reward.reward_sat,expectedAcc1,'acc1 reward correct');
assert.strictEqual(acc2Reward.reward_sat,expectedAcc2,'acc2 reward correct');
console.log('  PASS\n');

console.log('[7] Apply rewards to balances');
const applyResult=re.applyRewards(blockResult.blockId,10000,2);
console.log('  applied:',applyResult.rewards.length,'rewards');
const bal1=am.getBalance(acc1.account_id);
const bal2=am.getBalance(acc2.account_id);
console.log('  acc1 pending:',bal1.pending_sat,'sat');
console.log('  acc2 pending:',bal2.pending_sat,'sat');
assert.strictEqual(bal1.pending_sat,expectedAcc1,'acc1 pending correct');
assert.strictEqual(bal2.pending_sat,expectedAcc2,'acc2 pending correct');
assert.strictEqual(bal1.total_earned_sat,expectedAcc1,'acc1 total earned');
console.log('  PASS\n');

console.log('[8] Get shares in window');
const window1=re.getSharesInWindow(acc1.account_id,10000);
const window2=re.getSharesInWindow(acc2.account_id,10000);
console.log('  acc1 window shares:',window1.count);
console.log('  acc2 window shares:',window2.count);
assert.strictEqual(window1.count,10,'acc1 10 shares in window');
assert.strictEqual(window2.count,5,'acc2 5 shares in window');
console.log('  PASS\n');

console.log('[9] Get account stats');
const stats1=re.getAccountStats(acc1.account_id);
const stats2=re.getAccountStats(acc2.account_id);
assert(stats1,'stats1 exists');
assert(stats2,'stats2 exists');
assert.strictEqual(stats1.shares,10,'acc1 10 total shares');
assert.strictEqual(stats2.shares,5,'acc2 5 total shares');
assert.strictEqual(stats1.blocks_found,1,'acc1 1 confirmed block');
console.log('  acc1:',stats1.shares,'shares,',stats1.balance.pending_sat,'pending sat,',stats1.blocks_found,'blocks');
console.log('  acc2:',stats2.shares,'shares,',stats2.balance.pending_sat,'pending sat,',stats2.blocks_found,'blocks');
console.log('  PASS\n');

console.log('[10] PPLNS with zero shares');
const emptyBlock=am.insertBlock(acc1.account_id,'session1',800001,312500000);
db.prepare("UPDATE blocks SET status='confirmed', created_at=? WHERE id=?").run(Date.now()-999999999,emptyBlock.blockId);
const emptyResult=re.calculatePPLNS(emptyBlock.blockId,10000,2);
assert.strictEqual(emptyResult.totalShares,0,'no shares');
assert.strictEqual(emptyResult.rewards.length,0,'no rewards');
console.log('  PASS\n');

console.log('[11] Integer satoshis (no float)');
const testResult=re.calculatePPLNS(blockResult.blockId,10000,2);
for(const r of testResult.rewards){
assert(Number.isInteger(r.reward_sat),'reward is integer: '+r.reward_sat)}
console.log('  all rewards are integer satoshis');
console.log('  PASS\n');

closeDb();
resetDb();
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);

console.log('=== ALL REWARD ENGINE TESTS PASSED ===');
