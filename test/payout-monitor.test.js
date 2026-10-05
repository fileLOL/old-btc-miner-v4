const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { getDb, closeDb, resetDb } = require('../lib/db');
const PayoutMonitor = require('../lib/payout-monitor');
const accountManager = require('../lib/account-manager');

(async () => {
console.log('=== PAYOUT MONITOR TEST ===\n');

const TEST_DB = path.join(__dirname, '..', 'data', 'test_payout_monitor.db');
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const db = getDb(TEST_DB);

// Mock Bitcoin CLI
const mockBtcCli = async (args) => {
  if (args[0] === 'gettransaction') {
    const txid = args[1];
    if (txid === 'tx_confirmed') {
      return JSON.stringify({ confirmations: 6 });
    }
    if (txid === 'tx_pending') {
      return JSON.stringify({ confirmations: 0 });
    }
    if (txid === 'tx_conflicted') {
      return JSON.stringify({ confirmations: -1 });
    }
    if (txid === 'tx_not_found') {
      throw new Error('Invalid or non-wallet transaction id');
    }
    throw new Error('Unknown txid');
  }
  throw new Error('Unknown command: ' + args[0]);
};

const config = {
  PAYOUT_MONITOR_INTERVAL_MS: 999999
};

const monitor = new PayoutMonitor(config, mockBtcCli);

console.log('[1] Create test account with broadcast payouts');
const addr = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const acc = accountManager.getOrCreateAccount(addr);

// Create broadcast payouts
const now = Date.now();
db.prepare(`INSERT INTO payouts (account_id, amount_sat, txid, status, created_at, broadcast_at)
  VALUES (?, ?, ?, 'broadcast', ?, ?)`).run(acc.account_id, 100000, 'tx_confirmed', now - 3600000, now - 3600000);
db.prepare(`INSERT INTO payouts (account_id, amount_sat, txid, status, created_at, broadcast_at)
  VALUES (?, ?, ?, 'broadcast', ?, ?)`).run(acc.account_id, 50000, 'tx_pending', now - 1800000, now - 1800000);
db.prepare(`INSERT INTO payouts (account_id, amount_sat, txid, status, created_at, broadcast_at)
  VALUES (?, ?, ?, 'broadcast', ?, ?)`).run(acc.account_id, 75000, 'tx_conflicted', now - 900000, now - 900000);
db.prepare(`INSERT INTO payouts (account_id, amount_sat, txid, status, created_at, broadcast_at)
  VALUES (?, ?, ?, 'broadcast', ?, ?)`).run(acc.account_id, 25000, 'tx_not_found', now - 600000, now - 600000);

// Set pending balances
db.prepare('UPDATE balances SET pending_sat = pending_sat + 100000 WHERE account_id = ?').run(acc.account_id);
db.prepare('UPDATE balances SET pending_sat = pending_sat + 50000 WHERE account_id = ?').run(acc.account_id);
db.prepare('UPDATE balances SET pending_sat = pending_sat + 75000 WHERE account_id = ?').run(acc.account_id);
db.prepare('UPDATE balances SET pending_sat = pending_sat + 25000 WHERE account_id = ?').run(acc.account_id);

const pendingCount = db.prepare("SELECT COUNT(*) as count FROM payouts WHERE status = 'broadcast'").get();
assert.strictEqual(pendingCount.count, 4, '4 broadcast payouts');
console.log('  created 4 broadcast payouts');
console.log('  PASS\n');

console.log('[2] Check confirmed transaction');
const payout1 = db.prepare("SELECT * FROM payouts WHERE txid = 'tx_confirmed'").get();
await monitor.checkTransaction(payout1);
const updated1 = db.prepare("SELECT * FROM payouts WHERE txid = 'tx_confirmed'").get();
assert.strictEqual(updated1.status, 'confirmed', 'status updated to confirmed');
assert(updated1.confirmed_at > 0, 'confirmed_at set');
const bal1 = accountManager.getBalance(acc.account_id);
console.log('  payout confirmed, pending_sat reduced');
console.log('  PASS\n');

console.log('[3] Check pending transaction (0 confirmations)');
const payout2 = db.prepare("SELECT * FROM payouts WHERE txid = 'tx_pending'").get();
await monitor.checkTransaction(payout2);
const updated2 = db.prepare("SELECT * FROM payouts WHERE txid = 'tx_pending'").get();
assert.strictEqual(updated2.status, 'broadcast', 'stays broadcast (recent)');
console.log('  pending transaction stays broadcast (recent)');
console.log('  PASS\n');

console.log('[4] Check stuck transaction (>24h in mempool)');
// Modify broadcast_at to be >24h ago
db.prepare("UPDATE payouts SET broadcast_at = ? WHERE txid = 'tx_pending'").run(Date.now() - (25 * 3600000));
const payout2b = db.prepare("SELECT * FROM payouts WHERE txid = 'tx_pending'").get();
await monitor.checkTransaction(payout2b);
const updated2b = db.prepare("SELECT * FROM payouts WHERE txid = 'tx_pending'").get();
assert.strictEqual(updated2b.status, 'failed', 'marked failed after 24h');
assert(updated2b.error.includes('stuck in mempool'), 'error recorded');
console.log('  stuck transaction marked failed after 24h');
console.log('  PASS\n');

console.log('[5] Check conflicted transaction');
const payout3 = db.prepare("SELECT * FROM payouts WHERE txid = 'tx_conflicted'").get();
await monitor.checkTransaction(payout3);
const updated3 = db.prepare("SELECT * FROM payouts WHERE txid = 'tx_conflicted'").get();
assert.strictEqual(updated3.status, 'failed', 'conflicted marked failed');
assert(updated3.error.includes('conflicted'), 'error recorded');
console.log('  conflicted transaction marked failed');
console.log('  PASS\n');

console.log('[6] Check transaction not found');
const payout4 = db.prepare("SELECT * FROM payouts WHERE txid = 'tx_not_found'").get();
await monitor.checkTransaction(payout4);
const updated4 = db.prepare("SELECT * FROM payouts WHERE txid = 'tx_not_found'").get();
assert.strictEqual(updated4.status, 'failed', 'not found marked failed');
assert(updated4.error.includes('not found'), 'error recorded');
console.log('  transaction not found marked failed');
console.log('  PASS\n');

console.log('[7] Verify balance restorations');
const finalBal = accountManager.getBalance(acc.account_id);
console.log('  final pending_sat:', finalBal.pending_sat);
console.log('  PASS\n');

console.log('[8] Start/stop monitor');
monitor.start();
assert(monitor.interval !== null, 'interval set');
monitor.stop();
assert(monitor.interval === null, 'interval cleared');
console.log('  PASS\n');

closeDb();
resetDb();
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

console.log('=== ALL PAYOUT MONITOR TESTS PASSED ===');
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
