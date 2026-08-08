'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const store = require('./store');

/**
 * چینێکی یەکگرتوو بۆ چەند دابینکەری AI.
 * هەموویان هەمان سکیمای JSON دەگەڕێننەوە، بۆیە ڕووکارەکە جیاوازی نازانێت.
 */

const PROVIDERS = {
  anthropic: {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    supportsEffort: true,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'],
    supportsEffort: false,
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    models: ['gemini-2.0-flash', 'gemini-2.0-pro', 'gemini-1.5-pro'],
    supportsEffort: false,
  },
};

function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    keyUrl: p.keyUrl,
    models: p.models,
    supportsEffort: p.supportsEffort,
  }));
}

let anthropicClient = null;
let anthropicKey = null;

function resetClient() {
  anthropicClient = null;
  anthropicKey = null;
}

function requireKey(provider) {
  const key = store.getAiKey(provider);
  if (!key) throw new Error(`کلیلی API بۆ ${PROVIDERS[provider]?.name || provider} دانەنراوە`);
  return key;
}

function currentProvider() {
  const s = store.load();
  return PROVIDERS[s.aiProvider] ? s.aiProvider : 'anthropic';
}

function currentModel(provider) {
  const s = store.load();
  return s.aiModels?.[provider] || PROVIDERS[provider].models[0];
}

/* ================= سکیمای سیگناڵ ================= */

const SIGNAL_SCHEMA = {
  type: 'object',
  properties: {
    recommendation: { type: 'string', enum: ['long', 'short', 'buy', 'wait', 'avoid'] },
    confidence: { type: 'integer' },
    timeHorizon: { type: 'string', enum: ['scalp', 'short_term', 'swing', 'long_term'] },
    entryType: { type: 'string', enum: ['market', 'limit'] },
    entryPrice: { type: 'number' },
    stopLoss: { type: 'number' },
    takeProfits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          price: { type: 'number' },
          allocationPercent: { type: 'integer' },
        },
        required: ['price', 'allocationPercent'],
        additionalProperties: false,
      },
    },
    leverage: { type: 'integer' },
    riskRewardRatio: { type: 'number' },
    positionSizePercent: { type: 'number' },
    trendSummary: { type: 'string' },
    reasoning: { type: 'string' },
    invalidation: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'recommendation',
    'confidence',
    'timeHorizon',
    'entryType',
    'entryPrice',
    'stopLoss',
    'takeProfits',
    'leverage',
    'riskRewardRatio',
    'positionSizePercent',
    'trendSummary',
    'reasoning',
    'invalidation',
    'warnings',
  ],
  additionalProperties: false,
};

/** Gemini پشتگیری `additionalProperties` ناکات — لایدەبەین */
function geminiSchema(schema) {
  const clone = JSON.parse(JSON.stringify(schema));
  const strip = (node) => {
    if (!node || typeof node !== 'object') return;
    delete node.additionalProperties;
    if (node.properties) Object.values(node.properties).forEach(strip);
    if (node.items) strip(node.items);
  };
  strip(clone);
  return clone;
}

/* ================= پڕۆمپتەکان ================= */

const LANG_NAMES = {
  ku: 'Kurdish Sorani (کوردی سۆرانی)',
  en: 'English',
  ar: 'Arabic (العربية)',
  es: 'Spanish (Español)',
  fr: 'French (Français)',
};

function buildSystemPrompt(s, marketType) {
  const lang = LANG_NAMES[s.language] || LANG_NAMES.en;
  return `You are a professional crypto market analyst producing actionable trade signals.

Analyse the multi-timeframe technical data provided and return one concrete signal.

Rules:
- Higher timeframes define direction; lower timeframes define entry timing.
- Place the stop loss behind real market structure (swing pivot / support / resistance), never an arbitrary number. Use ATR for sensible breathing room.
- Place take-profit targets at genuine resistance/support levels.
- Risk:reward must be at least 1.5. If it is not, recommend "wait".
- If the trend is unclear, the market is ranging, or ADX is below 20, recommend "wait".
- ${
    marketType === 'swap'
      ? `This is a FUTURES market. Recommend leverage conservatively (maximum ${s.maxLeverage}x). In volatile conditions use low leverage.`
      : 'This is a SPOT market. Only "buy", "wait" or "avoid" are valid, and leverage must be 1.'
  }
- positionSizePercent must not exceed ${(s.riskPercent * 3).toFixed(1)}% of balance.
- Be honest: if the setup is weak, return low confidence and "wait". A bad signal is worse than no signal.
- Prices must be realistic and close to the current market price.

IMPORTANT: Write every text field (trendSummary, reasoning, invalidation, warnings) in ${lang}. All other fields are numbers or enums.`;
}

