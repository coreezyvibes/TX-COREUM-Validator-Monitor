// fetcher.js — tries indexer API first (if configured), falls back to LCD
// Uses multiple LCD endpoints with automatic fallback

const axios  = require('axios');
const cfg    = require('./config');
const crypto = require('crypto');

// ── Bech32 utility (no external deps) ─────────────────────────────────────

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const ret = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function convertBits(data, fromBits, toBits, pad = true) {
  let acc = 0, bits = 0;
  const result = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) result.push((acc << (toBits - bits)) & maxv);
  return result;
}

function bech32Encode(hrp, words) {
  const checksumInput = [...bech32HrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(checksumInput) ^ 1;
  const checksum = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >> (5 * (5 - i))) & 31);
  return hrp + '1' + [...words, ...checksum].map(d => BECH32_CHARSET[d]).join('');
}

function toConsAddress(addrBytes) {
  const words = convertBits(Array.from(addrBytes), 8, 5);
  return bech32Encode('corevalcons', words);
}

function getCandidateConsAddresses(consensusPubkey) {
  const keyBytes = Buffer.from(consensusPubkey.key, 'base64');
  const hash1    = crypto.createHash('sha256').update(keyBytes).digest();
  const addr1    = toConsAddress(hash1.slice(0, 20));
  const amino    = Buffer.concat([Buffer.from([0x16, 0x24, 0xde, 0x64, 0x20]), keyBytes]);
  const hash2    = crypto.createHash('sha256').update(amino).digest();
  const addr2    = toConsAddress(hash2.slice(0, 20));
  const hash3a   = crypto.createHash('sha256').update(keyBytes).digest();
  const hash3b   = crypto.createHash('ripemd160').update(hash3a).digest();
  const addr3    = toConsAddress(hash3b);
  return [addr1, addr2, addr3];
}

// ── LCD endpoints ──────────────────────────────────────────────────────────

const LCD_ENDPOINTS = [
  cfg.LCD_URL,
  'https://archive.rest.mainnet-1.tx.org',
  'https://full-node.mainnet-1.coreum.dev:1317',
  'https://rest.cosmos.directory/coreum',
];

async function lcdGet(path) {
  const errors = [];
  for (const base of LCD_ENDPOINTS) {
    if (!base) continue;
    try {
      const resp = await axios.get(`${base}${path}`, { timeout: 8000 });
      return resp;
    } catch (e) {
      errors.push(`${base}: ${e.message}`);
    }
  }
  throw new Error(`All LCD endpoints failed:\n${errors.join('\n')}`);
}

// ── Main entry ─────────────────────────────────────────────────────────────

async function fetchValidatorStats(prevStats) {
  if (cfg.INDEXER_API_URL) {
    try {
      const headers = cfg.INDEXER_API_KEY ? { 'x-api-key': cfg.INDEXER_API_KEY } : {};
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
    console.log('[FETCHER] No INDEXER_API_URL configured — using LCD');
  }

  return fetchFromLCD(prevStats);
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
    source: 'indexer', moniker, stakedTX: stakedUcore / cfg.DENOM_DIVISOR,
    delegators, rank, jailed, status, missedBlocks, uptimePct, commission, votingPowerPct,
    slashFractionDoubleSign: 0,
    slashFractionDowntime:   0,
    aprGross:          -1,
    aprDelegator:      -1,
    inflationRate:     -1,
    txPriceUsd:        -1,
    monthlyRevenueUsd: -1,
    communityPoolUcore: -1,
    communityPoolTime:  -1,
  };
}

// ── TX price from CoinGecko (free tier, no key needed) ────────────────────

async function fetchTxPrice() {
  try {
    const resp = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=coreum&vs_currencies=usd',
      { timeout: 8000 }
    );
    const price = resp.data?.coreum?.usd;
    if (!price) throw new Error('No price returned');
    console.log(`[FETCHER] TX price: $${price}`);
    return price;
  } catch (e) {
    console.warn('[FETCHER] TX price fetch failed:', e.message);
    return -1;
  }
}

// ── APR calculation ────────────────────────────────────────────────────────
//
// Total APR = inflation APR + fee APR
//
// Inflation APR:
//   annual_provisions × (1 - community_tax) / bonded_tokens
//
// Fee APR:
//   The community pool receives community_tax% of all fees.
//   By tracking the community pool growth between checks we can derive
//   the total fee flow and back-calculate what stakers earn from fees.
//
//   community_pool_delta = pool_now - pool_prev
//   elapsed_hours        = (time_now - time_prev) / 3_600_000
//   total_fees_per_hour  = community_pool_delta / community_tax / elapsed_hours
//   staker_fee_rewards   = total_fees_per_hour × (1 - community_tax) × 8760
//   fee_apr              = staker_fee_rewards / bonded_tokens × 100

