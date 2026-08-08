# Requirements

> ### 📦 Just downloaded the installer?
>
> **You need nothing from this page except Windows 10/11 (64-bit).**
>
> Node.js, Electron and every library are already bundled inside the `.exe`. Install it and open it — that's all.
>
> Everything below is for people who want to **run or build from source**, plus the API-key details you'll need inside the app ([section 4](#4-accounts-and-api-keys)) and troubleshooting ([section 7](#7-troubleshooting)).

---

## 1. System requirements

| | Minimum | Recommended |
|---|---|---|
| **OS** | Windows 10 (64-bit), macOS 11, Ubuntu 20.04 | Windows 11, macOS 13+, Ubuntu 22.04+ |
| **RAM** | 4 GB | 8 GB |
| **Disk** | 500 MB | 1 GB |
| **Display** | 1280 × 720 | 1600 × 900 or wider |
| **Network** | Stable internet connection | — |

The chart is drawn on an HTML canvas at your display's pixel ratio, so a high-DPI screen looks noticeably sharper.

> **Note on regional access:** some exchanges block API traffic from certain countries. If connection tests fail with a timeout while your internet works normally, a VPN may be required.

---

## 2. Runtime requirements — **source only**

*Skip this section entirely if you installed from a release. The packaged app has no external requirements.*

| Dependency | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org) | **18.0+** (20 LTS recommended) | JavaScript runtime |
| npm | 9+ (ships with Node) | Package manager |
| Git | any | Cloning the repository |

Check your versions:

```bash
node --version
npm --version
```

Users of the packaged installer do **not** need Node.js — it is bundled.

---

## 3. npm dependencies

Installed automatically by `npm install`.

### Runtime

| Package | Version | Purpose |
|---|---|---|
| `ccxt` | ^4.4.60 | Unified API for 100+ crypto exchanges |
| `@anthropic-ai/sdk` | ^0.68.0 | Claude API client |

OpenAI and Gemini are called through the built-in `fetch` API — no extra packages.

### Development

| Package | Version | Purpose |
|---|---|---|
| `electron` | ^33.2.0 | Desktop application runtime |
| `electron-builder` | ^25.1.8 | Packaging and installers |

Total install size is roughly **400 MB** including Electron.

---

## 4. Accounts and API keys

### 4.1 Exchange account

You need an account on **one** of the supported exchanges:

| Exchange | Spot | Futures | Passphrase | Test environment |
|---|:---:|:---:|:---:|:---:|
| OKX | ✅ | ✅ | ✅ | ✅ |
| Binance | ✅ | ✅ | — | ✅ |
| Bybit | ✅ | ✅ | — | ✅ |
| Bitget | ✅ | ✅ | ✅ | — |
| Gate.io | ✅ | ✅ | — | — |
| MEXC | ✅ | ✅ | — | — |
| KuCoin | ✅ | ✅ | ✅ | ✅ |
| HTX (Huobi) | ✅ | ✅ | — | — |
| Coinbase | ✅ | — | — | — |
| Kraken | ✅ | — | — | — |

**Required API key permissions:**

- ✅ **Read** — account balance, positions, orders
- ✅ **Trade / Spot & Futures trading** — placing and cancelling orders
- ❌ **Withdrawal — never enable this.** The app does not use it and never will.

**Strongly recommended:** bind the API key to your IP address in the exchange's security settings.

> ⚠️ **Demo keys are separate.** Exchanges that offer a test environment issue different keys for it. A live key will be rejected in demo mode and vice-versa, with an *"environment"* error.

### 4.2 AI provider account

You need an API key from **one** provider:

| Provider | Where to get a key | Free tier | Typical cost per analysis |
|---|---|---|---|
| **Anthropic Claude** | [console.anthropic.com](https://console.anthropic.com/settings/keys) | No — prepaid credit | ~$0.02 – $0.10 |
| **OpenAI** | [platform.openai.com](https://platform.openai.com/api-keys) | No — prepaid credit | ~$0.01 – $0.05 |
| **Google Gemini** | [aistudio.google.com](https://aistudio.google.com/app/apikey) | ✅ Yes, generous | Free within limits |

Cost varies with the model and analysis depth. Gemini's free tier is enough to evaluate the app at no cost.

An AI key is optional — the chart, indicators, manual trading and position management all work without one. Only the signal generation and AI chat require it.

---

## 5. Build requirements

Only needed if you want to produce installers yourself.

### Windows
No extra tooling. `npm run build` produces an NSIS installer and a portable `.exe` in `dist/`.

### macOS
Xcode Command Line Tools:
```bash
xcode-select --install
```
Code signing is required for distribution outside your own machine.

### Linux
```bash
sudo apt install build-essential libarchive-tools
```

---

## 6. Verifying the installation

After `npm install`, run:

```bash
npm start
```

The app should open with:

- The header showing a price for `BTC/USDT` (public data works without any key)
- A rendered candlestick chart
- The indicators panel populated

If all three appear, market data is working. Then:

1. **Settings → Exchange → Test** — confirms your exchange keys
2. **Settings → AI provider → Test** — confirms your AI key

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `APIKey does not match current environment` | Demo/live key mismatch | Toggle demo mode, or create a key in the matching environment |
| `Invalid Sign` / `signature` error | Wrong API key or secret | Re-enter both keys carefully — no spaces |
| `Passphrase` error | Wrong passphrase | Use the exact passphrase set when creating the key |
| `IP not allowed` | IP restriction on the key | Add your current IP in the exchange, or remove the restriction |
| Timeout, but internet works | Regional block | Try a VPN |
| Chart empty, price shows `—` | Symbol not listed on this exchange/market | Pick a symbol from the dropdown |
| `401` from the AI provider | Invalid or expired AI key | Re-enter the key in Settings |
| `429` from the AI provider | Rate limit or quota exhausted | Wait, or check your provider billing |
| No positions shown | Spot market selected | Switch to Futures — positions only exist there |

---

## 8. Data storage

The app writes only to its own settings directory:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Hirani Crypto Trade Bot\` |
| macOS | `~/Library/Application Support/Hirani Crypto Trade Bot/` |
| Linux | `~/.config/Hirani Crypto Trade Bot/` |

| File | Contents |
|---|---|
| `settings.json` | Preferences, plus API keys encrypted by the OS credential store |
| `journal.json` | Activity log — signals, orders, modifications |
| `drawings.json` | Your chart drawings, per symbol |

Deleting this folder resets the app completely.

---

## 9. What the app never does

- Never requests or uses withdrawal permission
- Never sends your API keys anywhere — they are used only to sign requests to your chosen exchange
- Never sends telemetry or analytics
- Never places an order without an explicit confirmation dialog
- Never loads remote code — a strict Content Security Policy blocks it

Outbound network traffic goes to exactly three destinations: your exchange, your chosen AI provider, and nothing else.
