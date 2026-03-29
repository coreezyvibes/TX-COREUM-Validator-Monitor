// fetcher.js — tries indexer API first (if configured), falls back to LCD

const axios = require('axios');
const cfg   = require('./config');

async function fetchValidatorStats() {

  // ── Try indexer first (only if INDEXER_API_URL is configured) ────────────
  if (cfg.INDEXER_API_URL) {
    try {
      const headers = cfg.INDEXER_API_KEY
        ? { 'x-api-key': cfg.INDEXER_API_KEY }
        : {};

      const resp = await axios.get(
        `${cfg.INDEXER_API_URL}/validator/${cfg.VALIDATOR_ADDRESS}`,
        { headers, timeout: 8000 }
      );

      const d = resp.data;
      if (d && (d.tokens !== undefined || d.staked !== undefined)) {
        return normaliseIndexer(d);
      }
      throw new Error('Indexer returned empty or unexpected data');

    } catch (indexerErr) {
      console.warn(`[FETCHER] Indexer failed (${indexerErr.message}), falling back to LCD...`);
    }
  } else {
    console.log('[FETCHER] No INDEXER_API_URL configured — using public LCD');
  }

  return fetchFromLCD();
}

function normaliseIndexer(d) {
  const stakedUcore    = parseFloat(d.tokens        || d.staked_tokens || 0);
  const delegators     = parseInt(d.delegator_count || d.delegators    || 0);
  const rank           = parseInt(d.rank            || 0);
  const jailed         = d.jailed === true || d.status === 'BOND_STATUS_UNBONDING';
  const status         = d.status || 'BOND_STATUS_BONDED';
  const missedBlocks   = parseInt(d.missed_blocks_counter || d.missed_blocks || 0);
  const uptimePct      = parseFloat(d.uptime_percentage   || d.uptime        || 100);
  const commission     = parseFloat(d.commission_rate     || d.commission    || 0.05) * 100;
  const votingPowerPct = parseFloat(d.voting_power_percentage || d.voting_power_pct || 0);
  const moniker        = d.moniker || d.description?.moniker || 'Unknown';

  return {
    source: 'indexer',
    moniker, stakedTX: stakedUcore / cfg.DENOM_DIVISOR,
    delegators, rank, jailed, status,
    missedBlocks, uptimePct, commission, votingPowerPct,
  };
}

async function fetchFromLCD() {
  // 1. Validator details
  const valResp = await axios.get(
    `${cfg.LCD_URL}/cosmos/staking/v1beta1/validators/${cfg.VALIDATOR_ADDRESS}`,
    { timeout: 8000 }
  );
  const val = valResp.data.validator;

  // 2. All validators (for rank)
  let rank = 0;
  try {
    const allResp = await axios.get(
      `${cfg.LCD_URL}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=200`,
      { timeout: 8000 }
    );
    const sorted = (allResp.data.validators || [])
      .sort((a, b) => parseFloat(b.tokens) - parseFloat(a.tokens));
    rank = sorted.findIndex(v => v.operator_address === cfg.VALIDATOR_ADDRESS) + 1;
  } catch (_) {}

  // 3. Delegator count — paginate through all pages and count
  let delegators = 0;
  try {
    let nextKey = null;
    let page = 0;
    do {
      const url = nextKey
        ? `${cfg.LCD_URL}/cosmos/staking/v1beta1/validators/${cfg.VALIDATOR_ADDRESS}/delegations?pagination.limit=200&pagination.key=${encodeURIComponent(nextKey)}`
        : `${cfg.LCD_URL}/cosmos/staking/v1beta1/validators/${cfg.VALIDATOR_ADDRESS}/delegations?pagination.limit=200`;

      const delResp = await axios.get(url, { timeout: 10000 });
      const entries = delResp.data?.delegation_responses || [];
      delegators += entries.length;
      nextKey = delResp.data?.pagination?.next_key || null;
      page++;

      // Safety cap — shouldn't need more than 10 pages at 200 each
      if (page >= 10) break;
    } while (nextKey);

    console.log(`[FETCHER] Delegator count: ${delegators}`);
  } catch (e) {
    console.warn('[FETCHER] Delegator count failed:', e.message);
  }

  const stakedUcore    = parseFloat(val.tokens || 0);
  const commissionRate = parseFloat(val.commission?.commission_rates?.rate || 0.05);

  return {
    source:         'lcd',
    moniker:        val.description?.moniker || 'Unknown',
    stakedTX:       stakedUcore / cfg.DENOM_DIVISOR,
    delegators,
    rank,
    jailed:         val.jailed === true,
    status:         val.status,
    missedBlocks:   -1,
    uptimePct:      -1,
    commission:     commissionRate * 100,
    votingPowerPct: 0,
  };
}

module.exports = { fetchValidatorStats };
