// alerts.js — formats and sends Telegram alerts

const axios = require('axios');
const cfg   = require('./config');

// ── Sloth gif — hardcoded, always sent with the 4-hour digest ─────────────
// Telegram sendAnimation accepts direct GIF URLs from media.giphy.com
const SLOTH_GIF_URL = 'https://media.giphy.com/media/l0HlBO7eyXzSZkJri/giphy.gif';

// ── Core send helpers ──────────────────────────────────────────────────────

/** Send a plain text message */
async function send(message) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${cfg.TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: cfg.TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' },
      { timeout: 5000 }
    );
  } catch (e) {
    console.error('[TG] sendMessage failed:', e.message);
  }
}

/**
 * Send a GIF with a caption (used for the 4-hour digest).
 * Falls back to plain sendMessage if animation fails.
 */
async function sendWithGif(caption) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${cfg.TELEGRAM_BOT_TOKEN}/sendAnimation`,
      {
        chat_id:    cfg.TELEGRAM_CHAT_ID,
        animation:  SLOTH_GIF_URL,
        caption,
        parse_mode: 'HTML',
      },
      { timeout: 8000 }
    );
  } catch (e) {
    console.error('[TG] sendAnimation failed, falling back to text:', e.message);
    // Fallback — send as plain message without gif
    await send(caption);
  }
}

// ── Alert formatters ───────────────────────────────────────────────────────

function jailAlert(stats) {
  return send(
    `🚨 <b>VALIDATOR JAILED!</b>\n\n` +
    `Your validator has been jailed.\n` +
    `Status: <b>${stats.status}</b>\n` +
    `Staked: ${fmt(stats.stakedTX)} TX\n` +
    `Rank: #${stats.rank}\n\n` +
    `⚡ Action required immediately!`
  );
}

function offlineAlert(error) {
  return send(
    `🔴 <b>VALIDATOR UNREACHABLE</b>\n\n` +
    `Could not fetch validator data from any source.\n` +
    `Error: <code>${error}</code>\n\n` +
    `Check your node immediately.`
  );
}

function uptimeAlert(current, previous) {
  const direction = current < previous ? '📉' : '📈';
  return send(
    `⚠️ <b>Uptime Drop Alert</b>\n\n` +
    `${direction} Uptime: <b>${current.toFixed(3)}%</b> (was ${previous.toFixed(3)}%)\n` +
    `Threshold: ${cfg.UPTIME_ALERT_THRESHOLD}%\n\n` +
    `Monitor your node — missed blocks detected.`
  );
}

function missedBlocksAlert(missed, previous) {
  const delta = missed - previous;
  return send(
    `⚠️ <b>Missed Blocks Alert</b>\n\n` +
    `Missed blocks counter: <b>${missed}</b>\n` +
    `Change: +${delta} since last check\n\n` +
    `Check your node health.`
  );
}

function rankChangeAlert(current, previous) {
  const moved = previous - current; // positive = improved
  const emoji = moved > 0 ? '🟢' : '🔴';
  const dir   = moved > 0 ? `up ${moved}` : `down ${Math.abs(moved)}`;
  return send(
    `${emoji} <b>Rank Changed</b>\n\n` +
    `Now <b>#${current}</b> (was #${previous})\n` +
    `Moved ${dir} position${Math.abs(moved) > 1 ? 's' : ''}`
  );
}

function stakedChangeAlert(currentTX, previousTX) {
  const delta = currentTX - previousTX;
  const emoji = delta > 0 ? '🟢' : '🔴';
  const dir   = delta > 0 ? '+' : '';
  return send(
    `${emoji} <b>Staked TX Changed</b>\n\n` +
    `Total staked: <b>${fmt(currentTX)} TX</b>\n` +
    `Change: ${dir}${fmt(delta)} TX`
  );
}

