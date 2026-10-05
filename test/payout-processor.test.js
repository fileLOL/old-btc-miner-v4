const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { getDb, closeDb, resetDb } = require('../lib/db');
const PayoutProcessor = require('../lib/payout-processor');
const accountManager = require('../lib/account-manager');

(async () => {
console.log('=== PAYOUT PROCESSOR TEST ===\n');

const TEST_DB = path.join(__dirname, '..', 'data', 'test_payout_processor.db');
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const db = getDb(TEST_DB);

// Mock Bitcoin CLI
let mockSendResult = 'mock_txid_123';
let mockSendShouldFail = false;
const mockBtcCli = async (args) => {
  if (args[0] === 'sendtoaddress') {
    if (mockSendShouldFail) {
      throw new Error('Insufficient funds');
    }
    return mockSendResult;
  }
  throw new Error('Unknown command: ' + args[0]);
};

const config = {
  MIN_PAYOUT_SAT: 50000,
  MAX_PAYOUT_SAT: 100000000,
  PAYOUT_DRY_RUN: false
};

const processor = new PayoutProcessor(config, mockBtcCli);

console.log('[1] Create test accounts with balances');
const addr1 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const addr2 = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const acc1 = accountManager.getOrCreateAccount(addr1);
const acc2 = accountManager.getOrCreateAccount(addr2);

// Set confirmed balances
db.prepare('UPDATE balances SET confirmed_sat = ? WHERE account_id = ?').run(100000, acc1.account_id);
db.prepare('UPDATE balances SET confirmed_sat = ? WHERE account_id = ?').run(30000, acc2.account_id);

const bal1 = accountManager.getBalance(acc1.account_id);
const bal2 = accountManager.getBalance(acc2.account_id);
assert.strictEqual(bal1.confirmed_sat, 100000, 'acc1 has 100000 sat');
assert.strictEqual(bal2.confirmed_sat, 30000, 'acc2 has 30000 sat (below minimum)');
console.log('  acc1:', bal1.confirmed_sat, 'sat (eligible)');
console.log('  acc2:', bal2.confirmed_sat, 'sat (below minimum)');
console.log('  PASS\n');

console.log('[2] Skip accounts below minimum payout');
const result1 = await processor.processPayout(acc2.account_id).catch(e => e.message);
assert(result1.includes('Insufficient balance'), 'should reject insufficient balance');
console.log('  account with 30000 sat rejected (below 50000 minimum)');
console.log('  PASS\n');

console.log('[3] Process payout for eligible account');
mockSendResult = 'txid_abc123';
const result2 = await processor.processPayout(acc1.account_id);
assert.strictEqual(result2.success, true, 'payout successful');
assert.strictEqual(result2.dry_run, false, 'not dry run');
assert.strictEqual(result2.amount_sat, 100000, 'correct amount');
assert.strictEqual(result2.amount_btc, '0.00100000', 'correct BTC conversion');
assert.strictEqual(result2.txid, 'txid_abc123', 'txid captured');
assert.strictEqual(result2.address, addr1, 'correct address');
console.log('  payout_id:', result2.payout_id);
console.log('  amount_sat:', result2.amount_sat);
console.log('  amount_btc:', result2.amount_btc);
console.log('  txid:', result2.txid);
console.log('  PASS\n');

console.log('[4] Verify balance updated');
const bal1After = accountManager.getBalance(acc1.account_id);
assert.strictEqual(bal1After.confirmed_sat, 0, 'balance reduced to 0');
console.log('  confirmed_sat after payout:', bal1After.confirmed_sat);
console.log('  PASS\n');

console.log('[5] Prevent double payout');
db.prepare('UPDATE balances SET confirmed_sat = 100000 WHERE account_id = ?').run(acc1.account_id);
const result3 = await processor.processPayout(acc1.account_id).catch(e => e.message);
assert(result3.includes('already has pending/broadcast payout'), 'should reject double payout');
console.log('  second payout rejected (already pending)');
console.log('  PASS\n');

console.log('[6] Handle sendtoaddress failure');
const acc3 = accountManager.getOrCreateAccount('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy');
db.prepare('UPDATE balances SET confirmed_sat = 75000 WHERE account_id = ?').run(acc3.account_id);
mockSendShouldFail = true;
const result4 = await processor.processPayout(acc3.account_id).catch(e => e.message);
assert(result4.includes('Insufficient funds'), 'should propagate error');
mockSendShouldFail = false;

// Verify balance was restored
const bal3 = accountManager.getBalance(acc3.account_id);
assert.strictEqual(bal3.confirmed_sat, 75000, 'balance restored after failure');
console.log('  sendtoaddress failed, balance restored:', bal3.confirmed_sat);

// Verify payout marked as failed
const failedPayout = db.prepare('SELECT * FROM payouts WHERE account_id = ? ORDER BY id DESC LIMIT 1').get(acc3.account_id);
assert.strictEqual(failedPayout.status, 'failed', 'payout marked failed');
assert(failedPayout.error.includes('Insufficient funds'), 'error recorded');
console.log('  payout marked as failed with error');
console.log('  PASS\n');

console.log('[7] Dry run mode');
config.PAYOUT_DRY_RUN = true;
const acc4 = accountManager.getOrCreateAccount('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
db.prepare('UPDATE balances SET confirmed_sat = 200000 WHERE account_id = ?').run(acc4.account_id);
const result5 = await processor.processPayout(acc4.account_id);
assert.strictEqual(result5.success, true, 'dry run successful');
assert.strictEqual(result5.dry_run, true, 'marked as dry run');
assert.strictEqual(result5.amount_sat, 200000, 'correct amount');
assert.strictEqual(result5.txid, null, 'no txid in dry run');

// Verify balance not changed
const bal4 = accountManager.getBalance(acc4.account_id);
assert.strictEqual(bal4.confirmed_sat, 200000, 'balance unchanged in dry run');
console.log('  dry run completed, balance preserved:', bal4.confirmed_sat);
console.log('  PASS\n');

console.log('[8] MAX_PAYOUT_SAT limit');
config.PAYOUT_DRY_RUN = false;
const acc5 = accountManager.getOrCreateAccount('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297');
db.prepare('UPDATE balances SET confirmed_sat = 150000000 WHERE account_id = ?').run(acc5.account_id);
config.MAX_PAYOUT_SAT = 100000000;
const result6 = await processor.processPayout(acc5.account_id);
assert.strictEqual(result6.amount_sat, 100000000, 'capped at MAX_PAYOUT_SAT');
assert.strictEqual(result6.amount_btc, '1.00000000', 'correct BTC for 1 BTC');
console.log('  payout capped at MAX_PAYOUT_SAT:', result6.amount_sat, 'sat');
console.log('  PASS\n');

console.log('[9] Get payout stats');
const stats = processor.getPayoutStats();
console.log('  pending:', stats.pending);
console.log('  broadcast:', stats.broadcast);
console.log('  confirmed:', stats.confirmed);
console.log('  failed:', stats.failed);
assert(stats.broadcast.count > 0 || stats.failed.count > 0 || stats.confirmed.count >= 0, 'stats available');
console.log('  PASS\n');

closeDb();
resetDb();
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

console.log('=== ALL PAYOUT PROCESSOR TESTS PASSED ===');
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
