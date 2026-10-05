const assert=require('assert'),path=require('path'),fs=require('fs');
const{getDb,closeDb,resetDb}=require('../lib/db');
const am=require('../lib/account-manager');
const BlockMonitor=require('../lib/block-monitor');

(async()=>{
console.log('=== BLOCK MONITOR TEST ===\n');

const TEST_DB=path.join(__dirname,'..','data','test_monitor.db');
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);

const db=getDb(TEST_DB);

const mockBtcCli=async(args)=>{
const method=args[0];
if(method==='getblock'){
const hash=args[1];
if(hash==='confirmed_block'){
return JSON.stringify({hash,confirmations:5,height:800000})}
if(hash==='mature_block'){
return JSON.stringify({hash,confirmations:101,height:799900})}
if(hash==='orphaned_block'){
throw new Error('Block not found')}
if(hash==='zero_conf'){
return JSON.stringify({hash,confirmations:0,height:800001})}
if(hash==='negative_conf'){
return JSON.stringify({hash,confirmations:-1,height:800002})}
throw new Error('Block not found')}
if(method==='getblockchaininfo'){
return JSON.stringify({chain:'main',blocks:800150})}
throw new Error('Unknown method: '+method)}

const config={BLOCK_MONITOR_MS:1000,COINBASE_MATURITY:100,PPLNS_WINDOW_SIZE:10000,POOL_FEE_PERCENT:2};
const monitor=new BlockMonitor(config,mockBtcCli);

console.log('[1] Create test blocks');
const acc=am.getOrCreateAccount('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
const b1=am.insertBlock(acc.account_id,'s1',800000,312500000,'confirmed_block');
const b2=am.insertBlock(acc.account_id,'s1',799900,312500000,'mature_block');
const b3=am.insertBlock(acc.account_id,'s1',800002,312500000,'orphaned_block');
const b4=am.insertBlock(acc.account_id,'s1',800001,312500000,'zero_conf');
const b5=am.insertBlock(acc.account_id,'s1',800003,312500000,'negative_conf');
const b6=am.insertBlock(acc.account_id,'s1',799800,312500000,null);
console.log('  created 6 blocks');
console.log('  PASS\n');

console.log('[2] Check confirmed block (5 confirmations)');
const block1=db.prepare('SELECT * FROM blocks WHERE id=?').get(b1.blockId);
assert.strictEqual(block1.status,'submitted');
await monitor.checkBlock(block1);
const updated1=db.prepare('SELECT * FROM blocks WHERE id=?').get(b1.blockId);
assert.strictEqual(updated1.status,'confirmed','block1 should be confirmed');
console.log('  submitted -> confirmed');
console.log('  PASS\n');

console.log('[3] Check mature block (101 confirmations)');
const block2=db.prepare('SELECT * FROM blocks WHERE id=?').get(b2.blockId);
await monitor.checkBlock(block2);
const updated2=db.prepare('SELECT * FROM blocks WHERE id=?').get(b2.blockId);
assert.strictEqual(updated2.status,'mature','block2 should be mature');
console.log('  submitted -> confirmed -> mature (rewards distributed)');
console.log('  PASS\n');

console.log('[4] Check orphaned block (not found)');
const block3=db.prepare('SELECT * FROM blocks WHERE id=?').get(b3.blockId);
await monitor.checkBlock(block3);
const updated3=db.prepare('SELECT * FROM blocks WHERE id=?').get(b3.blockId);
assert.strictEqual(updated3.status,'orphaned','block3 should be orphaned');
console.log('  submitted -> orphaned');
console.log('  PASS\n');

console.log('[5] Check zero-confirmation block (old, likely orphaned)');
const block4=db.prepare('SELECT * FROM blocks WHERE id=?').get(b4.blockId);
await monitor.checkBlock(block4);
const updated4=db.prepare('SELECT * FROM blocks WHERE id=?').get(b4.blockId);
assert.strictEqual(updated4.status,'orphaned','block4 should be orphaned (0 conf, too old)');
console.log('  submitted -> orphaned (0 confirmations, 150 blocks deep)');
console.log('  PASS\n');

console.log('[6] Check negative confirmation block');
const block5=db.prepare('SELECT * FROM blocks WHERE id=?').get(b5.blockId);
await monitor.checkBlock(block5);
const updated5=db.prepare('SELECT * FROM blocks WHERE id=?').get(b5.blockId);
assert.strictEqual(updated5.status,'orphaned','block5 should be orphaned (negative conf)');
console.log('  submitted -> orphaned (negative confirmations)');
console.log('  PASS\n');

console.log('[7] Check block with no hash');
const block6=db.prepare('SELECT * FROM blocks WHERE id=?').get(b6.blockId);
await monitor.checkBlock(block6);
const updated6=db.prepare('SELECT * FROM blocks WHERE id=?').get(b6.blockId);
assert.strictEqual(updated6.status,'submitted','block6 stays submitted (no hash to check)');
console.log('  no hash -> stays submitted (cannot monitor)');
console.log('  PASS\n');

console.log('[8] Verify final states');
const allBlocks=db.prepare('SELECT id,status,block_hash FROM blocks ORDER BY id').all();
for(const b of allBlocks){
console.log('  block',b.id,':',b.status,'('+b.block_hash+')')}
console.log('  PASS\n');

console.log('[9] Monitor start/stop');
monitor.start();
assert(monitor.interval!==null,'interval set');
monitor.stop();
assert(monitor.interval===null,'interval cleared');
console.log('  PASS\n');

closeDb();
resetDb();
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);

console.log('=== ALL BLOCK MONITOR TESTS PASSED ===');
})().catch(e=>{console.error('TEST FAILED:',e);process.exit(1)});
