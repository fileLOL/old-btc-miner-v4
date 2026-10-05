const { getDb } = require('./db');
const AuditLog = require('./audit');

class PayoutMonitor {
  constructor(config, btcCliFn) {
    this.config = config;
    this.btcCli = btcCliFn;
    this.interval = null;
  }

  start() {
    if (this.interval) {
      return;
    }
    
    console.log(`[PayoutMonitor] Starting monitor (interval: ${this.config.PAYOUT_MONITOR_INTERVAL_MS}ms)`);
    
    this.interval = setInterval(() => {
      this.checkBroadcastPayouts().catch(err => {
        console.error('[PayoutMonitor] Error:', err.message);
      });
    }, this.config.PAYOUT_MONITOR_INTERVAL_MS);

    this.checkBroadcastPayouts().catch(err => {
      console.error('[PayoutMonitor] Initial check error:', err.message);
    });
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[PayoutMonitor] Stopped');
    }
  }

  async checkBroadcastPayouts() {
    const db = getDb();
    
    const broadcastPayouts = db.prepare(`
      SELECT id, account_id, amount_sat, txid, broadcast_at
      FROM payouts
      WHERE status = 'broadcast'
      ORDER BY broadcast_at ASC
    `).all();

    if (broadcastPayouts.length === 0) {
      return;
    }

    console.log(`[PayoutMonitor] Checking ${broadcastPayouts.length} broadcast payouts`);

    for (const payout of broadcastPayouts) {
      try {
        await this.checkTransaction(payout);
      } catch (error) {
        console.error(`[PayoutMonitor] Error checking payout #${payout.id} (${payout.txid}):`, error.message);
      }
    }
  }

  async checkTransaction(payout) {
    const db = getDb();

    try {
      const txInfo = await this.btcCli(['gettransaction', payout.txid]);
      const txData = JSON.parse(txInfo);

      if (txData.confirmations && txData.confirmations > 0) {
        console.log(`[PayoutMonitor] Payout #${payout.id} confirmed (${txData.confirmations} confirmations): ${payout.txid}`);
        
        db.prepare(`
          UPDATE payouts
          SET status = 'confirmed', confirmed_at = ?
          WHERE id = ?
        `).run(Date.now(), payout.id);

        db.prepare(`
          UPDATE balances
          SET pending_sat = pending_sat - ?
          WHERE account_id = ?
        `).run(payout.amount_sat, payout.account_id);

        AuditLog.logPayoutConfirmed(payout.id, payout.account_id);

      } else if (txData.confirmations === 0) {
        const broadcastAge = Date.now() - payout.broadcast_at;
        const maxAge = 24 * 60 * 60 * 1000;

        if (broadcastAge > maxAge) {
          console.log(`[PayoutMonitor] Payout #${payout.id} stuck in mempool for ${Math.round(broadcastAge / 3600000)}h, marking as failed`);
          
          db.prepare(`
            UPDATE payouts
            SET status = 'failed', error = ?
            WHERE id = ?
          `).run('Transaction stuck in mempool', payout.id);

          db.prepare(`
            UPDATE balances
            SET confirmed_sat = confirmed_sat + ?
            WHERE account_id = ?
          `).run(payout.amount_sat, payout.account_id);

          AuditLog.logPayoutFailed(payout.id, payout.account_id, 'Transaction stuck in mempool');
          AuditLog.logPayoutReversed(payout.id, payout.account_id, payout.amount_sat, 'Transaction stuck in mempool');
        }

      } else if (txData.confirmations < 0) {
        console.log(`[PayoutMonitor] Payout #${payout.id} conflicted: ${payout.txid}`);
        
        db.prepare(`
          UPDATE payouts
          SET status = 'failed', error = ?
          WHERE id = ?
        `).run('Transaction conflicted', payout.id);

        db.prepare(`
          UPDATE balances
          SET confirmed_sat = confirmed_sat + ?
          WHERE account_id = ?
        `).run(payout.amount_sat, payout.account_id);

        AuditLog.logPayoutFailed(payout.id, payout.account_id, 'Transaction conflicted');
        AuditLog.logPayoutReversed(payout.id, payout.account_id, payout.amount_sat, 'Transaction conflicted');
      }

    } catch (error) {
      if (error.message && error.message.includes('Invalid or non-wallet transaction id')) {
        console.log(`[PayoutMonitor] Payout #${payout.id} transaction not found, marking as failed`);
        
        db.prepare(`
          UPDATE payouts
          SET status = 'failed', error = ?
          WHERE id = ?
        `).run('Transaction not found', payout.id);

        db.prepare(`
          UPDATE balances
          SET confirmed_sat = confirmed_sat + ?
          WHERE account_id = ?
        `).run(payout.amount_sat, payout.account_id);

        AuditLog.logPayoutFailed(payout.id, payout.account_id, 'Transaction not found');
        AuditLog.logPayoutReversed(payout.id, payout.account_id, payout.amount_sat, 'Transaction not found');
      } else {
        throw error;
      }
    }
  }
}

module.exports = PayoutMonitor;
