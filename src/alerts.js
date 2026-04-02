// alerts.js — formats and sends Telegram alerts

const axios = require('axios');
const cfg   = require('./config');
const path  = require('path');
const fs    = require('fs');

const GIF_PATH = path.join(__dirname, '..', 'assets', 'tenor Vibin.gif');

// Cached Telegram file_id after first upload
let cachedGifFileId = process.env.GIF_FILE_ID || null;

// ── Core send helpers ──────────────────────────────────────────────────────

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

async function sendWithGif(caption) {
  if (!cachedGifFileId) {
    try {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('chat_id', cfg.TELEGRAM_CHAT_ID);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      form.append('animation', fs.createReadStream(GIF_PATH), {
        filename: 'vibin.gif',
        contentType: 'image/gif',
      });

      const resp = await axios.post(
        `https://api.telegram.org/bot${cfg.TELEGRAM_BOT_TOKEN}/sendAnimation`,
        form,
        { headers: form.getHeaders(), timeout: 20000 }
      );

      cachedGifFileId = resp.data?.result?.animation?.file_id
                     || resp.data?.result?.document?.file_id
                     || null;

      console.log('[GIF] First send complete. file_id cached:', cachedGifFileId);
      return;

    } catch (e) {
      console.error('[GIF] Upload failed, falling back to text:', e.message);
      await send(caption);
      return;
    }
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${cfg.TELEGRAM_BOT_TOKEN}/sendAnimation`,
      {
        chat_id:    cfg.TELEGRAM_CHAT_ID,
        animation:  cachedGifFileId,
        caption,
        parse_mode: 'HTML',
      },
      { timeout: 8000 }
    );
  } catch (e) {
    console.error('[GIF] Send with file_id failed, falling back to text:', e.message);
    await send(caption);
  }
}

// ── Alert formatters ───────────────────────────────────────────────────────

/**
 * Jail alert — includes slashing penalty breakdown.
 * Shows both downtime and double-sign penalty amounts in TX so you
 * know exactly what to reimburse delegators depending on slash type.
 */
function jailAlert(stats) {
  const downtimePct         = (stats.slashFractionDowntime   * 100).toFixed(4);
  const doubleSignPct       = (stats.slashFractionDoubleSign * 100).toFixed(4);
  const downtimePenaltyTX   = stats.stakedTX * stats.slashFractionDowntime;
  const doubleSignPenaltyTX = stats.stakedTX * stats.slashFractionDoubleSign;

  const hasPenaltyInfo = stats.slashFractionDoubleSign > 0 || stats.slashFractionDowntime > 0;

  let penaltyBlock = '';
  if (hasPenaltyInfo) {
    penaltyBlock =
      `\n<b>⚠️ Slashing Penalties (on ${fmt(stats.stakedTX)} TX staked)</b>\n` +
      `Downtime slash:     ${downtimePct}% = <b>${fmt(downtimePenaltyTX)} TX</b>\n` +
      `Double-sign slash:  ${doubleSignPct}% = <b>${fmt(doubleSignPenaltyTX)} TX</b>\n` +
      `\nVerify slash type on chain to confirm exact delegator reimbursement amount.\n`;
  }

  return send(
    `🚨 <b>VALIDATOR JAILED!</b>\n\n` +
    `Your validator has been jailed.\n` +
    `Status: <b>${stats.status}</b>\n` +
    `Staked: ${fmt(stats.stakedTX)} TX\n` +
    `Rank: #${stats.rank}\n` +
    penaltyBlock +
    `\n⚡ Action required immediately!`
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
  const moved = previous - current;
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

/** 4-hour digest — always sent with the Coreezy sloth gif */
function summaryAlert(stats, prev) {
  const stakedDelta = prev ? stats.stakedTX - prev.stakedTX : 0;
  const delDelta    = prev ? stats.delegators - prev.delegators : 0;
  const rankDelta   = prev ? prev.rank - stats.rank : 0;
  const aprDelta    = (prev && prev.aprDelegator >= 0 && stats.aprDelegator >= 0)
    ? stats.aprDelegator - prev.aprDelegator : null;

  const stakedArrow = stakedDelta > 0 ? '▲' : stakedDelta < 0 ? '▼' : '─';
  const delArrow    = delDelta    > 0 ? '▲' : delDelta    < 0 ? '▼' : '─';
  const rankArrow   = rankDelta   > 0 ? '▲' : rankDelta   < 0 ? '▼' : '─';

  const uptimeStr      = stats.uptimePct    >= 0 ? `${stats.uptimePct.toFixed(3)}%`    : 'N/A';
  const missedStr      = stats.missedBlocks >= 0 ? `${stats.missedBlocks}`             : 'N/A';
  const aprGrossStr    = stats.aprGross     >= 0 ? `${stats.aprGross.toFixed(2)}%`     : 'N/A';
  const aprDelStr      = stats.aprDelegator >= 0 ? `${stats.aprDelegator.toFixed(2)}%` : 'N/A';

  // APR delta indicator — show if it moved since last report
  const aprDeltaStr = aprDelta !== null && Math.abs(aprDelta) >= 0.01
    ? ` (${aprDelta > 0 ? '+' : ''}${aprDelta.toFixed(2)}%)`
    : '';

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

    `<b>Staking APR</b>\n` +
    `Gross:      ${aprGrossStr}\n` +
    `Delegator:  ${aprDelStr}${aprDeltaStr}\n\n` +

    `Stake. Vibe. Grow. 🌴`;

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

function fmt(n) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (abs >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
}

module.exports = {
  jailAlert, offlineAlert, uptimeAlert, missedBlocksAlert,
  rankChangeAlert, stakedChangeAlert, delegatorChangeAlert,
  votingPowerAlert, summaryAlert, startupAlert,
};
