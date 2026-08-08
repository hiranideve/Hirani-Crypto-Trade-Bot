'use strict';

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

/**
 * کۆگای ڕێکخستنەکان.
 *
 * هەموو نهێنییەکان (کلیلی بۆرسە و AI) لە یەک بلۆکی شیفرەکراودا هەڵدەگیرێن
 * بە safeStorage ی سیستەم (لە ویندۆز DPAPI). واتە تەنیا هەمان بەکارهێنەر
 * لەسەر هەمان ئامێر دەتوانێت بیانخوێنێتەوە — تەنانەت ئەگەر پەڕگەکە بدزرێت.
 */

const DEFAULTS = {
  // ڕووکار
  language: 'ku',
  confirmBeforeOrder: true,

  // بۆرسە
  exchangeId: 'okx',
  demoMode: true,

  // AI
  aiProvider: 'anthropic',
  aiModels: {
    anthropic: 'claude-opus-5',
    openai: 'gpt-4o',
    gemini: 'gemini-2.0-flash',
  },
  aiEffort: 'high',

  // مامەڵە
  defaultSymbol: 'BTC/USDT',
  defaultTimeframe: '1h',
  marketType: 'spot',

  // مەترسی
  riskPercent: 1.5,
  maxLeverage: 20,
  defaultLeverage: 5,
  marginMode: 'isolated',
  maxOpenPositions: 5,
  dailyLossLimitPercent: 5,

  // داتا
  alerts: [],
  watchlist: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'],
};

// شێوەی نهێنییەکان: { exchanges: { okx: {apiKey, secret, password} }, ai: { anthropic: 'sk-...' } }
const EMPTY_SECRETS = { exchanges: {}, ai: {} };

let cache = null;
let secretsCache = null;
let filePath = null;

function getFilePath() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'settings.json');
  return filePath;
}

/**
 * ناوی ئەپەکە گۆڕدرا — ڕێکخستنە کۆنەکان دەگوێزینەوە تاکو بەکارهێنەر
 * کلیلەکانی لەدەست نەچێت لە کاتی نوێکردنەوەدا.
 */
function migrateLegacy() {
  if (fs.existsSync(getFilePath())) return;
  const userData = app.getPath('userData');
  const parent = path.dirname(userData);

  for (const legacyName of ['KurdTradeBot', 'kurd-trade-bot']) {
    const legacy = path.join(parent, legacyName, 'settings.json');
    try {
      if (fs.existsSync(legacy)) {
        fs.mkdirSync(userData, { recursive: true });
        fs.copyFileSync(legacy, getFilePath());

        // تۆمار و هێڵکاریەکانیش بگوازەوە ئەگەر هەبوون
        for (const extra of ['journal.json', 'drawings.json']) {
          const src = path.join(parent, legacyName, extra);
          const dst = path.join(userData, extra);
          if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
        }
        return;
      }
    } catch (e) {
      /* گواستنەوە سەرکەوتوو نەبوو — بە ڕێکخستنی بنەڕەت دەستپێدەکەین */
    }
  }
}

function encryptBlob(obj) {
  const json = JSON.stringify(obj);
  if (!safeStorage.isEncryptionAvailable()) return `plain:${json}`;
  return `enc:${safeStorage.encryptString(json).toString('base64')}`;
}

function decryptBlob(value) {
  if (!value) return { ...EMPTY_SECRETS };
  try {
    if (value.startsWith('plain:')) return JSON.parse(value.slice(6));
    if (value.startsWith('enc:')) {
      return JSON.parse(safeStorage.decryptString(Buffer.from(value.slice(4), 'base64')));
    }
  } catch (e) {
    /* شیفرەکە ناکرێتەوە (ئامێر/بەکارهێنەری جیاواز) — بە بەتاڵ دەستپێدەکەینەوە */
  }
  return { ...EMPTY_SECRETS };
}

