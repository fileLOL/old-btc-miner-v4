const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { getDb, closeDb, resetDb } = require('../lib/db');
const PayoutProcessor = require('../lib/payout-processor');
const AuditLog = require('../lib/audit');
const accountManager = require('../lib/account-manager');

(async () => {
console.log('=== PAYOUT RECOVERY TEST ===\n');

const TEST_DB = path.join(__dirname, '..', 'data', 'test_payout_recovery.db');
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const db = getDb(TEST_DB);

// Mock Bitcoin CLI
const mockTransactions = new Map();
const mockBtcCli = async (args) => {
  if (args[0] === 'gettransaction') {
    const txid = args[1];
    if (mockTransactions.has(txid)) {
      return JSON.stringify(mockTransactions.get(txid));
    }
    throw new Error('Invalid or non-wallet transaction id');
  }
  if (args[0] === 'sendtoaddress') {
    throw new Error('DRY RUN: sendtoaddress not executed');
  }
  throw new Error('Unknown command: ' + args[0]);
};

const config = {
  MIN_PAYOUT_SAT: 50000,
  MAX_PAYOUT_SAT: 100000000,
  PAYOUT_DRY_RUN: true,
  PAYOUT_PENDING_TIMEOUT_MS: 3600000 // 1 hora
};

const processor = new PayoutProcessor(config, mockBtcCli);

console.log('[1] Create test account with balance');
const addr = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const acc = accountManager.getOrCreateAccount(addr);
db.prepare('UPDATE balances SET confirmed_sat = ? WHERE account_id = ?').run(200000, acc.account_id);

const bal = accountManager.getBalance(acc.account_id);
assert.strictEqual(bal.confirmed_sat, 200000, 'account has 200000 sat');
console.log('  account_id:', acc.account_id);
console.log('  confirmed_sat:', bal.confirmed_sat);
console.log('  PASS\n');

console.log('[2] Simulate server restart before sendtoaddress (no txid)');
// Crear payout pending antiguo sin txid
const now = Date.now();
const oldTime = now - (2 * 3600000); // 2 horas atrás
db.prepare(`INSERT INTO payouts (account_id, amount_sat, status, created_at)
  VALUES (?, ?, 'pending', ?)`).run(acc.account_id, 100000, oldTime);

// Restar balance (simulando que el payout ya restó el balance antes del crash)
db.prepare('UPDATE balances SET confirmed_sat = confirmed_sat - ? WHERE account_id = ?')
  .run(100000, acc.account_id);

const balBefore = accountManager.getBalance(acc.account_id);
assert.strictEqual(balBefore.confirmed_sat, 100000, 'balance reduced before crash');

const payout1 = db.prepare('SELECT * FROM payouts WHERE status = ?').get('pending');
assert.strictEqual(payout1.txid, null, 'no txid (crash before sendtoaddress)');
console.log('  payout_id:', payout1.id);
console.log('  amount_sat:', payout1.amount_sat);
console.log('  txid:', payout1.txid);
console.log('  created_at:', new Date(payout1.created_at).toISOString());
console.log('  PASS\n');

console.log('[3] Run recovery (should revert balance)');
const result1 = await processor.recoverStalePendingPayouts();
assert.strictEqual(result1.recovered, 1, '1 payout recovered');
assert.strictEqual(result1.reverted, 1, '1 payout reverted');
assert.strictEqual(result1.broadcast, 0, '0 payouts to broadcast');

// Verificar que el balance fue restaurado
const balAfter1 = accountManager.getBalance(acc.account_id);
assert.strictEqual(balAfter1.confirmed_sat, 200000, 'balance restored');

// Verificar que el payout fue marcado como failed
const payout1After = db.prepare('SELECT * FROM payouts WHERE id = ?').get(payout1.id);
assert.strictEqual(payout1After.status, 'failed', 'payout marked as failed');
assert(payout1After.error.includes('no txid'), 'error mentions no txid');
console.log('  recovered:', result1.recovered);
console.log('  reverted:', result1.reverted);
console.log('  balance restored:', balAfter1.confirmed_sat);
console.log('  payout status:', payout1After.status);
console.log('  PASS\n');

console.log('[4] Simulate server restart after sendtoaddress (with txid, tx exists)');
// Crear payout pending antiguo con txid
const oldTime2 = now - (2 * 3600000);
const txid = 'txid_exists_' + Date.now();
db.prepare(`INSERT INTO payouts (account_id, amount_sat, txid, status, created_at)
  VALUES (?, ?, ?, 'pending', ?)`).run(acc.account_id, 50000, txid, oldTime2);

// Restar balance
db.prepare('UPDATE balances SET confirmed_sat = confirmed_sat - ? WHERE account_id = ?')
  .run(50000, acc.account_id);

// Simular que la transacción existe en Bitcoin Core
mockTransactions.set(txid, {
  txid: txid,
  confirmations: 0,
  time: now - 3600000,
  details: [{ address: addr, amount: 0.0005 }]
});

const balBefore2 = accountManager.getBalance(acc.account_id);
assert.strictEqual(balBefore2.confirmed_sat, 150000, 'balance reduced');

const payout2 = db.prepare('SELECT * FROM payouts WHERE txid = ?').get(txid);
assert.strictEqual(payout2.status, 'pending', 'payout is pending');
console.log('  payout_id:', payout2.id);
console.log('  txid:', payout2.txid);
console.log('  PASS\n');

console.log('[5] Run recovery (should move to broadcast)');
const result2 = await processor.recoverStalePendingPayouts();
assert.strictEqual(result2.recovered, 1, '1 payout recovered');
assert.strictEqual(result2.reverted, 0, '0 payouts reverted');
assert.strictEqual(result2.broadcast, 1, '1 payout to broadcast');

// Verificar que el balance NO fue restaurado
const balAfter2 = accountManager.getBalance(acc.account_id);
assert.strictEqual(balAfter2.confirmed_sat, 150000, 'balance not restored (correct)');

// Verificar que el payout fue marcado como broadcast
const payout2After = db.prepare('SELECT * FROM payouts WHERE id = ?').get(payout2.id);
assert.strictEqual(payout2After.status, 'broadcast', 'payout marked as broadcast');
assert(payout2After.broadcast_at > 0, 'broadcast_at set');
console.log('  recovered:', result2.recovered);
console.log('  broadcast:', result2.broadcast);
console.log('  balance unchanged:', balAfter2.confirmed_sat);
console.log('  payout status:', payout2After.status);
console.log('  PASS\n');

console.log('[6] Simulate server restart after sendtoaddress (with txid, tx NOT found)');
// Crear payout pending antiguo con txid que no existe
const oldTime3 = now - (2 * 3600000);
const txidNotFound = 'txid_not_found_' + Date.now();
db.prepare(`INSERT INTO payouts (account_id, amount_sat, txid, status, created_at)
  VALUES (?, ?, ?, 'pending', ?)`).run(acc.account_id, 75000, txidNotFound, oldTime3);

// Restar balance
db.prepare('UPDATE balances SET confirmed_sat = confirmed_sat - ? WHERE account_id = ?')
  .run(75000, acc.account_id);

// NO añadir la transacción al mock (simula que no existe)

const balBefore3 = accountManager.getBalance(acc.account_id);
assert.strictEqual(balBefore3.confirmed_sat, 75000, 'balance reduced');

const payout3 = db.prepare('SELECT * FROM payouts WHERE txid = ?').get(txidNotFound);
assert.strictEqual(payout3.status, 'pending', 'payout is pending');
console.log('  payout_id:', payout3.id);
console.log('  txid:', payout3.txid);
console.log('  PASS\n');

console.log('[7] Run recovery (should revert balance)');
const result3 = await processor.recoverStalePendingPayouts();
assert.strictEqual(result3.recovered, 1, '1 payout recovered');
assert.strictEqual(result3.reverted, 1, '1 payout reverted');
assert.strictEqual(result3.broadcast, 0, '0 payouts to broadcast');

// Verificar que el balance fue restaurado
const balAfter3 = accountManager.getBalance(acc.account_id);
assert.strictEqual(balAfter3.confirmed_sat, 150000, 'balance restored');

// Verificar que el payout fue marcado como failed
const payout3After = db.prepare('SELECT * FROM payouts WHERE id = ?').get(payout3.id);
assert.strictEqual(payout3After.status, 'failed', 'payout marked as failed');
assert(payout3After.error.includes('not found'), 'error mentions not found');
console.log('  recovered:', result3.recovered);
console.log('  reverted:', result3.reverted);
console.log('  balance restored:', balAfter3.confirmed_sat);
console.log('  payout status:', payout3After.status);
console.log('  PASS\n');

console.log('[8] Verify no double payment (payout recent, not recovered)');
// Crear payout pending RECIENTE (no antiguo)
const recentTime = now - (30 * 60000); // 30 minutos atrás
db.prepare(`INSERT INTO payouts (account_id, amount_sat, status, created_at)
  VALUES (?, ?, 'pending', ?)`).run(acc.account_id, 25000, recentTime);

db.prepare('UPDATE balances SET confirmed_sat = confirmed_sat - ? WHERE account_id = ?')
  .run(25000, acc.account_id);

const balBefore4 = accountManager.getBalance(acc.account_id);
assert.strictEqual(balBefore4.confirmed_sat, 125000, 'balance reduced');

const result4 = await processor.recoverStalePendingPayouts();
assert.strictEqual(result4.recovered, 0, '0 payouts recovered (recent)');

// Verificar que el balance NO fue restaurado
const balAfter4 = accountManager.getBalance(acc.account_id);
assert.strictEqual(balAfter4.confirmed_sat, 125000, 'balance not restored (correct)');

// Verificar que el payout sigue pending
const payout4After = db.prepare('SELECT * FROM payouts WHERE created_at = ?').get(recentTime);
assert.strictEqual(payout4After.status, 'pending', 'payout still pending (not recovered)');
console.log('  recovered:', result4.recovered);
console.log('  balance unchanged:', balAfter4.confirmed_sat);
console.log('  payout status:', payout4After.status);
console.log('  PASS\n');

console.log('[9] Verify audit log entries');
const auditTrail = AuditLog.getAuditTrail(acc.account_id, 100);
const recoveryLogs = auditTrail.filter(l => 
  l.details && (l.details.includes('Recovery') || l.type.includes('payout'))
);
assert(recoveryLogs.length > 0, 'recovery logs exist');
console.log('  audit entries:', recoveryLogs.length);
console.log('  PASS\n');

console.log('[10] Verify final state');
const finalBal = accountManager.getBalance(acc.account_id);
const finalPayouts = db.prepare('SELECT status, COUNT(*) as count FROM payouts GROUP BY status').all();
console.log('  final balance:', finalBal.confirmed_sat);
console.log('  payouts by status:');
finalPayouts.forEach(p => console.log('   ', p.status + ':', p.count));
console.log('  PASS\n');

closeDb();
resetDb();
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

console.log('=== ALL PAYOUT RECOVERY TESTS PASSED ===');
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
