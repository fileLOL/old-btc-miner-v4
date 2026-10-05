const assert=require('assert'),path=require('path'),fs=require('fs'),crypto=require('crypto');
const{getDb,closeDb,resetDb}=require('../lib/db');
const am=require('../lib/account-manager');
const re=require('../lib/reward-engine');
const BlockMonitor=require('../lib/block-monitor');

(async()=>{
console.log('=== END-TO-END TEST: WALLET -> SHARES -> BLOCK -> PPLNS -> BALANCE ===\n');

const TEST_DB=path.join(__dirname,'..','data','test_e2e.db');
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);
const db=getDb(TEST_DB);

const WALLET='BC1QD2FU79GKKN8JUJU67T066JHWPW6R4T3PLXSAMN';

console.log('[STEP 1] User registers wallet');
const account=am.getOrCreateAccount(WALLET);
console.log('  wallet:',WALLET);
console.log('  account_id:',account.account_id);
console.log('  btc_address:',account.btc_address);
console.log('  isNew:',account.isNew);
assert(account.account_id>0);
assert.strictEqual(account.btc_address,WALLET.toLowerCase());
console.log('  PASS\n');

console.log('[STEP 2] Verify initial balance is 0');
const bal0=am.getBalance(account.account_id);
assert.strictEqual(bal0.confirmed_sat,0);
assert.strictEqual(bal0.pending_sat,0);
assert.strictEqual(bal0.total_earned_sat,0);
console.log('  confirmed_sat: 0');
console.log('  pending_sat: 0');
console.log('  PASS\n');

console.log('[STEP 3] Simulate mining: insert 100 shares');
const now=Date.now();
for(let i=0;i<100;i++){
db.prepare('INSERT INTO shares (account_id, session_id, job_id, nonce, hash_hex, difficulty, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
account.account_id,'session_e2e','job_1',i,'aa'.repeat(32),268435456,now-(100-i)*1000)}
const shareCount=am.getShareCountByAccount(account.account_id);
assert.strictEqual(shareCount,100);
console.log('  inserted 100 shares with difficulty=268435456 each');
console.log('  total shares:',shareCount);
console.log('  PASS\n');

console.log('[STEP 4] Simulate a second miner (different wallet)');
const otherWallet='1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const otherAccount=am.getOrCreateAccount(otherWallet);
for(let i=0;i<25;i++){
db.prepare('INSERT INTO shares (account_id, session_id, job_id, nonce, hash_hex, difficulty, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
otherAccount.account_id,'session_other','job_1',i+200,'bb'.repeat(32),268435456,now-(25-i)*1000)}
console.log('  other miner:',otherAccount.btc_address);
console.log('  other shares:',25);
console.log('  total pool shares: 125');
console.log('  PASS\n');

console.log('[STEP 5] Simulate block found by our miner');
const COINBASE_VALUE=312500000;
const blockHash='00000000000000000002e2a6f1c9d8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1';
const blockResult=am.insertBlock(account.account_id,'session_e2e',970067,COINBASE_VALUE,blockHash);
console.log('  block_id:',blockResult.blockId);
console.log('  height: 970067');
console.log('  coinbase_value:',COINBASE_VALUE,'sat (',COINBASE_VALUE/1e8,'BTC)');
console.log('  block_hash:',blockHash);
console.log('  PASS\n');

console.log('[STEP 6] Simulate block confirmation via block monitor');
const mockCli=async(args)=>{
if(args[0]==='getblock')return JSON.stringify({hash:args[1],confirmations:101,height:970067});
if(args[0]==='getblockchaininfo')return JSON.stringify({blocks:970167});
throw new Error('Unknown')};
const config={BLOCK_MONITOR_MS:999999,COINBASE_MATURITY:100,PPLNS_WINDOW_SIZE:10000,POOL_FEE_PERCENT:2};
const monitor=new BlockMonitor(config,mockCli);
const blockRow=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult.blockId);
assert.strictEqual(blockRow.status,'submitted');
await monitor.checkBlock(blockRow);
const updated=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult.blockId);
console.log('  status:',updated.status);
assert.strictEqual(updated.status,'mature','block should be mature (101 confirmations)');
console.log('  PASS\n');

