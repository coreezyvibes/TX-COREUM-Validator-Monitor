# 🦥 TX/Coreum Validator Monitor

A lightweight, always-on validator health monitor for the **TX Ecosystem** (formerly Coreum). Get instant Telegram alerts when something changes with your validator — jailing, rank shifts, staking changes, delegator activity, slashing penalties, APR tracking, price, and projected revenue.

Built by [Coreezy](https://coreezy.xyz) — **Stake. Vibe. Grow.**

---

## What It Does

Checks your validator every 10 minutes and fires Telegram alerts for:

| Alert | Trigger |
|---|---|
| 🚨 Validator Jailed | Detected jailed status + full slashing penalty breakdown |
| 🔴 Validator Unreachable | All LCD endpoints failed |
| ⚠️ Uptime Drop | Falls below your configured threshold |
| ⚠️ Missed Blocks | Counter jumps by 10+ in one check |
| 🟢/🔴 Rank Changed | Any position change |
| 🟢/🔴 Staked TX Changed | Changes by 50K+ TX |
| 🟢/🔴 Delegator Count | Any change — up or down |
| 🟢/🔴 Voting Power | Moves by 5%+ |

Plus a **4-hour digest** sent with the Coreezy sloth gif — showing all stats with ▲/▼ deltas vs the previous report.

On startup the bot immediately fetches current stats and sends the first digest so you know it's working right away.

---

## What's in the Digest

Every 4-hour report includes:

- **Status** — Online & Bonded or Jailed
- **Rank** — with position delta vs last report
- **Staked TX** — total delegation with change
- **Delegators** — count with change
- **Uptime** — % based on signing window (live from chain)
- **Missed Blocks** — raw counter from slashing module
- **Commission** — your current rate
- **Staking APR** — gross and delegator APR, inflation rate
- **TX Price** — live USD price via CoinGecko
- **Est. Monthly Revenue** — your projected commission earnings in USD

APR starts as a network-wide estimate and automatically switches to **real earnings-based APR** after 2 checks (~20 minutes), calculated from your validator's actual accumulated rewards. The more data collected, the more accurate it becomes — after 24 hours it uses a full rolling window.

All times are displayed in **Eastern Time (ET)**, automatically handling EST/EDT transitions.

---

## Jail Alert — Slashing Penalty Breakdown

When your validator is jailed, the alert immediately shows both possible penalty amounts based on live chain parameters:

```
🚨 VALIDATOR JAILED!

Your validator has been jailed.
Status: BOND_STATUS_UNBONDING
Staked: 5.10M TX
Rank: #34

⚠️ Slashing Penalties (on 5.10M TX staked)
Downtime slash:     0.0100% = 510 TX
Double-sign slash:  5.0000% = 255.1K TX

Verify slash type on chain to confirm exact delegator reimbursement amount.

⚡ Action required immediately!
```

Penalty amounts are calculated from live chain slashing parameters and update automatically if governance changes them.

---

## Requirements

- Node.js 18+
- A TX/Coreum validator operator address
- A Telegram bot token and chat ID (see Step 1 below)

No blockchain node required — works out of the box using public LCD nodes with automatic fallback.

---

## Step 1 — Create Your Telegram Bot

This monitor requires a Telegram bot to send you alerts. You need to create your own — it takes about 2 minutes.

### 1a. Create a bot with BotFather

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a name (e.g. `My Validator Monitor`)
4. Choose a username ending in `bot` (e.g. `myvalidator_monitor_bot`)
5. BotFather replies with your **bot token** — looks like `123456789:ABCdef...`
6. Copy it — this is your `TELEGRAM_BOT_TOKEN`

### 1b. Get your Chat ID

1. Search for your new bot in Telegram and send it `/start`
2. Open this URL in your browser (replace `YOUR_BOT_TOKEN`):
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```
3. Find `"chat":{"id":` in the response — that number is your `TELEGRAM_CHAT_ID`

> **Tip:** If the response is empty, send another message to your bot first then refresh.

---

## Step 2 — Deploy

### Option A: Railway (recommended — free tier works)

1. Fork this repo on GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Select your fork
4. Go to **Variables** and add the env vars from Step 3
5. Set the **Start Command** to: `node src/index.js`
6. Set the service to **Always On** (not a cron job)
7. Deploy — you'll receive the first validator digest in Telegram within seconds ✅

### Option B: Run locally

```bash
git clone https://github.com/coreezyvibes/corez-validator-monitor
cd corez-validator-monitor
npm install
cp .env.example .env
# Edit .env with your values
node src/index.js
```

### Option C: Any VPS / cloud provider

Works on any Node.js 18+ environment. Use `pm2` to keep it running:

```bash
npm install -g pm2
pm2 start src/index.js --name validator-monitor
pm2 save && pm2 startup
```

---

## Step 3 — Environment Variables

Only 3 are required. Everything else has sensible defaults.

### Required

| Variable | Description |
|---|---|
| `VALIDATOR_ADDRESS` | Your operator address (`corevaloper1...`) |
| `TELEGRAM_BOT_TOKEN` | From BotFather (Step 1a) |
| `TELEGRAM_CHAT_ID` | Your numeric Telegram chat ID (Step 1b) |

### Optional — GIF caching

On first startup the bot uploads the Coreezy gif to Telegram and logs the `file_id`. To skip the re-upload on future restarts, copy the logged `file_id` and add it as an env var:

| Variable | Description |
|---|---|
| `GIF_FILE_ID` | Telegram file_id logged on first startup |

### Optional — Indexer API

Point to a compatible TX indexer for additional data sources:

| Variable | Description |
|---|---|
| `INDEXER_API_URL` | Base URL of your indexer (e.g. `https://your-indexer.railway.app`) |
| `INDEXER_API_KEY` | API key if your indexer requires one |

> Don't have an indexer? No problem — the monitor works fully out of the box using public LCD nodes. Uptime %, missed blocks, APR, and price all work without one.

### Optional — Thresholds

| Variable | Default | Description |
|---|---|---|
| `CHECK_INTERVAL_MS` | `600000` | How often to check (ms). 600000 = 10 min |
| `SUMMARY_INTERVAL_HOURS` | `4` | How often to send the digest |
| `UPTIME_ALERT_THRESHOLD` | `99.0` | Alert if uptime drops below this % |
| `VOTING_POWER_CHANGE_PCT` | `5.0` | Alert if voting power moves by this % |
| `STAKED_CHANGE_ALERT_TX` | `50000` | Alert if staked TX changes by this amount |
| `MISSED_BLOCKS_ALERT` | `10` | Alert if missed blocks jumps by this per check |
| `RANK_CHANGE_ALERT` | `1` | Min rank positions to trigger alert |
| `LCD_URL` | publicnode | Primary TX LCD endpoint — falls back automatically |

---

## What the Alerts Look Like

**4-hour digest:**

```
🦥 Validator Report — Thu, Apr 03 2026, 5:03 PM EDT

Status
✅ Online & Bonded

Rank
─ #34

Staked
▲ 5.10M TX (+12.3K)

Delegators
▲ 138 (+1)

Uptime  100.000%
Missed Blocks  0
Commission  5.0%

Staking APR
Gross:      14.81%
Delegator:  14.07%
Inflation:  0.1487%

TX Price  $0.0891
Est. Monthly Revenue  $189.42

Stake. Vibe. Grow. 🌴
```

**Rank change alert:**
```
🟢 Rank Changed

Now #33 (was #34)
Moved up 1 position
```

**Jail alert:**
```
🚨 VALIDATOR JAILED!

Your validator has been jailed.
Status: BOND_STATUS_UNBONDING
Staked: 5.10M TX
Rank: #34

⚠️ Slashing Penalties (on 5.10M TX staked)
Downtime slash:     0.0100% = 510 TX
Double-sign slash:  5.0000% = 255.1K TX

Verify slash type on chain to confirm exact delegator reimbursement amount.

⚡ Action required immediately!
```

---

## Data Sources

The monitor uses a multi-tier approach with automatic fallback for all LCD calls:

1. **Indexer API** (optional) — if configured, used first
2. **Primary LCD** — your configured `LCD_URL` (defaults to publicnode)
3. **TX Archive node** — `archive.rest.mainnet-1.tx.org`
4. **Official Coreum node** — `full-node.mainnet-1.coreum.dev`
5. **Cosmos Directory proxy** — `rest.cosmos.directory/coreum`

If one source fails, the next is tried automatically.

**Additional data sources:**
- **CoinGecko** — free public API for live TX/USD price, no key required
- **Cosmos mint module** — `annual_provisions` for accurate APR calculation
- **Cosmos distribution module** — validator outstanding rewards for real earnings-based APR
- **Cosmos slashing module** — signing info for uptime/missed blocks, params for slash fractions

---

## APR Methodology

APR is calculated in two stages:

**Stage 1 — Projection (first ~20 minutes after startup):**
Uses the chain's `annual_provisions` divided by total bonded tokens, adjusted for community tax. Shown with *(est.)* label in the digest.

**Stage 2 — Real earnings (after 2+ checks):**
Tracks your validator's actual accumulated rewards from the distribution module. Diffs consecutive readings to calculate a real earn rate, then annualises it. After 24 hours this uses a full rolling window for maximum accuracy. The *(est.)* label disappears once real data is available.

Reward snapshots are persisted to `data/rewards_state.json` and survive restarts.

---

## No Cron Required

The check schedule is built into the bot — no external cron job needed. As long as your service is running (Railway always-on, pm2, systemd), it loops automatically every 10 minutes and sends the digest every 4 hours.

---

## Project Structure

```
src/
  index.js          — main loop, alert scheduling
  fetcher.js        — all chain data fetching and LCD fallback logic
  alerts.js         — Telegram message formatting and sending
  config.js         — environment variable loading
  rewardsTracker.js — rolling rewards accumulator for real APR
data/
  rewards_state.json  — persisted reward snapshots (auto-created)
assets/
  tenor Vibin.gif   — the Coreezy sloth gif
```

---

## About Coreezy

Coreezy is a validator and lifestyle brand on the TX Ecosystem. We build open-source tooling for the TX/Coreum community.

- 🌐 [coreezy.xyz](https://coreezy.xyz)
- 🐦 [@CoreezyVibes](https://twitter.com/CoreezyVibes)
- 💬 [Telegram](https://t.me/HammockGang)
- 🗳️ Validator: `corevaloper1uxengudkvpu5feqfqs4ant2hvukvf9ahxk63gh`

**Stake with Coreezy** — 5% commission, 100% uptime, enterprise Zeeve infrastructure.

---

## Contributing

PRs welcome. If you add support for additional chains or indexers, open a PR and we'll review it.

---

*Apache 2.0 License*
