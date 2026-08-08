'use strict';

const ccxt = require('ccxt');
const store = require('./store');
const registry = require('./exchanges');

let clients = {};
let marketsLoaded = {};

function reset() {
  clients = {};
  marketsLoaded = {};
}

function currentId() {
  return store.load().exchangeId || 'okx';
}

function meta(exchangeId) {
  return registry.get(exchangeId || currentId());
}

function cacheKey(exchangeId, marketType) {
  const s = store.load();
  return `${exchangeId}:${marketType}:${s.demoMode ? 'demo' : 'live'}`;
}

function getClient(marketType = 'spot', exchangeId) {
  const id = exchangeId || currentId();
  const info = meta(id);
  const key = cacheKey(id, marketType);
  if (clients[key]) return clients[key];

  const s = store.load();
  const creds = store.getExchangeCreds(id);

  // هەندێک بۆرسە کلاسێکی جیاوازیان هەیە بۆ فیوچەر (وەک KuCoin)
  const ccxtId =
    marketType === 'swap' && info.futuresCcxtId ? info.futuresCcxtId : info.ccxtId;
  const Cls = ccxt[ccxtId];
  if (!Cls) throw new Error(`ccxt پشتگیری ${ccxtId} ناکات`);

  const ex = new Cls({
    apiKey: creds.apiKey || undefined,
    secret: creds.secret || undefined,
    password: info.needsPassword ? creds.password || undefined : undefined,
    enableRateLimit: true,
    timeout: 30000,
    options: {
      defaultType: marketType === 'swap' ? info.swapType || 'swap' : 'spot',
    },
  });

  if (s.demoMode && info.sandbox) {
    try {
      ex.setSandboxMode(true);
    } catch (e) {
      /* ئەم بۆرسەیە ژینگەی تاقیکردنەوەی نییە — بە ژینگەی ئاسایی بەردەوام دەبین */
    }
  }

  clients[key] = ex;
  return ex;
}

async function ensureMarkets(marketType, exchangeId) {
  const id = exchangeId || currentId();
  const ex = getClient(marketType, id);
  const key = cacheKey(id, marketType);
  if (!marketsLoaded[key]) {
    await ex.loadMarkets();
    marketsLoaded[key] = true;
  }
  return ex;
}

function assertFutures(marketType) {
  const info = meta();
  if (marketType === 'swap' && !info.swapType) {
    throw new Error(`${info.name} پشتگیری بازاڕی فیوچەر ناکات`);
  }
}

/** "BTC/USDT" لە فیوچەردا دەبێت بە "BTC/USDT:USDT" */
function normalizeSymbol(symbol, marketType) {
  if (marketType === 'swap') {
    if (symbol.includes(':')) return symbol;
    const [base, quote] = symbol.split('/');
    return `${base}/${quote}:${quote}`;
  }
  return symbol.split(':')[0];
}

function displaySymbol(symbol) {
  return String(symbol).split(':')[0];
}

async function testConnection() {
  const info = meta();
  const ex = await ensureMarkets('spot');
  const s = store.load();
  const creds = store.getExchangeCreds(info.id);

  const result = {
    exchange: info.name,
    demo: s.demoMode && info.sandbox,
    sandboxSupported: info.sandbox,
    markets: Object.keys(ex.markets).length,
  };

  if (creds.apiKey) {
    const bal = await ex.fetchBalance();
    result.authenticated = true;
    result.totalUSDT = bal.total?.USDT ?? bal.total?.USD ?? 0;
  } else {
    result.authenticated = false;
  }
  return result;
}

async function listSymbols(marketType = 'spot', quote = 'USDT') {
  assertFutures(marketType);
  const ex = await ensureMarkets(marketType);
  return Object.values(ex.markets)
    .filter((m) => {
      if (!m.active) return false;
      if (marketType === 'swap') return m.swap && m.linear && m.quote === quote;
      return m.spot && (m.quote === quote || m.quote === 'USD');
    })
    .map((m) => displaySymbol(m.symbol))
    .sort();
}

async function fetchOHLCV(symbol, timeframe = '1h', limit = 300, marketType = 'spot') {
  const ex = await ensureMarkets(marketType);
  const raw = await ex.fetchOHLCV(normalizeSymbol(symbol, marketType), timeframe, undefined, limit);
  return raw.map((c) => ({
    time: c[0],
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5],
  }));
}

