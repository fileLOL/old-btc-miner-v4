const { getDb } = require('./db');
const { validateAddress } = require('./address-validator');
const AuditLog = require('./audit');

class PayoutProcessor {
  constructor(config, btcCliFn) {
    this.config = config;
    this.btcCli = btcCliFn;
    this.processing = new Set();
  }

  async processAllPayouts() {
    const db = getDb();
    const eligibleAccounts = db.prepare(`
      SELECT a.account_id, a.btc_address, b.confirmed_sat
      FROM accounts a
      JOIN balances b ON a.account_id = b.account_id
      WHERE b.confirmed_sat >= ?
        AND a.account_id NOT IN (
          SELECT account_id FROM payouts WHERE status IN ('pending', 'broadcast')
        )
    `).all(this.config.MIN_PAYOUT_SAT);

    console.log(`[PayoutProcessor] Found ${eligibleAccounts.length} eligible accounts`);

    const results = [];
    for (const account of eligibleAccounts) {
      if (this.processing.has(account.account_id)) {
        console.log(`[PayoutProcessor] Skipping account ${account.account_id} (already processing)`);
        continue;
      }

      try {
        const result = await this.processPayout(account.account_id);
        results.push(result);
      } catch (error) {
        console.error(`[PayoutProcessor] Error processing account ${account.account_id}:`, error.message);
        results.push({
          account_id: account.account_id,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  async processPayout(accountId) {
    if (this.processing.has(accountId)) {
      throw new Error('Account is already being processed');
    }

    this.processing.add(accountId);

    try {
      const db = getDb();
      const account = db.prepare('SELECT account_id, btc_address FROM accounts WHERE account_id = ?').get(accountId);
      
      if (!account) {
        throw new Error('Account not found');
      }

      const validation = validateAddress(account.btc_address);
      if (!validation.valid) {
        throw new Error('Invalid Bitcoin address in database: ' + account.btc_address);
      }

      const balance = db.prepare('SELECT confirmed_sat FROM balances WHERE account_id = ?').get(accountId);
      
      if (!balance || balance.confirmed_sat < this.config.MIN_PAYOUT_SAT) {
        throw new Error('Insufficient balance');
      }

      const hasActivePayout = db.prepare(`
        SELECT COUNT(*) as count FROM payouts 
        WHERE account_id = ? AND status IN ('pending', 'broadcast')
      `).get(accountId);

      if (hasActivePayout.count > 0) {
        throw new Error('Account already has pending/broadcast payout');
      }

      const amountSat = Math.min(balance.confirmed_sat, this.config.MAX_PAYOUT_SAT);
      const amountBtc = (amountSat / 1e8).toFixed(8);

      const payoutId = db.prepare(`
        INSERT INTO payouts (account_id, amount_sat, status, created_at)
        VALUES (?, ?, 'pending', ?)
      `).run(accountId, amountSat, Date.now()).lastInsertRowid;

      AuditLog.logPayoutCreated(payoutId, accountId, amountSat, account.btc_address);

      db.prepare('UPDATE balances SET confirmed_sat = confirmed_sat - ? WHERE account_id = ?').run(amountSat, accountId);

      console.log(`[PayoutProcessor] Created payout #${payoutId} for account ${accountId}: ${amountSat} sat (${amountBtc} BTC) to ${account.btc_address}`);

      if (this.config.PAYOUT_DRY_RUN) {
        console.log(`[PayoutProcessor] DRY RUN: Would send ${amountBtc} BTC to ${account.btc_address}`);
        db.prepare(`UPDATE payouts SET status = 'dry_run', txid = ?, updated_at = ? WHERE id = ?`)
          .run(`dry_run_${Date.now()}`, Date.now(), payoutId);
        db.prepare('UPDATE balances SET confirmed_sat = confirmed_sat + ? WHERE account_id = ?').run(amountSat, accountId);
        
        return {
          account_id: accountId,
          payout_id: payoutId,
          success: true,
          dry_run: true,
          amount_sat: amountSat,
          amount_btc: amountBtc,
          address: account.btc_address,
          txid: null
        };
      }

      try {
        const txid = await this.btcCli(['sendtoaddress', account.btc_address, amountBtc]);
        
        db.prepare(`UPDATE payouts SET status = 'broadcast', txid = ?, broadcast_at = ? WHERE id = ?`)
          .run(txid.trim(), Date.now(), payoutId);

        AuditLog.logPayoutBroadcast(payoutId, accountId, txid.trim());

        console.log(`[PayoutProcessor] Broadcast payout #${payoutId}: txid ${txid}`);

        return {
          account_id: accountId,
          payout_id: payoutId,
          success: true,
          dry_run: false,
          amount_sat: amountSat,
          amount_btc: amountBtc,
          address: account.btc_address,
          txid: txid.trim()
        };

      } catch (sendError) {
        console.error(`[PayoutProcessor] sendtoaddress failed for payout #${payoutId}:`, sendError.message);
        
        db.prepare('UPDATE balances SET confirmed_sat = confirmed_sat + ? WHERE account_id = ?').run(amountSat, accountId);
        db.prepare(`UPDATE payouts SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`)
          .run(sendError.message, Date.now(), payoutId);

        AuditLog.logPayoutFailed(payoutId, accountId, sendError.message);
        AuditLog.logPayoutReversed(payoutId, accountId, amountSat, 'sendtoaddress failed');

        throw sendError;
      }

    } finally {
      this.processing.delete(accountId);
    }
  }

  getPendingPayouts() {
    const db = getDb();
    return db.prepare(`
      SELECT p.id, p.account_id, a.btc_address, p.amount_sat, p.status, p.created_at, p.broadcast_at, p.txid
      FROM payouts p
      JOIN accounts a ON p.account_id = a.account_id
      WHERE p.status IN ('pending', 'broadcast')
      ORDER BY p.created_at ASC
    `).all();
  }

  async recoverStalePendingPayouts() {
    const db = getDb();
    const timeout = this.config.PAYOUT_PENDING_TIMEOUT_MS || 3600000; // 1 hora default
    const cutoffTime = Date.now() - timeout;

    const stalePayouts = db.prepare(`
      SELECT id, account_id, amount_sat, txid, created_at
      FROM payouts
      WHERE status = 'pending' AND created_at < ?
    `).all(cutoffTime);

    if (stalePayouts.length === 0) {
      return { recovered: 0, reverted: 0, broadcast: 0 };
    }

    console.log(`[PayoutProcessor] Recovering ${stalePayouts.length} stale pending payouts`);

    let recovered = 0;
    let reverted = 0;
    let broadcast = 0;

    for (const payout of stalePayouts) {
      try {
        if (payout.txid) {
          // Tiene txid, verificar si la transacción existe
          try {
            const txInfo = await this.btcCli(['gettransaction', payout.txid]);
            const txData = JSON.parse(txInfo);
            
            // Transacción existe, pasar a broadcast
            db.prepare(`
              UPDATE payouts 
              SET status = 'broadcast', broadcast_at = ?, updated_at = ?
              WHERE id = ?
            `).run(txData.time || Date.now(), Date.now(), payout.id);

            AuditLog.logPayoutBroadcast(payout.id, payout.account_id, payout.txid);
            console.log(`[PayoutProcessor] Recovered payout #${payout.id} to broadcast (txid: ${payout.txid})`);
            broadcast++;
          } catch (error) {
            if (error.message && error.message.includes('Invalid or non-wallet transaction id')) {
              // Transacción no existe, revertir balance
              db.prepare('UPDATE balances SET confirmed_sat = confirmed_sat + ? WHERE account_id = ?')
                .run(payout.amount_sat, payout.account_id);
              
              db.prepare(`
                UPDATE payouts 
                SET status = 'failed', error = ?, updated_at = ?
                WHERE id = ?
              `).run('Transaction not found during recovery', Date.now(), payout.id);

              AuditLog.logPayoutFailed(payout.id, payout.account_id, 'Transaction not found during recovery');
              AuditLog.logPayoutReversed(payout.id, payout.account_id, payout.amount_sat, 'Recovery: tx not found');
              console.log(`[PayoutProcessor] Reverted payout #${payout.id} (tx not found)`);
              reverted++;
            } else {
              throw error;
            }
          }
        } else {
          // No tiene txid, nunca se ejecutó sendtoaddress
          db.prepare('UPDATE balances SET confirmed_sat = confirmed_sat + ? WHERE account_id = ?')
            .run(payout.amount_sat, payout.account_id);
          
          db.prepare(`
            UPDATE payouts 
            SET status = 'failed', error = ?, updated_at = ?
            WHERE id = ?
          `).run('Recovery: no txid (server restart before sendtoaddress)', Date.now(), payout.id);

          AuditLog.logPayoutFailed(payout.id, payout.account_id, 'Recovery: no txid');
          AuditLog.logPayoutReversed(payout.id, payout.account_id, payout.amount_sat, 'Recovery: no txid');
          console.log(`[PayoutProcessor] Reverted payout #${payout.id} (no txid)`);
          reverted++;
        }
        recovered++;
      } catch (error) {
        console.error(`[PayoutProcessor] Error recovering payout #${payout.id}:`, error.message);
      }
    }

    console.log(`[PayoutProcessor] Recovery complete: ${recovered} processed, ${reverted} reverted, ${broadcast} to broadcast`);
    return { recovered, reverted, broadcast };
  }

  getPayoutStats() {
    const db = getDb();
    
    const pending = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount_sat), 0) as total FROM payouts WHERE status = 'pending'").get();
    const broadcast = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount_sat), 0) as total FROM payouts WHERE status = 'broadcast'").get();
    const confirmed = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount_sat), 0) as total FROM payouts WHERE status = 'confirmed'").get();
    const failed = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount_sat), 0) as total FROM payouts WHERE status = 'failed'").get();

    return {
      pending: { count: pending.count, total_sat: pending.total },
      broadcast: { count: broadcast.count, total_sat: broadcast.total },
      confirmed: { count: confirmed.count, total_sat: confirmed.total },
      failed: { count: failed.count, total_sat: failed.total }
    };
  }
}

module.exports = PayoutProcessor;