async function fetchAPRAndInflation(commissionRate, prevStats) {
  try {
    const [provisionsResp, inflationResp, distResp, poolResp, communityPoolResp] =
      await Promise.all([
        lcdGet('/cosmos/mint/v1beta1/annual_provisions'),
        lcdGet('/cosmos/mint/v1beta1/inflation'),
        lcdGet('/cosmos/distribution/v1beta1/params'),
        lcdGet('/cosmos/staking/v1beta1/pool'),
        lcdGet('/cosmos/distribution/v1beta1/community_pool'),
      ]);

    const annualProvisions  = parseFloat(provisionsResp.data?.annual_provisions || 0);
    const inflationRate     = parseFloat(inflationResp.data?.inflation           || 0);
    const communityTax      = parseFloat(distResp.data?.params?.community_tax   || 0);
    const bondedTokens      = parseFloat(poolResp.data?.pool?.bonded_tokens     || 0);

    // Community pool current value (ucore)
    const poolCoins         = communityPoolResp.data?.pool || [];
    const ucoreEntry        = poolCoins.find(c => c.denom === 'ucore' || c.denom === 'utcore');
    const communityPoolNow  = ucoreEntry ? parseFloat(ucoreEntry.amount) : -1;
    const communityPoolTime = Date.now();

    if (bondedTokens === 0) throw new Error('bondedTokens is zero');

    // Inflation APR — stable baseline
    const inflationAPR = (annualProvisions * (1 - communityTax)) / bondedTokens * 100;

    // Fee APR — derived from community pool growth since last check
    let feeAPR = 0;
    if (
      prevStats &&
      prevStats.communityPoolUcore > 0 &&
      communityPoolNow > 0 &&
      prevStats.communityPoolTime > 0 &&
      communityTax > 0
    ) {
      const poolDelta    = communityPoolNow - prevStats.communityPoolUcore;
      const elapsedMs    = communityPoolTime - prevStats.communityPoolTime;
      const elapsedHours = elapsedMs / (1000 * 60 * 60);

      if (poolDelta > 0 && elapsedHours > 0.05) {
        // Back-calculate total fee flow from community pool share
        const totalFeesPerHour   = poolDelta / communityTax / elapsedHours;
        const stakerFeePerHour   = totalFeesPerHour * (1 - communityTax);
        const annualStakerFees   = stakerFeePerHour * 8760;
        feeAPR = (annualStakerFees / bondedTokens) * 100;
        console.log(
          `[FETCHER] Fee APR — pool delta: ${(poolDelta/1e6).toFixed(2)} TX` +
          ` over ${elapsedHours.toFixed(2)}h` +
          ` | fee APR: ${feeAPR.toFixed(2)}%`
        );
      }
    }

    const aprGross     = inflationAPR + feeAPR;
    const aprDelegator = aprGross * (1 - commissionRate);

    console.log(
      `[FETCHER] APR — inflation: ${inflationAPR.toFixed(2)}%` +
      ` | fees: ${feeAPR.toFixed(2)}%` +
      ` | total gross: ${aprGross.toFixed(2)}%` +
      ` | delegator: ${aprDelegator.toFixed(2)}%`
    );

    return {
      aprGross,
      aprDelegator,
      inflationRate:      inflationRate * 100,
      communityPoolUcore: communityPoolNow,
      communityPoolTime,
    };
  } catch (e) {
    console.warn('[FETCHER] APR calculation failed:', e.message);
    return {
      aprGross:           -1,
      aprDelegator:       -1,
      inflationRate:      -1,
      communityPoolUcore: -1,
      communityPoolTime:  -1,
    };
  }
}

// ── LCD fetch ──────────────────────────────────────────────────────────────

