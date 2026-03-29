// config.js — all configuration loaded from environment variables
// See .env.example for descriptions and setup instructions

function required(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`❌ Missing required environment variable: ${name}`);
    console.error(`   See .env.example for setup instructions.`);
    process.exit(1);
  }
  return val;
}

module.exports = {
  // ── Validator ─────────────────────────────────────────────────────────────
  // Your TX/Coreum operator address (corevaloper1...)
  VALIDATOR_ADDRESS: required('VALIDATOR_ADDRESS'),

  // ── Data sources ──────────────────────────────────────────────────────────
  // Optional: point to a Coreezy-compatible indexer API for richer data.
  // If not set, the monitor falls back to the public LCD node automatically.
  INDEXER_API_URL: process.env.INDEXER_API_URL || '',
  INDEXER_API_KEY: process.env.INDEXER_API_KEY || '',

  // Public TX/Coreum LCD node — works out of the box, no account needed
  LCD_URL: process.env.LCD_URL || 'https://tx-chain-rest.publicnode.com',

  // ── Polling ───────────────────────────────────────────────────────────────
  CHECK_INTERVAL_MS:      parseInt(process.env.CHECK_INTERVAL_MS      || '600000'), // 10 min
  SUMMARY_INTERVAL_HOURS: parseInt(process.env.SUMMARY_INTERVAL_HOURS || '4'),

  // ── Alert thresholds ──────────────────────────────────────────────────────
  UPTIME_ALERT_THRESHOLD: parseFloat(process.env.UPTIME_ALERT_THRESHOLD || '99.0'),
  VOTING_POWER_CHANGE_PCT: parseFloat(process.env.VOTING_POWER_CHANGE_PCT || '5.0'),
  STAKED_CHANGE_ALERT_TX:  parseFloat(process.env.STAKED_CHANGE_ALERT_TX  || '50000'),
  MISSED_BLOCKS_ALERT:     parseInt(process.env.MISSED_BLOCKS_ALERT       || '10'),
  RANK_CHANGE_ALERT:       parseInt(process.env.RANK_CHANGE_ALERT         || '1'),

  // ── Telegram ──────────────────────────────────────────────────────────────
  // Uses the COREZ Buy Bot — see README for how to get your token and chat ID
  TELEGRAM_BOT_TOKEN: required('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_CHAT_ID:   required('TELEGRAM_CHAT_ID'),

  // ── Chain ─────────────────────────────────────────────────────────────────
  DENOM_DIVISOR: 1_000_000, // ucore → TX
};
