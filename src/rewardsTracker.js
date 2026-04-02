// rewardsTracker.js — tracks real validator reward accumulation over time
//
// Strategy:
//   Every check we record { amountUcore, timestamp } from the distribution module.
//   On the next check we diff the two readings to get a real earn rate.
//   We keep up to 144 snapshots (24hrs at 10min intervals) for a rolling window.
//   APR is calculated from the most recent 24hr window for stability.
//
// State is persisted to a JSON file so it survives restarts.
// Falls back to projection-based APR until at least 2 snapshots exist.

const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'rewards_state.json');
const MAX_SNAPSHOTS = 144; // 24 hours at 10-min intervals

// ── State ──────────────────────────────────────────────────────────────────

let snapshots = []; // [{ amountUcore: number, timestamp: number }]

function load() {
  try {
    // Ensure data directory exists
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const data = JSON.parse(raw);
      snapshots = Array.isArray(data.snapshots) ? data.snapshots : [];
      console.log(`[REWARDS] Loaded ${snapshots.length} reward snapshots from disk`);
    } else {
      console.log('[REWARDS] No existing reward state — starting fresh');
    }
  } catch (e) {
    console.warn('[REWARDS] Failed to load state file:', e.message);
    snapshots = [];
  }
}

function save() {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ snapshots }, null, 2));
  } catch (e) {
    console.warn('[REWARDS] Failed to save state file:', e.message);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Record a new reward snapshot.
 * amountUcore — total outstanding + withdrawn rewards in ucore
 * We use cumulative_rewards from the distribution module which is monotonically
 * increasing, so deltas are always positive and meaningful.
 */
function recordSnapshot(amountUcore) {
  const now = Date.now();
  snapshots.push({ amountUcore, timestamp: now });

  // Keep only the most recent MAX_SNAPSHOTS
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots = snapshots.slice(snapshots.length - MAX_SNAPSHOTS);
  }

  save();
  console.log(`[REWARDS] Snapshot recorded: ${amountUcore.toFixed(0)} ucore (${snapshots.length} total)`);
}

/**
 * Calculate real APR from the rolling reward window.
 *
 * Returns { aprGross, aprDelegator, source } where source is either
 * 'actual' (real earnings) or 'projection' (fallback).
 *
 * aprGross    — annualised gross return on total staked TX
 * aprDelegator — gross × (1 - commission)
 *
 * @param {number} stakedUcore     — validator's total staked tokens in ucore
 * @param {number} commissionRate  — commission as a decimal (e.g. 0.05)
 * @param {number} projectionAPR   — fallback projection gross APR (as %)
 */
function calculateAPR(stakedUcore, commissionRate, projectionAPR) {
  if (snapshots.length < 2) {
    console.log('[REWARDS] Not enough snapshots yet — using projection APR');
    return {
      aprGross:     projectionAPR,
      aprDelegator: projectionAPR >= 0 ? projectionAPR * (1 - commissionRate) : -1,
      source:       'projection',
    };
  }

  // Use oldest available snapshot vs latest for the most stable window
  const oldest = snapshots[0];
  const newest = snapshots[snapshots.length - 1];

  const deltaUcore   = newest.amountUcore - oldest.amountUcore;
  const deltaMs      = newest.timestamp   - oldest.timestamp;
  const deltaHours   = deltaMs / (1000 * 60 * 60);

  if (deltaUcore <= 0 || deltaHours < 0.1) {
    console.log('[REWARDS] Delta too small or negative — using projection APR');
    return {
      aprGross:     projectionAPR,
      aprDelegator: projectionAPR >= 0 ? projectionAPR * (1 - commissionRate) : -1,
      source:       'projection',
    };
  }

  // Annualise: rewards per hour × 8760 hours
  const annualRewardsUcore = (deltaUcore / deltaHours) * 8760;

  // Gross APR = annual rewards / staked (both in ucore)
  // Note: outstanding_rewards already has commission deducted — it's the
  // delegator share. To get gross we need to gross it up by commission.
  // delegator_rewards = gross_rewards × (1 - commission)
  // gross_rewards     = delegator_rewards / (1 - commission)
  const annualDelegatorUcore = annualRewardsUcore;
  const annualGrossUcore     = commissionRate < 1
    ? annualDelegatorUcore / (1 - commissionRate)
    : annualDelegatorUcore;

  const aprGross     = stakedUcore > 0 ? (annualGrossUcore / stakedUcore) * 100 : -1;
  const aprDelegator = aprGross >= 0   ? aprGross * (1 - commissionRate)         : -1;

  console.log(
    `[REWARDS] Real APR from ${deltaHours.toFixed(1)}hr window:` +
    ` delta=${(deltaUcore / 1e6).toFixed(2)} TX` +
    ` | gross APR=${aprGross.toFixed(2)}%` +
    ` | delegator APR=${aprDelegator.toFixed(2)}%`
  );

  return { aprGross, aprDelegator, source: 'actual' };
}

// Load state on module init
load();

module.exports = { recordSnapshot, calculateAPR };
