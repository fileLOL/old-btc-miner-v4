const { getDb } = require('./db');

class AuditLog {
  static log(type, accountId, amountSat, details = {}) {
    const db = getDb();
    
    try {
      db.prepare(`
        INSERT INTO audit_log (type, account_id, amount_sat, details, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(type, accountId, amountSat, JSON.stringify(details), Date.now());
    } catch (error) {
      console.error('[AuditLog] Failed to write log:', error.message);
    }
  }

  static logShare(accountId, jobId, difficulty) {
    this.log('share', accountId, 0, {
      job_id: jobId,
      difficulty: difficulty
    });
  }

  static logBlockReward(accountId, blockId, height, rewardSat) {
    this.log('block_reward', accountId, rewardSat, {
      block_id: blockId,
      height: height
    });
  }

  static logPoolFee(blockId, feeSat) {
    this.log('pool_fee', 0, feeSat, {
      block_id: blockId
    });
  }

  static logPayoutCreated(payoutId, accountId, amountSat, address) {
    this.log('payout_created', accountId, -amountSat, {
      payout_id: payoutId,
      address: address
    });
  }

  static logPayoutBroadcast(payoutId, accountId, txid) {
    this.log('payout_broadcast', accountId, 0, {
      payout_id: payoutId,
      txid: txid
    });
  }

  static logPayoutConfirmed(payoutId, accountId) {
    this.log('payout_confirmed', accountId, 0, {
      payout_id: payoutId
    });
  }

  static logPayoutFailed(payoutId, accountId, error) {
    this.log('payout_failed', accountId, 0, {
      payout_id: payoutId,
      error: error
    });
  }

  static logPayoutReversed(payoutId, accountId, amountSat, reason) {
    this.log('payout_reversed', accountId, amountSat, {
      payout_id: payoutId,
      reason: reason
    });
  }

  static getAuditTrail(accountId = null, limit = 100) {
    const db = getDb();
    
    let query = `
      SELECT id, type, account_id, amount_sat, details, created_at
      FROM audit_log
    `;
    
    const params = [];
    
    if (accountId) {
      query += ' WHERE account_id = ?';
      params.push(accountId);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    
    return db.prepare(query).all(...params);
  }

  static getAccountSummary(accountId) {
    const db = getDb();
    
    const shares = db.prepare(`
      SELECT COUNT(*) as count
      FROM audit_log
      WHERE account_id = ? AND type = 'share'
    `).get(accountId);

    const rewards = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(amount_sat), 0) as total
      FROM audit_log
      WHERE account_id = ? AND type = 'block_reward'
    `).get(accountId);

    const payouts = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(ABS(amount_sat)), 0) as total
      FROM audit_log
      WHERE account_id = ? AND type = 'payout_created'
    `).get(accountId);

    const failures = db.prepare(`
      SELECT COUNT(*) as count
      FROM audit_log
      WHERE account_id = ? AND type = 'payout_failed'
    `).get(accountId);

    return {
      shares: shares.count,
      block_rewards: {
        count: rewards.count,
        total_sat: rewards.total
      },
      payouts: {
        count: payouts.count,
        total_sat: payouts.total
      },
      failed_payouts: failures.count
    };
  }

  static getPoolSummary() {
    const db = getDb();
    
    const totalShares = db.prepare(`
      SELECT COUNT(*) as count
      FROM audit_log
      WHERE type = 'share'
    `).get();

    const totalRewards = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(amount_sat), 0) as total
      FROM audit_log
      WHERE type = 'block_reward'
    `).get();

    const totalFees = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(amount_sat), 0) as total
      FROM audit_log
      WHERE type = 'pool_fee'
    `).get();

    const totalPayouts = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(ABS(amount_sat)), 0) as total
      FROM audit_log
      WHERE type = 'payout_created'
    `).get();

    return {
      total_shares: totalShares.count,
      total_rewards: {
        count: totalRewards.count,
        total_sat: totalRewards.total
      },
      total_fees: {
        count: totalFees.count,
        total_sat: totalFees.total
      },
      total_payouts: {
        count: totalPayouts.count,
        total_sat: totalPayouts.total
      }
    };
  }
}

module.exports = AuditLog;
