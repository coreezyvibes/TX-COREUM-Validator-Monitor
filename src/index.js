// index.js — Coreezy Validator Monitor
// Polls validator status every 10 minutes, fires Telegram alerts on anomalies
// and sends a full digest every 4 hours.

require('dotenv').config();

const cfg     = require('./config');
const fetcher = require('./fetcher');
const alerts  = require('./alerts');

// ── State ──────────────────────────────────────────────────────────────────
let lastStats        = null;   // previous check snapshot
let summarySnapshot  = null;   // snapshot at last summary (for delta comparison)
let lastSummaryTime  = null;   // when we last sent the summary
let consecutiveFails = 0;

// ── Startup ────────────────────────────────────────────────────────────────

async function start() {
  console.log('═══════════════════════════════════════════');
  console.log('   🦥 Coreezy Validator Monitor — Starting');
  console.log('═══════════════════════════════════════════');
  console.log(`Validator:  ${cfg.VALIDATOR_ADDRESS}`);
  console.log(`Check every: ${cfg.CHECK_INTERVAL_MS / 60000} min`);
  console.log(`Summary every: ${cfg.SUMMARY_INTERVAL_HOURS}h`);

  // Fetch current stats immediately on startup and send as the opening digest
  console.log('Fetching current validator stats...');
  try {
    const initialStats = await fetcher.fetchValidatorStats();
    console.log(`[STARTUP] Rank: #${initialStats.rank} | Staked: ${initialStats.stakedTX.toFixed(0)} TX | Delegators: ${initialStats.delegators}`);

    // Send full gif digest as startup message — no previous snapshot yet
    await alerts.summaryAlert(initialStats, null);

    // Seed state so first scheduled check has a baseline to diff against
    lastStats       = { ...initialStats };
    summarySnapshot = { ...initialStats };
    lastSummaryTime = new Date();

  } catch (e) {
    console.error('[STARTUP] Failed to fetch initial stats:', e.message);
    await alerts.offlineAlert(e.message);
  }

  // Schedule recurring checks
  setInterval(check, cfg.CHECK_INTERVAL_MS);
}

// ── Main check ─────────────────────────────────────────────────────────────

async function check() {
  const now = new Date();
  console.log(`\n[${now.toISOString()}] Running validator check...`);

  // ── Fetch ────────────────────────────────────────────────────────────────
  let stats;
  try {
    stats = await fetcher.fetchValidatorStats();
    consecutiveFails = 0;
  } catch (e) {
    consecutiveFails++;
    console.error(`[CHECK] Fetch failed (attempt ${consecutiveFails}):`, e.message);

    // Only alert on first failure to avoid spam
    if (consecutiveFails === 1) {
      await alerts.offlineAlert(e.message);
    }
    return;
  }

  console.log(`[CHECK] Source: ${stats.source}`);
  console.log(`[CHECK] Rank: #${stats.rank} | Staked: ${stats.stakedTX.toFixed(0)} TX | Delegators: ${stats.delegators} | Jailed: ${stats.jailed} | Uptime: ${stats.uptimePct >= 0 ? stats.uptimePct.toFixed(3) + '%' : 'N/A'} | Missed: ${stats.missedBlocks >= 0 ? stats.missedBlocks : 'N/A'}`);

  // ── Alert checks (only if we have a previous reading to compare) ─────────

  // 🚨 Jail check — always alert regardless of previous state
  if (stats.jailed && (!lastStats || !lastStats.jailed)) {
    console.log('[ALERT] ❌ Validator is JAILED!');
    await alerts.jailAlert(stats);
  }

  if (lastStats) {
    // Uptime drop
    if (
      stats.uptimePct >= 0 &&
      stats.uptimePct < cfg.UPTIME_ALERT_THRESHOLD &&
      stats.uptimePct < lastStats.uptimePct
    ) {
      console.log(`[ALERT] Uptime drop: ${stats.uptimePct.toFixed(3)}%`);
      await alerts.uptimeAlert(stats.uptimePct, lastStats.uptimePct);
    }

    // Missed blocks increase beyond threshold
    if (
      stats.missedBlocks >= 0 &&
      lastStats.missedBlocks >= 0 &&
      stats.missedBlocks - lastStats.missedBlocks >= cfg.MISSED_BLOCKS_ALERT
    ) {
      console.log(`[ALERT] Missed blocks jumped: ${lastStats.missedBlocks} → ${stats.missedBlocks}`);
      await alerts.missedBlocksAlert(stats.missedBlocks, lastStats.missedBlocks);
    }

    // Rank change
    if (stats.rank > 0 && lastStats.rank > 0 && stats.rank !== lastStats.rank) {
      const change = Math.abs(stats.rank - lastStats.rank);
      if (change >= cfg.RANK_CHANGE_ALERT) {
        console.log(`[ALERT] Rank changed: #${lastStats.rank} → #${stats.rank}`);
        await alerts.rankChangeAlert(stats.rank, lastStats.rank);
      }
    }

    // Staked TX change
    const stakedDelta = Math.abs(stats.stakedTX - lastStats.stakedTX);
    if (stakedDelta >= cfg.STAKED_CHANGE_ALERT_TX) {
      console.log(`[ALERT] Staked changed by ${stakedDelta.toFixed(0)} TX`);
      await alerts.stakedChangeAlert(stats.stakedTX, lastStats.stakedTX);
    }

    // Delegator count change — alert on any change
    if (stats.delegators !== lastStats.delegators && lastStats.delegators > 0) {
      console.log(`[ALERT] Delegators: ${lastStats.delegators} → ${stats.delegators}`);
      await alerts.delegatorChangeAlert(stats.delegators, lastStats.delegators);
    }

    // Voting power significant change
    if (stats.votingPowerPct > 0 && lastStats.votingPowerPct > 0) {
      const vpChangePct = lastStats.votingPowerPct > 0
        ? (Math.abs(stats.votingPowerPct - lastStats.votingPowerPct) / lastStats.votingPowerPct) * 100
        : 0;
      if (vpChangePct >= cfg.VOTING_POWER_CHANGE_PCT) {
        console.log(`[ALERT] Voting power changed by ${vpChangePct.toFixed(1)}%`);
        await alerts.votingPowerAlert(stats.votingPowerPct, lastStats.votingPowerPct);
      }
    }
  }

  // ── 4-hour summary ───────────────────────────────────────────────────────
  const shouldSendSummary = !lastSummaryTime
    || (now - lastSummaryTime) >= cfg.SUMMARY_INTERVAL_HOURS * 60 * 60 * 1000;

  if (shouldSendSummary) {
    console.log('[SUMMARY] Sending 4-hour digest...');
    await alerts.summaryAlert(stats, summarySnapshot);
    summarySnapshot = { ...stats };
    lastSummaryTime = now;
  }

  // ── Save state ───────────────────────────────────────────────────────────
  lastStats = { ...stats };
}

// ── Run ────────────────────────────────────────────────────────────────────

start().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