function delegatorChangeAlert(current, previous) {
  const delta = current - previous;
  const emoji = delta > 0 ? '🟢' : '🔴';
  const dir   = delta > 0
    ? `+${delta} new delegator${delta > 1 ? 's' : ''}`
    : `${delta} delegator${Math.abs(delta) > 1 ? 's' : ''} left`;
  return send(
    `${emoji} <b>Delegator Count Changed</b>\n\n` +
    `Delegators: <b>${current}</b> (was ${previous})\n` +
    `${dir}`
  );
}

function votingPowerAlert(current, previous) {
  const delta   = current - previous;
  const pctMove = previous > 0
    ? ((Math.abs(delta) / previous) * 100).toFixed(1)
    : '∞';
  const emoji = delta > 0 ? '🟢' : '🔴';
  return send(
    `${emoji} <b>Voting Power Changed</b>\n\n` +
    `Voting power: <b>${current.toFixed(4)}%</b> (was ${previous.toFixed(4)}%)\n` +
    `Change: ${delta > 0 ? '+' : ''}${delta.toFixed(4)}% (${pctMove}% relative move)`
  );
}

/** 4-hour digest — always sent with the sloth gif */
function summaryAlert(stats, prev) {
  const stakedDelta = prev ? stats.stakedTX - prev.stakedTX : 0;
  const delDelta    = prev ? stats.delegators - prev.delegators : 0;
  const rankDelta   = prev ? prev.rank - stats.rank : 0; // positive = improved

  const stakedArrow = stakedDelta > 0 ? '▲' : stakedDelta < 0 ? '▼' : '─';
  const delArrow    = delDelta    > 0 ? '▲' : delDelta    < 0 ? '▼' : '─';
  const rankArrow   = rankDelta   > 0 ? '▲' : rankDelta   < 0 ? '▼' : '─';

  const uptimeStr  = stats.uptimePct    >= 0 ? `${stats.uptimePct.toFixed(3)}%` : 'N/A';
  const missedStr  = stats.missedBlocks >= 0 ? `${stats.missedBlocks}`          : 'N/A';

  const caption =
    `🦥 <b>Validator Report — ${new Date().toUTCString()}</b>\n\n` +

    `<b>Status</b>\n` +
    `${stats.jailed ? '🚨 JAILED' : '✅ Online &amp; Bonded'}\n\n` +

    `<b>Rank</b>\n` +
    `${rankArrow} #${stats.rank}` +
    `${prev && rankDelta !== 0 ? ` (${rankDelta > 0 ? '+' : ''}${rankDelta} vs last report)` : ''}\n\n` +

    `<b>Staked</b>\n` +
    `${stakedArrow} ${fmt(stats.stakedTX)} TX` +
    `${prev && stakedDelta !== 0 ? ` (${stakedDelta > 0 ? '+' : ''}${fmt(stakedDelta)})` : ''}\n\n` +

    `<b>Delegators</b>\n` +
    `${delArrow} ${stats.delegators}` +
    `${prev && delDelta !== 0 ? ` (${delDelta > 0 ? '+' : ''}${delDelta})` : ''}\n\n` +

    `<b>Uptime</b>  ${uptimeStr}\n` +
    `<b>Missed Blocks</b>  ${missedStr}\n` +
    `<b>Commission</b>  ${stats.commission.toFixed(1)}%\n\n` +

    `Stake. Vibe. Grow. 🌴`;

  // Always send with the sloth gif — not configurable
  return sendWithGif(caption);
}

function startupAlert() {
  return send(
    `🦥 <b>Validator Monitor Started</b>\n\n` +
    `Checking every ${cfg.CHECK_INTERVAL_MS / 60000} minutes\n` +
    `Digest every ${cfg.SUMMARY_INTERVAL_HOURS} hours\n\n` +
    `Watching: <code>${cfg.VALIDATOR_ADDRESS}</code>`
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (abs >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
}

module.exports = {
  jailAlert,
  offlineAlert,
  uptimeAlert,
  missedBlocksAlert,
  rankChangeAlert,
  stakedChangeAlert,
  delegatorChangeAlert,
  votingPowerAlert,
  summaryAlert,
  startupAlert,
};
