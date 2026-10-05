const assert=require('assert'),path=require('path'),fs=require('fs');
const{getDb,closeDb,resetDb}=require('../lib/db');
const am=require('../lib/account-manager');
const{validateAddress}=require('../lib/address-validator');

console.log('=== ACCOUNT MANAGER TEST ===\n');

const TEST_DB=path.join(__dirname,'..','data','test_pool.db');
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);

const db=getDb(TEST_DB);

console.log('[1] DB schema created');
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name);
assert(tables.includes('accounts'),'accounts table');
assert(tables.includes('miner_sessions'),'miner_sessions table');
assert(tables.includes('shares'),'shares table');
assert(tables.includes('blocks'),'blocks table');
assert(tables.includes('balances'),'balances table');
assert(tables.includes('payouts'),'payouts table');
assert(tables.includes('pool_config'),'pool_config table');
console.log('  tables:',tables.join(', '));
console.log('  PASS\n');

console.log('[2] WAL mode active');
const jm=db.pragma('journal_mode',{simple:true});
assert.strictEqual(jm,'wal','WAL mode');
console.log('  PASS\n');

console.log('[3] Foreign keys enabled');
const fk=db.pragma('foreign_keys',{simple:true});
assert.strictEqual(fk,1,'FK enabled');
console.log('  PASS\n');

console.log('[4] getOrCreateAccount - new account');
const addr1='bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const acc1=am.getOrCreateAccount(addr1);
assert(acc1.account_id>0,'has account_id');
assert.strictEqual(acc1.btc_address,addr1);
assert.strictEqual(acc1.isNew,true,'is new');
console.log('  account_id:',acc1.account_id);
console.log('  PASS\n');

console.log('[5] getOrCreateAccount - same address returns same account');
const acc1b=am.getOrCreateAccount(addr1);
assert.strictEqual(acc1b.account_id,acc1.account_id,'same account_id');
assert.strictEqual(acc1b.isNew,false,'not new');
console.log('  PASS\n');

console.log('[6] getAccount by ID');
const fetched=am.getAccount(acc1.account_id);
assert(fetched,'account found');
assert.strictEqual(fetched.btc_address,addr1);
console.log('  PASS\n');

console.log('[7] getAccount with invalid ID');
const notFound=am.getAccount(99999);
assert.strictEqual(notFound,null);
console.log('  PASS\n');

console.log('[8] getAccountByAddress');
const byAddr=am.getAccountByAddress(addr1);
assert(byAddr,'found by address');
assert.strictEqual(byAddr.account_id,acc1.account_id);
console.log('  PASS\n');

console.log('[9] getAccountByAddress with non-existent');
const noAddr=am.getAccountByAddress('bc1qnonexistent');
assert.strictEqual(noAddr,null);
console.log('  PASS\n');

console.log('[10] Balance auto-created with zeros');
const bal=am.getBalance(acc1.account_id);
assert(bal,'balance exists');
assert.strictEqual(bal.confirmed_sat,0);
assert.strictEqual(bal.pending_sat,0);
assert.strictEqual(bal.total_earned_sat,0);
console.log('  PASS\n');

console.log('[11] Two different wallets = two different accounts');
const addr2='1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const acc2=am.getOrCreateAccount(addr2);
assert(acc2.account_id>0);
assert.notStrictEqual(acc2.account_id,acc1.account_id,'different accounts');
assert.strictEqual(acc2.isNew,true);
console.log('  PASS\n');

console.log('[12] Reject invalid wallet address');
let threw=false;
try{am.getOrCreateAccount('invalid_address')}catch(e){threw=true}
assert(threw,'invalid address throws');
console.log('  PASS\n');

console.log('[13] Reject testnet address');
let threw2=false;
try{am.getOrCreateAccount('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')}catch(e){threw2=true}
assert(threw2,'testnet address throws');
console.log('  PASS\n');

console.log('[14] Session management');
am.createSession('session_1',acc1.account_id,'test-agent');
const sess=am.getSession('session_1');
assert(sess,'session exists');
assert.strictEqual(sess.account_id,acc1.account_id);
assert.strictEqual(sess.user_agent,'test-agent');
console.log('  PASS\n');

console.log('[15] Update session last_seen');
const beforeLastSeen=sess.last_seen;
am.updateSessionLastSeen('session_1');
const updated=am.getSession('session_1');
assert(updated.last_seen>=beforeLastSeen,'last_seen updated');
console.log('  PASS\n');

console.log('[16] Persist share');
am.insertShare(acc1.account_id,'session_1','job_test_1',42,'aa'.repeat(32),16);
const shares=am.getSharesByAccount(acc1.account_id);
assert.strictEqual(shares.length,1,'1 share');
assert.strictEqual(shares[0].nonce,42);
assert.strictEqual(shares[0].job_id,'job_test_1');
assert.strictEqual(shares[0].hash_hex,'aa'.repeat(32));
assert.strictEqual(shares[0].difficulty,16);
console.log('  PASS\n');

console.log('[17] Share count');
const count=am.getShareCountByAccount(acc1.account_id);
assert.strictEqual(count,1);
console.log('  PASS\n');

console.log('[18] Multiple shares');
am.insertShare(acc1.account_id,'session_1','job_test_1',43,'bb'.repeat(32),16);
am.insertShare(acc1.account_id,'session_1','job_test_1',44,'cc'.repeat(32),16);
const count2=am.getShareCountByAccount(acc1.account_id);
assert.strictEqual(count2,3);
console.log('  PASS\n');

console.log('[19] Shares by session');
const sessShares=am.getSharesBySession('session_1');
assert.strictEqual(sessShares.length,3);
const sessCount=am.getShareCountBySession('session_1');
assert.strictEqual(sessCount,3);
console.log('  PASS\n');

console.log('[20] Persist block');
const blockResult=am.insertBlock(acc1.account_id,'session_1',800000,312500000);
assert(blockResult.blockId>0,'block id');
const blocks=am.getBlocksByAccount(acc1.account_id);
assert.strictEqual(blocks.length,1);
assert.strictEqual(blocks[0].height,800000);
assert.strictEqual(blocks[0].coinbase_value,312500000);
assert.strictEqual(blocks[0].status,'submitted');
console.log('  PASS\n');

console.log('[21] Delete session');
am.deleteSession('session_1');
const deleted=am.getSession('session_1');
assert.strictEqual(deleted,null,'session deleted');
console.log('  PASS\n');

console.log('[22] Case insensitive address storage');
const addrUpper='BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4';
const accUpper=am.getOrCreateAccount(addrUpper);
assert.strictEqual(accUpper.account_id,acc1.account_id,'same account for uppercase');
console.log('  PASS\n');

console.log('[23] Integer satoshis only');
const balCheck=db.prepare('SELECT typeof(confirmed_sat), typeof(pending_sat), typeof(total_earned_sat) FROM balances WHERE account_id = ?').get(acc1.account_id);
assert.strictEqual(balCheck['typeof(confirmed_sat)'],'integer');
assert.strictEqual(balCheck['typeof(pending_sat)'],'integer');
assert.strictEqual(balCheck['typeof(total_earned_sat)'],'integer');
console.log('  PASS\n');

closeDb();
resetDb();
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);

console.log('=== ALL ACCOUNT MANAGER TESTS PASSED ===');