async function fetchTicker(symbol, marketType = 'spot') {
  const ex = await ensureMarkets(marketType);
  const t = await ex.fetchTicker(normalizeSymbol(symbol, marketType));
  return {
    symbol: displaySymbol(t.symbol),
    last: t.last,
    bid: t.bid,
    ask: t.ask,
    high: t.high,
    low: t.low,
    change: t.percentage,
    volume: t.quoteVolume ?? t.baseVolume,
  };
}

async function fetchTickers(symbols, marketType = 'spot') {
  const out = [];
  for (const s of symbols) {
    try {
      out.push(await fetchTicker(s, marketType));
    } catch (e) {
      out.push({ symbol: s, error: e.message });
    }
  }
  return out;
}

async function fetchBalance(marketType = 'spot') {
  const ex = await ensureMarkets(marketType);
  const bal = await ex.fetchBalance();
  const rows = [];
  for (const [coin, v] of Object.entries(bal.total || {})) {
    if (v && v > 0) {
      rows.push({ coin, total: v, free: bal.free?.[coin] ?? 0, used: bal.used?.[coin] ?? 0 });
    }
  }
  rows.sort((a, b) => b.total - a.total);
  return { rows, totalUSDT: bal.total?.USDT ?? bal.total?.USD ?? 0 };
}

async function fetchPositions(symbol) {
  assertFutures('swap');
  const ex = await ensureMarkets('swap');
  const syms = symbol ? [normalizeSymbol(symbol, 'swap')] : undefined;
  const positions = await ex.fetchPositions(syms);
  return positions
    .filter((p) => Math.abs(Number(p.contracts || 0)) > 0)
    .map((p) => ({
      symbol: displaySymbol(p.symbol),
      side: p.side,
      contracts: Number(p.contracts),
      notional: p.notional,
      entryPrice: p.entryPrice,
      markPrice: p.markPrice,
      leverage: p.leverage,
      unrealizedPnl: p.unrealizedPnl,
      percentage: p.percentage,
      liquidationPrice: p.liquidationPrice,
      marginMode: p.marginMode,
    }));
}

async function setLeverage(symbol, leverage, marginMode = 'isolated') {
  assertFutures('swap');
  const ex = await ensureMarkets('swap');
  const sym = normalizeSymbol(symbol, 'swap');

  // هەندێک بۆرسە مۆدی مارجین بە فەرمانێکی جیا دەگۆڕن
  try {
    if (ex.has?.setMarginMode) await ex.setMarginMode(marginMode, sym);
  } catch (e) {
    /* پێشتر ڕێکخراوە یان پشتگیری ناکرێت */
  }
  return ex.setLeverage(leverage, sym, { mgnMode: marginMode, marginMode });
}

async function fetchOpenOrders(symbol, marketType = 'spot') {
  const ex = await ensureMarkets(marketType);
  const sym = symbol ? normalizeSymbol(symbol, marketType) : undefined;
  const orders = await ex.fetchOpenOrders(sym);
  return orders.map((o) => ({
    id: o.id,
    symbol: displaySymbol(o.symbol),
    type: o.type,
    side: o.side,
    price: o.price,
    amount: o.amount,
    filled: o.filled,
    status: o.status,
    timestamp: o.timestamp,
  }));
}

async function cancelOrder(id, symbol, marketType = 'spot') {
  const ex = await ensureMarkets(marketType);
  return ex.cancelOrder(id, normalizeSymbol(symbol, marketType));
}

async function fetchMyTrades(symbol, marketType = 'spot', limit = 50) {
  const ex = await ensureMarkets(marketType);
  const trades = await ex.fetchMyTrades(normalizeSymbol(symbol, marketType), undefined, limit);
  return trades.map((t) => ({
    id: t.id,
    symbol: displaySymbol(t.symbol),
    side: t.side,
    price: t.price,
    amount: t.amount,
    cost: t.cost,
    fee: t.fee?.cost,
    timestamp: t.timestamp,
  }));
}

async function amountFromQuote(symbol, quoteAmount, price, marketType, leverage = 1) {
  const ex = await ensureMarkets(marketType);
  const sym = normalizeSymbol(symbol, marketType);
  const market = ex.market(sym);

  if (marketType === 'swap') {
    const contractSize = market.contractSize || 1;
    const notional = quoteAmount * leverage;
    return Number(ex.amountToPrecision(sym, notional / (price * contractSize)));
  }
  return Number(ex.amountToPrecision(sym, quoteAmount / price));
}

