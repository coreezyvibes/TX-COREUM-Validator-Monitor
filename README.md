# 🦥 TX/Coreum Validator Monitor

A lightweight, always-on validator health monitor for the **TX Ecosystem** (formerly Coreum). Get instant Telegram alerts when something changes with your validator — jailing, rank shifts, staking changes, delegator activity, and more.

Built by [Coreezy](https://coreezy.xyz) — **Stake. Vibe. Grow.**

---

## What It Does

Checks your validator every 10 minutes and fires Telegram alerts for:

| Alert | Trigger |
|---|---|
| 🚨 Validator Jailed | Detected jailed status |
| 🔴 Validator Unreachable | Both indexer and LCD failed |
| ⚠️ Uptime Drop | Falls below your threshold (requires indexer) |
| ⚠️ Missed Blocks | Counter jumps by 10+ in one check (requires indexer) |
| 🟢/🔴 Rank Changed | Any position change |
| 🟢/🔴 Staked TX Changed | Changes by 50K+ TX |
| 🟢/🔴 Delegator Count | Any change — up or down |
| 🟢/🔴 Voting Power | Moves by 5%+ (requires indexer) |

Plus a **4-hour digest** — sent with a 🦥 sloth gif — showing all stats with deltas vs the previous summary: rank, staked TX, delegators, uptime, missed blocks, commission — all with ▲/▼ indicators.

---

## Requirements

- Node.js 18+
- A TX/Coreum validator operator address
- A Telegram account
- Access to the **COREZ Buy Bot** on Telegram (free — details below)

No blockchain node required — works out of the box with the public LCD.

---

## Step 1 — Get Telegram Set Up via COREZ Buy Bot

This monitor sends alerts through the **COREZ Buy Bot**. Here's how to get your credentials:

### 1a. Find the COREZ Buy Bot
Search for **@CoreezyVibesBot** on Telegram (or find it pinned in the [Coreezy Telegram](https://t.me/CoreezyVibes)).

### 1b. Get your Bot Token
The COREZ Buy Bot is a shared community bot. To use it for your own alerts:

1. Message the bot: `/start`
2. The bot will reply with instructions to register your validator address
3. You'll receive a personal `bot_token` and `chat_id` to use as your env vars

> **Note:** Each validator gets its own isolated alert stream — your alerts only go to you.

### 1c. Find your Telegram Chat ID
After starting the bot, send `/myid` — it will reply with your numeric chat ID.

---

## Step 2 — Deploy

### Option A: Railway (recommended — free tier works)

1. Fork this repo on GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Select your fork
4. Go to **Variables** and add the env vars from Step 3
5. Set the **Start Command** to: `node src/index.js`
6. Deploy — you'll get a startup Telegram message within seconds ✅

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

Works on any Node.js 18+ environment. Use `pm2` or `systemd` to keep it running:

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
| `TELEGRAM_BOT_TOKEN` | From the COREZ Buy Bot (Step 1b) |
| `TELEGRAM_CHAT_ID` | Your numeric Telegram chat ID (Step 1c) |

### Optional — Indexer API

For richer metrics (uptime %, missed blocks, voting power), point to a compatible TX indexer:

| Variable | Description |
|---|---|
| `INDEXER_API_URL` | Base URL of your indexer (e.g. `https://your-indexer.railway.app`) |
| `INDEXER_API_KEY` | API key if your indexer requires one |

Without these, the monitor uses the **public LCD node** automatically — rank, staked TX, and delegator count still work perfectly.

> Don't have an indexer? No problem — the monitor works fully out of the box using the public LCD node.

### Optional — Thresholds

| Variable | Default | Description |
|---|---|---|
| `CHECK_INTERVAL_MS` | `600000` | How often to check (ms). 600000 = 10 min |
| `SUMMARY_INTERVAL_HOURS` | `4` | How often to send the digest summary |
| `UPTIME_ALERT_THRESHOLD` | `99.0` | Alert if uptime drops below this % |
| `VOTING_POWER_CHANGE_PCT` | `5.0` | Alert if voting power moves by this % |
| `STAKED_CHANGE_ALERT_TX` | `50000` | Alert if staked TX changes by this amount |
| `MISSED_BLOCKS_ALERT` | `10` | Alert if missed blocks jumps by this per check |
| `RANK_CHANGE_ALERT` | `1` | Min rank positions to trigger alert |
| `LCD_URL` | publicnode | TX LCD endpoint (public, no account needed) |

---

## What the Alerts Look Like

**Startup:**
```
🦥 TX/Coreum Validator Monitor Started
Checking every 10 minutes
Summary every 4 hours
Watching: corevaloper1abc...
```

**4-hour digest:**
```
🦥 Coreezy Validator — Sat, 28 Mar 2026 12:00:00 GMT

Status
✅ Online & Bonded

Rank
▲ #34 (+1 vs 4h ago)

Staked
▲ 4,720,000 TX (+87,000)

Delegators
▲ 136 (+3)

Uptime
99.997%

Missed Blocks
2

Commission  5.0%
Data source indexer

Stake. Vibe. Grow. 🌴
```

**Jail alert:**
```
🚨 VALIDATOR JAILED!

Your validator has been jailed.
Status: BOND_STATUS_UNBONDING
Staked: 4.72M TX
Rank: #34

⚡ Action required immediately!
```

---

## Data Sources

The monitor uses a two-tier approach:

1. **Indexer API** (optional) — richer data including uptime %, missed block counter, voting power. Configure via `INDEXER_API_URL`.
2. **Public LCD** (automatic fallback) — always available, no setup needed. Provides rank, staked TX, delegator count, and jail status.

If the indexer fails for any reason, the monitor seamlessly falls back to LCD without interruption.

---

## About Coreezy

Coreezy is a validator and lifestyle brand on the TX Ecosystem. We build open-source tooling for the TX/Coreum community.

- 🌐 [coreezy.xyz](https://coreezy.xyz)
- 🐦 [@CoreezyVibes](https://twitter.com/CoreezyVibes)
- 💬 [Telegram](https://t.me/CoreezyVibes)
- 🗳️ Validator: `corevaloper1uxengudkvpu5feqfqs4ant2hvukvf9ahxk63gh`

**Stake with Coreezy** — 5% commission, 100% uptime, enterprise Zeeve infrastructure.

---

## Contributing

PRs welcome. If you add support for additional chains or indexers, open a PR and we'll review it.

---

*MIT License*
