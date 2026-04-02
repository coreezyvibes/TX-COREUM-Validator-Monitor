// fetcher.js — tries indexer API first (if configured), falls back to LCD
// Uses multiple LCD endpoints with automatic fallback
// LCD path derives consensus address and fetches real uptime % + missed blocks + APR

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

  // Method 1: Raw SHA256[0:20] — correct for Coreum/TX
  const hash1 = crypto.createHash('sha256').update(keyBytes).digest();
  const addr1 = toConsAddress(hash1.slice(0, 20));

  // Method 2: Amino-prefixed SHA256 (fallback)
  const amino = Buffer.concat([Buffer.from([0x16, 0x24, 0xde, 0x64, 0x20]), keyBytes]);
  const hash2 = crypto.createHash('sha256').update(amino).digest();
  const addr2 = toConsAddress(hash2.slice(0, 20));

  // Method 3: SHA256 + RIPEMD160 (fallback)
  const hash3a = crypto.createHash('sha256').update(keyBytes).digest();
  const hash3b = crypto.createHash('ripemd160').update(hash3a).digest();
  const addr3  = toConsAddress(hash3b);

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

async function fetchValidatorStats() {
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
    source: 'indexer', moniker, stakedTX: stakedUcore / cfg.DENOM_DIVISOR,
    delegators, rank, jailed, status, missedBlocks, uptimePct, commission, votingPowerPct,
    slashFractionDoubleSign: 0,
    slashFractionDowntime:   0,
    aprGross:                -1,
    aprDelegator:            -1,
  };
}

// ── APR calculation ────────────────────────────────────────────────────────
//
// APR = (inflation × (1 - community_tax)) / bonded_ratio
//
// aprGross     = validator's gross APR before commission
// aprDelegator = what delegators actually earn after commission is taken
//
// All values fetched live from chain so they update automatically with
// governance changes to inflation, community tax, or bonded ratio.

async function fetchAPR(commissionRate) {
  try {
    const [inflationResp, distResp, poolResp] = await Promise.all([
      lcdGet('/cosmos/mint/v1beta1/inflation'),
      lcdGet('/cosmos/distribution/v1beta1/params'),
      lcdGet('/cosmos/staking/v1beta1/pool'),
    ]);

    const inflation     = parseFloat(inflationResp.data?.inflation      || 0);
    const communityTax  = parseFloat(distResp.data?.params?.community_tax || 0);
    const bondedTokens  = parseFloat(poolResp.data?.pool?.bonded_tokens  || 0);
    const notBonded     = parseFloat(poolResp.data?.pool?.not_bonded_tokens || 0);
    const totalTokens   = bondedTokens + notBonded;
    const bondedRatio   = totalTokens > 0 ? bondedTokens / totalTokens : 0;

    if (bondedRatio === 0) throw new Error('bondedRatio is zero');

    const aprGross     = (inflation * (1 - communityTax)) / bondedRatio;
    const aprDelegator = aprGross * (1 - commissionRate);

    console.log(`[FETCHER] APR — inflation: ${(inflation*100).toFixed(2)}% | community tax: ${(communityTax*100).toFixed(2)}% | bonded ratio: ${(bondedRatio*100).toFixed(2)}% | gross APR: ${(aprGross*100).toFixed(2)}% | delegator APR: ${(aprDelegator*100).toFixed(2)}%`);

    return { aprGross: aprGross * 100, aprDelegator: aprDelegator * 100 };
  } catch (e) {
    console.warn('[FETCHER] APR calculation failed:', e.message);
    return { aprGross: -1, aprDelegator: -1 };
  }
}

// ── LCD fetch ──────────────────────────────────────────────────────────────

async function fetchFromLCD() {
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

    // Slashing params — window size, slash fractions
    try {
      const paramsResp = await lcdGet(`/cosmos/slashing/v1beta1/params`);
      const params     = paramsResp.data?.params || {};
      const windowSize = parseInt(params.signed_blocks_window || 0);

      slashFractionDoubleSign = parseFloat(params.slash_fraction_double_sign || 0);
      slashFractionDowntime   = parseFloat(params.slash_fraction_downtime    || 0);

      if (windowSize > 0 && missedBlocks >= 0) {
        uptimePct = ((windowSize - missedBlocks) / windowSize) * 100;
        console.log(`[FETCHER] Uptime: ${uptimePct.toFixed(3)}% (window: ${windowSize})`);
      }
    } catch (e) {
      console.warn('[FETCHER] Slashing params fetch failed:', e.message);
    }
  } catch (e) {
    console.warn(`[FETCHER] Signing info fetch failed: ${e.message}`);
  }

  // 5. APR — fetched in parallel with above, uses commission rate
  const commissionRate = parseFloat(val.commission?.commission_rates?.rate || 0.05);
  const { aprGross, aprDelegator } = await fetchAPR(commissionRate);

  const stakedUcore = parseFloat(val.tokens || 0);

  return {
    source:                  'lcd',
    moniker:                 val.description?.moniker || 'Unknown',
    stakedTX:                stakedUcore / cfg.DENOM_DIVISOR,
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
  };
}

module.exports = { fetchValidatorStats };