/** پارامەترە تایبەتەکانی هەر بۆرسەیەک */
function exchangeParams(marketType, marginMode, reduceOnly) {
  const info = meta();
  const params = {};
  if (marketType === 'swap') {
    if (info.tdMode) params.tdMode = marginMode || 'isolated';
    if (reduceOnly) params.reduceOnly = true;
  } else if (info.tdMode) {
    params.tdMode = 'cash';
  }
  return params;
}

async function placeOrder(o) {
  const marketType = o.marketType || 'spot';
  assertFutures(marketType);
  const ex = await ensureMarkets(marketType);
  const sym = normalizeSymbol(o.symbol, marketType);
  const s = store.load();

  if (marketType === 'swap' && o.leverage) {
    try {
      await setLeverage(o.symbol, o.leverage, o.marginMode || s.marginMode);
    } catch (e) {
      /* پێشتر ڕێکخراوە — فەرمانەکە بەردەوام دەبێت */
    }
  }

  const ticker = await ex.fetchTicker(sym);
  const refPrice = o.type === 'limit' && o.price ? Number(o.price) : ticker.last;

  let amount = o.amount;
  if (!amount) {
    amount = await amountFromQuote(
      o.symbol,
      Number(o.quoteAmount),
      refPrice,
      marketType,
      marketType === 'swap' ? Number(o.leverage || 1) : 1
    );
  }
  amount = Number(ex.amountToPrecision(sym, amount));
  if (!amount || amount <= 0) throw new Error('بڕی فەرمان زۆر بچووکە یان نادروستە');

  const params = exchangeParams(marketType, o.marginMode || s.marginMode, o.reduceOnly);

  if (marketType === 'swap') {
    if (o.stopLoss) {
      params.stopLoss = {
        triggerPrice: Number(ex.priceToPrecision(sym, o.stopLoss)),
        type: 'market',
      };
    }
    if (o.takeProfit) {
      params.takeProfit = {
        triggerPrice: Number(ex.priceToPrecision(sym, o.takeProfit)),
        type: 'market',
      };
    }
  }

  const price = o.type === 'limit' ? Number(ex.priceToPrecision(sym, o.price)) : undefined;
  const order = await ex.createOrder(sym, o.type || 'market', o.side, amount, price, params);

  const result = {
    id: order.id,
    symbol: displaySymbol(order.symbol),
    side: order.side,
    type: order.type,
    amount: order.amount,
    price: order.price ?? refPrice,
    status: order.status,
    marketType,
    exchange: meta().name,
    attachedSLTP: Boolean(params.stopLoss || params.takeProfit),
  };

  // سپۆت: SL/TP پێوەلکاندن پشتگیری ناکرێت — فەرمانی مەرجداری جیا دادەنێین
  if (marketType === 'spot' && (o.stopLoss || o.takeProfit) && o.side === 'buy') {
    result.protective = [];
    for (const [kind, trigger] of [
      ['stopLoss', o.stopLoss],
      ['takeProfit', o.takeProfit],
    ]) {
      if (!trigger) continue;
      try {
        const extra = { ...exchangeParams('spot') };
        if (kind === 'stopLoss') extra.stopLossPrice = Number(ex.priceToPrecision(sym, trigger));
        else extra.takeProfitPrice = Number(ex.priceToPrecision(sym, trigger));

        const p = await ex.createOrder(sym, 'market', 'sell', amount, undefined, extra);
        result.protective.push({ kind, id: p.id, trigger });
      } catch (e) {
        result.protective.push({ kind, error: e.message });
      }
    }
  }

  return result;
}