async function fetchFromLCD(prevStats) {
  // 1. Validator details
  const valResp = await lcdGet(
    `/cosmos/staking/v1beta1/validators/${cfg.VALIDATOR_ADDRESS}`
  );
  const val = valResp.data.validator;
  console.log(`[FETCHER] Using LCD endpoint: ${valResp.config?.url?.split('/cosmos')[0]}`);

  // 2. All validators for rank
  let rank = 0;
  try {
    const allResp = await lcdGet(
      `/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=200`
    );
    const sorted = (allResp.data.validators || [])
      .sort((a, b) => parseFloat(b.tokens) - parseFloat(a.tokens));
    rank = sorted.findIndex(v => v.operator_address === cfg.VALIDATOR_ADDRESS) + 1;
    console.log(`[FETCHER] Rank: #${rank} of ${sorted.length}`);
  } catch (e) {
    console.warn('[FETCHER] Rank fetch failed:', e.message);
  }

  // 3. Delegator count
  let delegators = 0;
  try {
    const delResp = await lcdGet(
      `/cosmos/staking/v1beta1/validators/${cfg.VALIDATOR_ADDRESS}/delegations?pagination.limit=1&pagination.count_total=true`
    );
    const total = parseInt(delResp.data?.pagination?.total || 0);
    if (total > 0) {
      delegators = total;
      console.log(`[FETCHER] Delegators: ${delegators}`);
    } else {
      let nextKey = null;
      let page = 0;
      do {
        const qs = nextKey
          ? `?pagination.limit=200&pagination.key=${encodeURIComponent(nextKey)}`
          : `?pagination.limit=200`;
        const pageResp = await lcdGet(
          `/cosmos/staking/v1beta1/validators/${cfg.VALIDATOR_ADDRESS}/delegations${qs}`
        );
        const entries = pageResp.data?.delegation_responses || [];
        delegators += entries.length;
        nextKey = pageResp.data?.pagination?.next_key || null;
        page++;
        if (page >= 10) break;
      } while (nextKey);
      console.log(`[FETCHER] Delegators (paginated): ${delegators}`);
    }
  } catch (e) {
    console.warn('[FETCHER] Delegator count failed:', e.message);
    delegators = 0;
  }

  // 4. Missed blocks + uptime + slashing params
  let missedBlocks            = -1;
  let uptimePct               = -1;
  let slashFractionDoubleSign = 0;
  let slashFractionDowntime   = 0;

  try {
    const candidates = getCandidateConsAddresses(val.consensus_pubkey);
    let signingInfo = null;

    for (const consAddress of candidates) {
      try {
        const resp = await lcdGet(`/cosmos/slashing/v1beta1/signing_infos/${consAddress}`);
        const info = resp.data?.val_signing_info;
        if (info && info.address) {
          console.log(`[FETCHER] ✅ Signing info found with address: ${consAddress}`);
          signingInfo = info;
          break;
        }
      } catch (e) {
        console.log(`[FETCHER] ❌ ${consAddress} — ${e.message.split('\n')[0]}`);
      }
    }

    if (signingInfo) {
      missedBlocks = parseInt(signingInfo.missed_blocks_counter || 0);
      console.log(`[FETCHER] Missed blocks: ${missedBlocks}`);
    }

    try {
      const paramsResp = await lcdGet(`/cosmos/slashing/v1beta1/params`);
      const params     = paramsResp.data?.params || {};
      const windowSize = parseInt(params.signed_blocks_window || 0);

      slashFractionDoubleSign = parseFloat(params.slash_fraction_double_sign || 0);
      slashFractionDowntime   = parseFloat(params.slash_fraction_downtime    || 0);

      if (windowSize > 0 && missedBlocks >= 0) {
        uptimePct = ((windowSize - missedBlocks) / windowSize) * 100;
        console.log(`[FETCHER] Uptime: ${uptimePct.toFixed(2)}% (window: ${windowSize})`);
      }
    } catch (e) {
      console.warn('[FETCHER] Slashing params fetch failed:', e.message);
    }
  } catch (e) {
    console.warn(`[FETCHER] Signing info fetch failed: ${e.message}`);
  }

  // 5. APR (inflation + fees) and TX price — fetched in parallel
  const commissionRate = parseFloat(val.commission?.commission_rates?.rate || 0.05);
  const stakedUcore    = parseFloat(val.tokens || 0);
  const stakedTX       = stakedUcore / cfg.DENOM_DIVISOR;

  const [aprResult, txPriceUsd] = await Promise.all([
    fetchAPRAndInflation(commissionRate, prevStats),
    fetchTxPrice(),
  ]);

  const { aprGross, aprDelegator, inflationRate, communityPoolUcore, communityPoolTime } = aprResult;

  // Monthly revenue = validator's annual commission earnings / 12 × price
  let monthlyRevenueUsd = -1;
  if (aprGross >= 0 && txPriceUsd > 0) {
    const annualRevenueTX = stakedTX * (aprGross / 100) * commissionRate;
    monthlyRevenueUsd     = (annualRevenueTX / 12) * txPriceUsd;
    console.log(
      `[FETCHER] Monthly revenue: $${monthlyRevenueUsd.toFixed(2)}` +
      ` (${annualRevenueTX.toFixed(0)} TX/yr @ $${txPriceUsd})`
    );
  }

  return {
    source:                  'lcd',
    moniker:                 val.description?.moniker || 'Unknown',
    stakedTX,
    delegators,
    rank,
    jailed:                  val.jailed === true,
    status:                  val.status,
    missedBlocks,
    uptimePct,
    commission:              commissionRate * 100,
    votingPowerPct:          0,
    slashFractionDoubleSign,
    slashFractionDowntime,
    aprGross,
    aprDelegator,
    inflationRate,
    txPriceUsd,
    monthlyRevenueUsd,
    communityPoolUcore,
    communityPoolTime,
  };
}

module.exports = { fetchValidatorStats };
