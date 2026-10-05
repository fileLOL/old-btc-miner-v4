const assert=require('assert');
const path=require('path');
const fs=require('fs');
const TestPayoutRunner=require('../lib/test-payout-runner');

(async()=>{
console.log('=== TEST PAYOUT RUNNER TEST ===\n');

const TEST_DB=path.join(__dirname,'..','data','test-runner-unit.db');
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);

const VALID_ADDR='bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const INVALID_ADDR='invalid_addr';

function makeMockBtc(walletBalanceSat,shouldFailSend){
const calls=[];
return{calls,fn:async(args)=>{
calls.push(args);
if(args[0]==='getblockchaininfo')return JSON.stringify({chain:'main',blocks:970000});
if(args[0]==='getwalletinfo')return JSON.stringify({walletname:'revblocks'});
if(args[0]==='getbalances')return JSON.stringify({mine:{trusted:walletBalanceSat/1e8,untrusted_pending:0,immature:0}});
if(args[0]==='sendtoaddress'){
if(shouldFailSend)throw new Error('mock sendtoaddress failure');
return 'txid_mock_'+Date.now()+'_'+Math.random().toString(36).slice(2,6)}
throw new Error('unknown command')}}}

console.log('[1] DB temporal se crea en path configurado');
{
const runner=new TestPayoutRunner({
MIN_PAYOUT_SAT:50000,MAX_PAYOUT_SAT:100000000,
PAYOUT_DRY_RUN:true,ENABLE_REAL_PAYOUT_TEST:false,
TEST_PAYOUT_DB_PATH:TEST_DB,TEST_PAYOUT_ADDRESS:VALID_ADDR,TEST_PAYOUT_SAT:50000},
makeMockBtc(1000000).fn);
runner.initTestDb();
assert(fs.existsSync(TEST_DB),'test DB file exists');
runner.close();
console.log('  PASS\n')}

console.log('[2] Balance temporal inicial = 0, setTestBalance funciona');
{
const runner=new TestPayoutRunner({
MIN_PAYOUT_SAT:50000,MAX_PAYOUT_SAT:100000000,
PAYOUT_DRY_RUN:true,ENABLE_REAL_PAYOUT_TEST:false,
TEST_PAYOUT_DB_PATH:TEST_DB,TEST_PAYOUT_ADDRESS:VALID_ADDR,TEST_PAYOUT_SAT:50000},
makeMockBtc(1000000).fn);
runner.initTestDb();
assert.strictEqual(runner.getTestBalance(),0);
runner.setTestBalance(50000);
assert.strictEqual(runner.getTestBalance(),50000);
runner.close();
console.log('  PASS\n')}

console.log('[3] Payout DRY RUN no ejecuta sendtoaddress');
{
const mock=makeMockBtc(1000000,false);
const runner=new TestPayoutRunner({
MIN_PAYOUT_SAT:50000,MAX_PAYOUT_SAT:100000000,
PAYOUT_DRY_RUN:true,ENABLE_REAL_PAYOUT_TEST:false,
TEST_PAYOUT_DB_PATH:TEST_DB,TEST_PAYOUT_ADDRESS:VALID_ADDR,TEST_PAYOUT_SAT:50000},
mock.fn);
runner.initTestDb();
runner.setTestBalance(50000);
const result=await runner.run();
assert.strictEqual(result.success,true);
assert.strictEqual(result.dryRun,true);
assert.strictEqual(result.txid,null);
assert.strictEqual(result.restored,true);
assert.strictEqual(runner.getTestBalance(),50000,'balance restored');
const sendCalls=mock.calls.filter(c=>c[0]==='sendtoaddress');
assert.strictEqual(sendCalls.length,0,'sendtoaddress NOT called');
runner.close();
console.log('  PASS\n')}

console.log('[4] Autorizacion ausente (ENABLE_REAL_PAYOUT_TEST=false) con PAYOUT_DRY_RUN=true -> dry run');
{
const mock=makeMockBtc(1000000,false);
const runner=new TestPayoutRunner({
MIN_PAYOUT_SAT:50000,MAX_PAYOUT_SAT:100000000,
PAYOUT_DRY_RUN:true,ENABLE_REAL_PAYOUT_TEST:false,
TEST_PAYOUT_DB_PATH:TEST_DB,TEST_PAYOUT_ADDRESS:VALID_ADDR,TEST_PAYOUT_SAT:50000},
mock.fn);
runner.initTestDb();
runner.setTestBalance(50000);
const result=await runner.run();
assert.strictEqual(result.dryRun,true);
const sendCalls=mock.calls.filter(c=>c[0]==='sendtoaddress');
assert.strictEqual(sendCalls.length,0);
runner.close();
console.log('  PASS\n')}

console.log('[5] Autorizacion presente (ENABLE_REAL_PAYOUT_TEST=true, PAYOUT_DRY_RUN=false) -> sendtoaddress real mock');
{
const mock=makeMockBtc(1000000,false);
const runner=new TestPayoutRunner({
MIN_PAYOUT_SAT:50000,MAX_PAYOUT_SAT:100000000,
PAYOUT_DRY_RUN:false,ENABLE_REAL_PAYOUT_TEST:true,
TEST_PAYOUT_DB_PATH:TEST_DB,TEST_PAYOUT_ADDRESS:VALID_ADDR,TEST_PAYOUT_SAT:50000},
mock.fn);
runner.initTestDb();
runner.setTestBalance(50000);
const result=await runner.run();
assert.strictEqual(result.success,true);
assert.strictEqual(result.dryRun,false);
assert.strictEqual(result.simulated,false);
assert(result.txid&&result.txid.startsWith('txid_mock_'));
assert.strictEqual(runner.getTestBalance(),0,'balance deducted (not restored)');
const sendCalls=mock.calls.filter(c=>c[0]==='sendtoaddress');
assert.strictEqual(sendCalls.length,1,'sendtoaddress called exactly once');
assert.strictEqual(sendCalls[0][1],VALID_ADDR);
assert.strictEqual(sendCalls[0][2],'0.00050000');
runner.close();
console.log('  PASS\n')}

console.log('[6] Direccion invalida rechazada en preflight');
{
const mock=makeMockBtc(1000000,false);
const runner=new TestPayoutRunner({
MIN_PAYOUT_SAT:50000,MAX_PAYOUT_SAT:100000000,
PAYOUT_DRY_RUN:false,ENABLE_REAL_PAYOUT_TEST:true,
TEST_PAYOUT_DB_PATH:TEST_DB,TEST_PAYOUT_ADDRESS:INVALID_ADDR,TEST_PAYOUT_SAT:50000},
mock.fn);
runner.initTestDb();
runner.setTestBalance(50000);
const result=await runner.run();
assert.strictEqual(result.success,false);
assert(Array.isArray(result.details),'details array returned');
assert(result.details.some(e=>/invalid destination/i.test(e)),'invalid destination error');
const sendCalls=mock.calls.filter(c=>c[0]==='sendtoaddress');
assert.strictEqual(sendCalls.length,0,'sendtoaddress NOT called');
assert.strictEqual(runner.getTestBalance(),50000,'balance untouched');
runner.close();
console.log('  PASS\n')}

console.log('[7] Importe inferior al minimo rechazado');
{
const mock=makeMockBtc(1000000,false);
const runner=new TestPayoutRunner({
MIN_PAYOUT_SAT:50000,MAX_PAYOUT_SAT:100000000,
PAYOUT_DRY_RUN:false,ENABLE_REAL_PAYOUT_TEST:true,
TEST_PAYOUT_DB_PATH:TEST_DB,TEST_PAYOUT_ADDRESS:VALID_ADDR,TEST_PAYOUT_SAT:10000},
mock.fn);
runner.initTestDb();
runner.setTestBalance(10000);
const result=await runner.run();
assert.strictEqual(result.success,false);
assert(result.details.some(e=>/below MIN_PAYOUT_SAT/i.test(e)));
const sendCalls=mock.calls.filter(c=>c[0]==='sendtoaddress');
assert.strictEqual(sendCalls.length,0);
runner.close();
console.log('  PASS\n')}

console.log('[8] Importe superior al maximo rechazado');
{
const mock=makeMockBtc(1000000000,false);
const runner=new TestPayoutRunner({
MIN_PAYOUT_SAT:50000,MAX_PAYOUT_SAT:100000000,
PAYOUT_DRY_RUN:false,ENABLE_REAL_PAYOUT_TEST:true,
TEST_PAYOUT_DB_PATH:TEST_DB,TEST_PAYOUT_ADDRESS:VALID_ADDR,TEST_PAYOUT_SAT:200000000},
mock.fn);
runner.initTestDb();
runner.setTestBalance(200000000);
const result=await runner.run();
assert.strictEqual(result.success,false);
assert(result.details.some(e=>/above MAX_PAYOUT_SAT/i.test(e)));
const sendCalls=mock.calls.filter(c=>c[0]==='sendtoaddress');
assert.strictEqual(sendCalls.length,0);
runner.close();
console.log('  PASS\n')}

console.log('[9] Doble ejecucion rechazada (mismo amount+destination ya pending)');
{
const mock=makeMockBtc(1000000,false);
const runner=new TestPayoutRunner({
MIN_PAYOUT_SAT:50000,MAX_PAYOUT_SAT:100000000,
PAYOUT_DRY_RUN:false,ENABLE_REAL_PAYOUT_TEST:true,
TEST_PAYOUT_DB_PATH:TEST_DB,TEST_PAYOUT_ADDRESS:VALID_ADDR,TEST_PAYOUT_SAT:50000},
mock.fn);
runner.initTestDb();
runner.setTestBalance(100000);
const first=await runner.run();
assert.strictEqual(first.success,true);
assert.strictEqual(first.txid!==null,true);
runner.setTestBalance(100000);
const second=await runner.run();
assert.strictEqual(second.success,false);
assert(second.details.some(e=>/identical payout already exists/i.test(e)));
const sendCalls=mock.calls.filter(c=>c[0]==='sendtoaddress');
assert.strictEqual(sendCalls.length,1,'sendtoaddress called only once across both attempts');
runner.close();
console.log('  PASS\n')}

console.log('[10] Error en sendtoaddress -> rollback del balance');
{
const mock=makeMockBtc(1000000,true);
const runner=new TestPayoutRunner({
MIN_PAYOUT_SAT:50000,MAX_PAYOUT_SAT:100000000,
PAYOUT_DRY_RUN:false,ENABLE_REAL_PAYOUT_TEST:true,
TEST_PAYOUT_DB_PATH:TEST_DB,TEST_PAYOUT_ADDRESS:VALID_ADDR,TEST_PAYOUT_SAT:50000},
mock.fn);
runner.initTestDb();
runner.setTestBalance(50000);
const result=await runner.run();
assert.strictEqual(result.success,false);
assert.strictEqual(result.restored,true);
assert.strictEqual(runner.getTestBalance(),50000,'balance fully restored after failure');
const payouts=runner.getTestPayouts();
const failed=payouts.find(p=>p.status==='failed');
assert(failed,'payout marked failed');
assert.strictEqual(failed.error,'mock sendtoaddress failure');
runner.close();
console.log('  PASS\n')}

console.log('[11] Auditoria registra todas las operaciones');
{
const mock=makeMockBtc(1000000,true);
const runner=new TestPayoutRunner({
MIN_PAYOUT_SAT:50000,MAX_PAYOUT_SAT:100000000,
PAYOUT_DRY_RUN:false,ENABLE_REAL_PAYOUT_TEST:true,
TEST_PAYOUT_DB_PATH:TEST_DB,TEST_PAYOUT_ADDRESS:VALID_ADDR,TEST_PAYOUT_SAT:50000},
mock.fn);
runner.initTestDb();
runner.setTestBalance(50000);
await runner.run();
const audit=runner.getAuditTrail();
const types=audit.map(e=>e.type).sort();
assert(types.includes('test_payout_start'),'start logged');
assert(types.includes('test_payout_created'),'created logged');
assert(types.includes('test_payout_failed'),'failed logged');
assert(types.includes('test_payout_reversed'),'reversal logged');
runner.close();
console.log('  PASS\n')}

console.log('[12] Produccion intacta: data/pool.db no tocada');
{
const prodDbPath=path.join(__dirname,'..','data','pool.db');
const prodDbExisted=fs.existsSync(prodDbPath);
const prodSizeBefore=prodDbExisted?fs.statSync(prodDbPath).size:null;

const mock=makeMockBtc(1000000,false);
const runner=new TestPayoutRunner({
MIN_PAYOUT_SAT:50000,MAX_PAYOUT_SAT:100000000,
PAYOUT_DRY_RUN:true,ENABLE_REAL_PAYOUT_TEST:false,
TEST_PAYOUT_DB_PATH:TEST_DB,TEST_PAYOUT_ADDRESS:VALID_ADDR,TEST_PAYOUT_SAT:50000},
mock.fn);
runner.initTestDb();
runner.setTestBalance(50000);
await runner.run();
runner.close();

const prodSizeAfter=fs.existsSync(prodDbPath)?fs.statSync(prodDbPath).size:null;
assert.strictEqual(prodSizeBefore,prodSizeAfter,'production pool.db size unchanged');
console.log('  pool.db size before:',prodSizeBefore,'after:',prodSizeAfter);
console.log('  PASS\n')}

console.log('[13] Runner con PAYOUT_DRY_RUN=true + ENABLE_REAL_PAYOUT_TEST=true sigue en dry run');
{
const mock=makeMockBtc(1000000,false);
const runner=new TestPayoutRunner({
MIN_PAYOUT_SAT:50000,MAX_PAYOUT_SAT:100000000,
PAYOUT_DRY_RUN:true,ENABLE_REAL_PAYOUT_TEST:true,
TEST_PAYOUT_DB_PATH:TEST_DB,TEST_PAYOUT_ADDRESS:VALID_ADDR,TEST_PAYOUT_SAT:50000},
mock.fn);
runner.initTestDb();
runner.setTestBalance(50000);
const result=await runner.run();
assert.strictEqual(result.dryRun,true,'PAYOUT_DRY_RUN wins');
const sendCalls=mock.calls.filter(c=>c[0]==='sendtoaddress');
assert.strictEqual(sendCalls.length,0,'no sendtoaddress even with ENABLE_REAL_PAYOUT_TEST=true');
runner.close();
console.log('  PASS\n')}

if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);

console.log('=== ALL TEST PAYOUT RUNNER TESTS PASSED ===');
})().catch(e=>{console.error('TEST FAILED:',e);process.exit(1)});