async function fetchAlgoOrders(symbol) {
  assertFutures('swap');
  const ex = await ensureMarkets('swap');
  const sym = normalizeSymbol(symbol, 'swap');

  let orders = [];
  for (const params of [{ trigger: true }, { stop: true }]) {
    try {
      orders = await ex.fetchOpenOrders(sym, undefined, undefined, params);
      if (orders.length) break;
    } catch (e) {
      /* ئەم پارامەترە پشتگیری نەکرا */
    }
  }

  return orders.map((o) => {
    const info = o.info || {};
    const fromInfo = Number(info.slTriggerPx || info.tpTriggerPx || 0) || null;
    const trigger = o.triggerPrice ?? o.stopPrice ?? fromInfo;
    let kind = 'conditional';
    if (info.slTriggerPx || o.stopLossPrice) kind = 'stopLoss';
    else if (info.tpTriggerPx || o.takeProfitPrice) kind = 'takeProfit';
    return {
      id: o.id,
      symbol: displaySymbol(o.symbol),
      side: o.side,
      amount: o.amount,
      triggerPrice: trigger,
      kind,
      reduceOnly: Boolean(o.reduceOnly ?? info.reduceOnly === 'true'),
    };
  });
}

async function cancelAlgoOrder(id, symbol) {
  const ex = await ensureMarkets('swap');
  const sym = normalizeSymbol(symbol, 'swap');
  let lastError;
  for (const params of [{ trigger: true }, { stop: true }, {}]) {
    try {
      return await ex.cancelOrder(id, sym, params);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('نەتوانرا فەرمانە مەرجدارەکە هەڵبوەشێنرێتەوە');
}

async function setPositionSLTP(symbol, { stopLoss, takeProfit }) {
  assertFutures('swap');
  const ex = await ensureMarkets('swap');
  const sym = normalizeSymbol(symbol, 'swap');

  const positions = await fetchPositions(symbol);
  const pos = positions.find((p) => p.symbol === displaySymbol(symbol));
  if (!pos) throw new Error('هیچ پۆزیشنێکی کراوە نەدۆزرایەوە بۆ ئەم هێمایە');

  const cancelled = [];
  try {
    for (const o of await fetchAlgoOrders(symbol)) {
      if (o.kind === 'stopLoss' || o.kind === 'takeProfit' || o.reduceOnly) {
        try {
          await cancelAlgoOrder(o.id, symbol);
          cancelled.push(o.id);
        } catch (e) {
          /* لەوانەیە پێشتر جێبەجێ کرابێت */
        }
      }
    }
  } catch (e) {
    /* لیستی algo پشتگیری نەکرا */
  }

  const exitSide = pos.side === 'long' ? 'sell' : 'buy';
  const amount = Number(ex.amountToPrecision(sym, Math.abs(pos.contracts)));
  const base = exchangeParams('swap', pos.marginMode || 'isolated', true);
  const placed = [];

  if (stopLoss) {
    const o = await ex.createOrder(sym, 'market', exitSide, amount, undefined, {
      ...base,
      stopLossPrice: Number(ex.priceToPrecision(sym, stopLoss)),
    });
    placed.push({ kind: 'stopLoss', id: o.id, price: stopLoss });
  }
  if (takeProfit) {
    const o = await ex.createOrder(sym, 'market', exitSide, amount, undefined, {
      ...base,
      takeProfitPrice: Number(ex.priceToPrecision(sym, takeProfit)),
    });
    placed.push({ kind: 'takeProfit', id: o.id, price: takeProfit });
  }

  return { symbol: displaySymbol(symbol), cancelled, placed };
}

async function closePosition(symbol, percent = 100) {
  const positions = await fetchPositions(symbol);
  const pos = positions.find((p) => p.symbol === displaySymbol(symbol));
  if (!pos) throw new Error('هیچ پۆزیشنێکی کراوە نەدۆزرایەوە');

  return placeOrder({
    symbol,
    marketType: 'swap',
    side: pos.side === 'long' ? 'sell' : 'buy',
    type: 'market',
    amount: Math.abs(pos.contracts) * (percent / 100),
    reduceOnly: true,
    marginMode: pos.marginMode,
  });
}

module.exports = {
  reset,
  meta,
  currentId,
  listExchanges: registry.list,
  getClient,
  ensureMarkets,
  normalizeSymbol,
  displaySymbol,
  testConnection,
  listSymbols,
  fetchOHLCV,
  fetchTicker,
  fetchTickers,
  fetchBalance,
  fetchPositions,
  setLeverage,
  fetchOpenOrders,
  cancelOrder,
  fetchMyTrades,
  amountFromQuote,
  placeOrder,
  closePosition,
  fetchAlgoOrders,
  cancelAlgoOrder,
  setPositionSLTP,
};