console.log('[STEP 7] Verify PPLNS distribution');
const myBalance=am.getBalance(account.account_id);
const otherBalance=am.getBalance(otherAccount.account_id);
console.log('  --- MY BALANCE (BC1QD2FU...) ---');
console.log('  pending_sat:',myBalance.pending_sat);
console.log('  confirmed_sat:',myBalance.confirmed_sat);
console.log('  total_earned_sat:',myBalance.total_earned_sat);
console.log('  pending_btc:',(myBalance.pending_sat/1e8).toFixed(8));
console.log('  --- OTHER BALANCE (1A1zP1...) ---');
console.log('  pending_sat:',otherBalance.pending_sat);
console.log('  total_earned_sat:',otherBalance.total_earned_sat);

const poolFee=Math.floor(COINBASE_VALUE*2/100);
const distributable=COINBASE_VALUE-poolFee;
const myExpected=Math.floor(distributable*100/125);
const otherExpected=Math.floor(distributable*25/125);
console.log('\n  --- VERIFICATION ---');
console.log('  pool fee (2%):',poolFee,'sat');
console.log('  distributable:',distributable,'sat');
console.log('  my share: 100/125 =',myExpected,'sat');
console.log('  other share: 25/125 =',otherExpected,'sat');
assert.strictEqual(myBalance.pending_sat,myExpected,'my pending correct');
assert.strictEqual(otherBalance.pending_sat,otherExpected,'other pending correct');
assert.strictEqual(myBalance.total_earned_sat,myExpected,'my total earned');
assert(Number.isInteger(myBalance.pending_sat),'no float BTC');
assert(Number.isInteger(otherBalance.pending_sat),'no float BTC');
console.log('  PASS\n');

console.log('[STEP 8] Verify no BTC were invented');
const totalDistributed=myBalance.total_earned_sat+otherBalance.total_earned_sat;
console.log('  coinbase:',COINBASE_VALUE,'sat');
console.log('  pool fee:',poolFee,'sat');
console.log('  total distributed:',totalDistributed,'sat');
assert(totalDistributed<=COINBASE_VALUE,'never distributed more than coinbase');
assert(totalDistributed+poolFee<=COINBASE_VALUE,'fee+distributed <= coinbase');
console.log('  no BTC invented. Fee kept by pool:',poolFee,'sat');
console.log('  PASS\n');

console.log('[STEP 9] Verify orphaned block generates NO reward');
const orphanBlock=am.insertBlock(otherAccount.account_id,'session_other',970068,COINBASE_VALUE,'orphan_hash');
db.prepare("UPDATE blocks SET status='orphaned' WHERE id=?").run(orphanBlock.blockId);
const otherBalanceAfter=am.getBalance(otherAccount.account_id);
assert.strictEqual(otherBalanceAfter.pending_sat,otherExpected,'balance unchanged after orphan');
console.log('  orphaned block at height 970068');
console.log('  other miner balance unchanged:',otherBalanceAfter.pending_sat,'sat');
console.log('  PASS\n');

console.log('[STEP 10] Verify account stats');
const stats=re.getAccountStats(account.account_id);
console.log('  account_id:',stats.account_id);
console.log('  btc_address:',stats.btc_address);
console.log('  shares:',stats.shares);
console.log('  blocks_found:',stats.blocks_found);
console.log('  pending_sat:',stats.balance.pending_sat);
console.log('  confirmed_sat:',stats.balance.confirmed_sat);
console.log('  total_earned_sat:',stats.balance.total_earned_sat);
assert.strictEqual(stats.shares,100);
assert.strictEqual(stats.blocks_found,1);
console.log('  PASS\n');

closeDb();
resetDb();
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);

console.log('========================================');
console.log('  END-TO-END TEST PASSED');
console.log('========================================');
console.log('');
console.log('  Wallet:       ',WALLET);
console.log('  Account ID:   ',account.account_id);
console.log('  Shares mined: 100');
console.log('  Block found:  height 970067');
console.log('  Coinbase:     ',COINBASE_VALUE,'sat (3.125 BTC)');
console.log('  Pool fee:     ',poolFee,'sat (',poolFee/1e8,'BTC)');
console.log('  My reward:    ',myExpected,'sat (',(myExpected/1e8).toFixed(8),'BTC)');
console.log('  Status:       BALANCE CREDITED');
})().catch(e=>{console.error('E2E TEST FAILED:',e.message,e.stack);process.exit(1)});