/** گواستنەوە لە شێوەی کۆنی v1 (کلیلە تاکەکان) بۆ بلۆکی نوێ */
function absorbLegacyKeys(raw, secrets) {
  const legacyMap = {
    okxApiKey: ['exchanges', 'okx', 'apiKey'],
    okxSecret: ['exchanges', 'okx', 'secret'],
    okxPassword: ['exchanges', 'okx', 'password'],
    anthropicApiKey: ['ai', 'anthropic'],
  };
  let changed = false;

  for (const [oldKey, pathParts] of Object.entries(legacyMap)) {
    const encVal = raw[oldKey];
    if (!encVal) continue;
    let plain = '';
    try {
      if (String(encVal).startsWith('plain:')) plain = String(encVal).slice(6);
      else if (String(encVal).startsWith('enc:')) {
        plain = safeStorage.decryptString(Buffer.from(String(encVal).slice(4), 'base64'));
      }
    } catch (e) {
      plain = '';
    }
    if (!plain) continue;

    if (pathParts.length === 3) {
      secrets.exchanges[pathParts[1]] = secrets.exchanges[pathParts[1]] || {};
      secrets.exchanges[pathParts[1]][pathParts[2]] = plain;
    } else {
      secrets.ai[pathParts[1]] = plain;
    }
    changed = true;
  }

  if (raw.okxDemo !== undefined && raw.demoMode === undefined) {
    raw.demoMode = raw.okxDemo;
    changed = true;
  }
  return changed;
}

function load() {
  if (cache) return cache;
  migrateLegacy();

  let raw = {};
  try {
    if (fs.existsSync(getFilePath())) {
      raw = JSON.parse(fs.readFileSync(getFilePath(), 'utf8'));
    }
  } catch (e) {
    raw = {};
  }

  secretsCache = decryptBlob(raw.secrets);
  secretsCache.exchanges = secretsCache.exchanges || {};
  secretsCache.ai = secretsCache.ai || {};

  const migrated = absorbLegacyKeys(raw, secretsCache);

  const merged = { ...DEFAULTS, ...raw };
  merged.aiModels = { ...DEFAULTS.aiModels, ...(raw.aiModels || {}) };
  delete merged.secrets;
  // کلیلە کۆنەکان لە ئۆبجێکتی گشتیدا نامێننەوە
  for (const k of ['okxApiKey', 'okxSecret', 'okxPassword', 'anthropicApiKey', 'okxDemo']) {
    delete merged[k];
  }

  cache = merged;
  if (migrated) save({});
  return cache;
}

function save(patch = {}) {
  const current = load();
  const next = { ...current, ...patch };
  if (patch.aiModels) next.aiModels = { ...current.aiModels, ...patch.aiModels };
  cache = next;

  const toWrite = { ...next, secrets: encryptBlob(secretsCache) };
  fs.mkdirSync(path.dirname(getFilePath()), { recursive: true });
  fs.writeFileSync(getFilePath(), JSON.stringify(toWrite, null, 2), 'utf8');
  return next;
}

/* ---------- نهێنییەکان ---------- */

function getExchangeCreds(exchangeId) {
  load();
  return secretsCache.exchanges[exchangeId] || {};
}

function setExchangeCreds(exchangeId, creds) {
  load();
  const existing = secretsCache.exchanges[exchangeId] || {};
  const next = { ...existing };
  // نرخی بەتاڵ = نەگۆڕدراوە (بۆ ئەوەی کلیلی هەبوو نەسڕدرێتەوە)
  for (const [k, v] of Object.entries(creds)) {
    if (v !== undefined && v !== null && v !== '') next[k] = v;
  }
  secretsCache.exchanges[exchangeId] = next;
  save({});
  return true;
}

function clearExchangeCreds(exchangeId) {
  load();
  delete secretsCache.exchanges[exchangeId];
  save({});
  return true;
}

function getAiKey(provider) {
  load();
  return secretsCache.ai[provider] || '';
}

function setAiKey(provider, key) {
  load();
  if (key) secretsCache.ai[provider] = key;
  save({});
  return true;
}

function clearAiKey(provider) {
  load();
  delete secretsCache.ai[provider];
  save({});
  return true;
}

/** وێنەیەکی سەلامەت بۆ ڕووکار — هیچ نهێنییەک ناگوازرێتەوە، تەنیا "دانراوە/نەدانراوە" */
function publicSettings() {
  const s = load();
  const exchangeKeys = {};
  for (const [id, creds] of Object.entries(secretsCache.exchanges)) {
    exchangeKeys[id] = {
      apiKeySet: Boolean(creds.apiKey),
      secretSet: Boolean(creds.secret),
      passwordSet: Boolean(creds.password),
      hint: creds.apiKey ? `••••${String(creds.apiKey).slice(-4)}` : '',
    };
  }
  const aiKeys = {};
  for (const [id, key] of Object.entries(secretsCache.ai)) {
    aiKeys[id] = { set: Boolean(key), hint: key ? `••••${String(key).slice(-4)}` : '' };
  }
  return { ...s, exchangeKeys, aiKeys };
}

module.exports = {
  load,
  save,
  publicSettings,
  getExchangeCreds,
  setExchangeCreds,
  clearExchangeCreds,
  getAiKey,
  setAiKey,
  clearAiKey,
  DEFAULTS,
};