function buildUserPrompt(context, opts, s) {
  return [
    `Symbol: ${context.symbol}`,
    `Market: ${context.marketType === 'swap' ? 'USDT-M perpetual futures' : 'spot'}`,
    `Exchange: ${opts.exchangeName || ''}`,
    opts.balanceUSDT != null ? `Available balance: ${opts.balanceUSDT} USDT` : '',
    `User risk per trade: ${s.riskPercent}%`,
    opts.userNote ? `User note: ${opts.userNote}` : '',
    '',
    'Technical data (JSON):',
    '```json',
    JSON.stringify(context, null, 2),
    '```',
    '',
    'Produce the trade signal now.',
  ]
    .filter(Boolean)
    .join('\n');
}

/* ================= بانگکردنی دابینکەرەکان ================= */

async function callAnthropic({ system, user, schema, maxTokens = 16000 }) {
  const s = store.load();
  const key = requireKey('anthropic');
  if (!anthropicClient || anthropicKey !== key) {
    anthropicClient = new Anthropic({ apiKey: key });
    anthropicKey = key;
  }

  const req = {
    model: currentModel('anthropic'),
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: s.aiEffort || 'high' },
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (schema) req.output_config.format = { type: 'json_schema', schema };

  const res = await anthropicClient.messages.create(req);
  if (res.stop_reason === 'refusal') throw new Error('AI ڕەتیکردەوە وەڵامی ئەم داواکارییە بداتەوە');

  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text) throw new Error('وەڵامێکی بەتاڵ لە AI وەرگیرا');

  return {
    text,
    model: res.model,
    usage: { input: res.usage?.input_tokens, output: res.usage?.output_tokens },
  };
}

async function callOpenAI({ system, user, schema, maxTokens = 8000 }) {
  const key = requireKey('openai');
  const model = currentModel('openai');

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_completion_tokens: maxTokens,
  };
  if (schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'trade_signal', strict: true, schema },
    };
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI هەڵە ${res.status}`);

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('وەڵامێکی بەتاڵ لە OpenAI وەرگیرا');

  return {
    text,
    model: data.model,
    usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens },
  };
}

async function callGemini({ system, user, schema, maxTokens = 8000 }) {
  const key = requireKey('gemini');
  const model = currentModel('gemini');

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (schema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = geminiSchema(schema);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gemini هەڵە ${res.status}`);

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  if (!text) throw new Error('وەڵامێکی بەتاڵ لە Gemini وەرگیرا');

  return {
    text,
    model,
    usage: {
      input: data.usageMetadata?.promptTokenCount,
      output: data.usageMetadata?.candidatesTokenCount,
    },
  };
}

async function callProvider(args) {
  const provider = currentProvider();
  if (provider === 'openai') return callOpenAI(args);
  if (provider === 'gemini') return callGemini(args);
  return callAnthropic(args);
}

/* ================= ڕووکاری گشتی ================= */

/** هەندێک مۆدێل JSON بە ```json دەپێچنەوە — پاکی دەکەینەوە */
function parseJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
    throw new Error('وەڵامی AI بە شێوەی JSON نەبوو');
  }
}

async function getSignal(context, opts = {}) {
  const s = store.load();

  const res = await callProvider({
    system: buildSystemPrompt(s, context.marketType),
    user: buildUserPrompt(context, opts, s),
    schema: SIGNAL_SCHEMA,
  });

  const signal = parseJson(res.text);
  signal.symbol = context.symbol;
  signal.marketType = context.marketType;
  signal.generatedAt = new Date().toISOString();
  signal.provider = currentProvider();
  signal.model = res.model;
  signal.usage = res.usage;

  // پاراستنی سنوورەکان — AI نابێت لە ڕێکخستنی مەترسی تێپەڕێت
  if (context.marketType !== 'swap') signal.leverage = 1;
  signal.leverage = Math.min(Math.max(1, Number(signal.leverage) || 1), s.maxLeverage);
  signal.positionSizePercent = Math.min(
    Number(signal.positionSizePercent) || 0,
    s.riskPercent * 3
  );
  signal.confidence = Math.max(0, Math.min(100, Number(signal.confidence) || 0));

  return signal;
}

async function ask(question, context) {
  const s = store.load();
  const lang = LANG_NAMES[s.language] || LANG_NAMES.en;

  const res = await callProvider({
    system: `You are a crypto market advisor. Answer concisely, clearly and practically in ${lang}. Base your answer on the provided technical data when available. Be honest about uncertainty. Never guarantee profits.`,
    user: context
      ? `Market data:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\nQuestion: ${question}`
      : question,
    maxTokens: 4000,
  });

  return res.text;
}

async function testProvider() {
  const res = await callProvider({
    system: 'Reply with a single short sentence confirming you are ready.',
    user: 'Are you ready?',
    maxTokens: 200,
  });
  return { reply: res.text.trim().slice(0, 200), model: res.model, provider: currentProvider() };
}

module.exports = {
  getSignal,
  ask,
  testProvider,
  resetClient,
  listProviders,
  currentProvider,
  SIGNAL_SCHEMA,
};
