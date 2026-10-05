const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { getDb, closeDb, resetDb } = require('../lib/db');
const AuditLog = require('../lib/audit');
const accountManager = require('../lib/account-manager');

console.log('=== AUDIT LOG TEST ===\n');

const TEST_DB = path.join(__dirname, '..', 'data', 'test_audit.db');
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const db = getDb(TEST_DB);

console.log('[1] Create test accounts');
const addr1 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const addr2 = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const acc1 = accountManager.getOrCreateAccount(addr1);
const acc2 = accountManager.getOrCreateAccount(addr2);
console.log('  acc1:', acc1.account_id);
console.log('  acc2:', acc2.account_id);
console.log('  PASS\n');

console.log('[2] Log share operations');
AuditLog.logShare(acc1.account_id, 'job_1', 268435456);
AuditLog.logShare(acc1.account_id, 'job_1', 268435456);
AuditLog.logShare(acc2.account_id, 'job_2', 268435456);
const shares = db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE type = 'share'").get();
assert.strictEqual(shares.count, 3, '3 shares logged');
console.log('  logged 3 shares (2 for acc1, 1 for acc2)');
console.log('  PASS\n');

console.log('[3] Log block rewards');
AuditLog.logBlockReward(acc1.account_id, 1, 800000, 200000000);
AuditLog.logBlockReward(acc2.account_id, 1, 800000, 50000000);
const rewards = db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE type = 'block_reward'").get();
assert.strictEqual(rewards.count, 2, '2 rewards logged');
console.log('  logged 2 block rewards');
console.log('  PASS\n');

console.log('[4] Log pool fee');
AuditLog.logPoolFee(1, 6250000);
const fees = db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE type = 'pool_fee'").get();
assert.strictEqual(fees.count, 1, '1 pool fee logged');
console.log('  logged pool fee');
console.log('  PASS\n');

console.log('[5] Log payout operations');
AuditLog.logPayoutCreated(1, acc1.account_id, 100000, addr1);
AuditLog.logPayoutBroadcast(1, acc1.account_id, 'txid_123');
AuditLog.logPayoutConfirmed(1, acc1.account_id);
AuditLog.logPayoutCreated(2, acc2.account_id, 50000, addr2);
AuditLog.logPayoutFailed(2, acc2.account_id, 'Insufficient funds');
AuditLog.logPayoutReversed(2, acc2.account_id, 50000, 'sendtoaddress failed');

const payoutLogs = db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE type LIKE 'payout%'").get();
assert.strictEqual(payoutLogs.count, 6, '6 payout logs');
console.log('  logged 6 payout operations');
console.log('  PASS\n');

console.log('[6] Get audit trail for specific account');
const trail1 = AuditLog.getAuditTrail(acc1.account_id, 10);
assert(trail1.length > 0, 'trail not empty');
assert(trail1.every(l => l.account_id === acc1.account_id || l.type === 'pool_fee'), 'filtered to acc1');
console.log('  retrieved trail for acc1:', trail1.length, 'entries');
console.log('  PASS\n');

console.log('[7] Get full audit trail');
const fullTrail = AuditLog.getAuditTrail(null, 100);
assert(fullTrail.length > 0, 'full trail not empty');
console.log('  retrieved full trail:', fullTrail.length, 'entries');
console.log('  PASS\n');

console.log('[8] Get account summary');
const summary1 = AuditLog.getAccountSummary(acc1.account_id);
console.log('  acc1 summary:');
console.log('    shares:', summary1.shares);
console.log('    block_rewards:', summary1.block_rewards);
console.log('    payouts:', summary1.payouts);
console.log('    failed_payouts:', summary1.failed_payouts);
assert(summary1.shares > 0, 'has shares');
assert(summary1.block_rewards.count > 0, 'has rewards');
assert(summary1.payouts.count > 0, 'has payouts');
console.log('  PASS\n');

console.log('[9] Get pool summary');
const poolSummary = AuditLog.getPoolSummary();
console.log('  pool summary:');
console.log('    total_shares:', poolSummary.total_shares);
console.log('    total_rewards:', poolSummary.total_rewards);
console.log('    total_fees:', poolSummary.total_fees);
console.log('    total_payouts:', poolSummary.total_payouts);
assert(poolSummary.total_shares > 0, 'has total shares');
assert(poolSummary.total_rewards.count > 0, 'has total rewards');
assert(poolSummary.total_fees.count > 0, 'has total fees');
assert(poolSummary.total_payouts.count > 0, 'has total payouts');
console.log('  PASS\n');

console.log('[10] Verify audit trail completeness');
const trail = AuditLog.getAuditTrail(null, 1000);
const types = {};
trail.forEach(l => { types[l.type] = (types[l.type] || 0) + 1; });
console.log('  audit trail by type:');
for (const [type, count] of Object.entries(types)) {
  console.log('   ', type + ':', count);
}
assert(types.share >= 3, 'has shares');
assert(types.block_reward >= 2, 'has rewards');
assert(types.pool_fee >= 1, 'has fees');
assert(types.payout_created >= 2, 'has payouts created');
assert(types.payout_broadcast >= 1, 'has payouts broadcast');
assert(types.payout_confirmed >= 1, 'has payouts confirmed');
assert(types.payout_failed >= 1, 'has payouts failed');
assert(types.payout_reversed >= 1, 'has payouts reversed');
console.log('  PASS\n');

closeDb();
resetDb();
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

console.log('=== ALL AUDIT LOG TESTS PASSED ===');
