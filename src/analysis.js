'use strict';

const ind = require('./indicators');
const exchange = require('./exchange');

const round = (v, d = 6) => (v == null ? null : Number(Number(v).toFixed(d)));

/** پێکهێنانی پوختەی تەکنیکی بۆ یەک تایم‌فرەیم */
function snapshotFromCandles(candles) {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const price = closes[closes.length - 1];

  const ema20 = ind.ema(closes, 20);
  const ema50 = ind.ema(closes, 50);
  const ema200 = ind.ema(closes, 200);
  const rsi14 = ind.rsi(closes, 14);
  const macdRes = ind.macd(closes);
  const atr14 = ind.atr(highs, lows, closes, 14);
  const bb = ind.bollinger(closes, 20, 2);
  const stoch = ind.stochastic(highs, lows, closes);
  const adxRes = ind.adx(highs, lows, closes, 14);
  const vwap20 = ind.vwap(highs, lows, closes, volumes, 20);
  const levels = ind.nearestLevels(price, ind.pivots(highs, lows, 5, 5), 3);

  const atrVal = ind.last(atr14);
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
  const lastVol = volumes[volumes.length - 1];

  const e20 = ind.last(ema20);
  const e50 = ind.last(ema50);
  const e200 = ind.last(ema200);

  let trend = 'ناڕوون';
  if (e20 && e50 && e200) {
    if (price > e20 && e20 > e50 && e50 > e200) trend = 'سەرکەوتووی بەهێز';
    else if (price > e50 && e50 > e200) trend = 'سەرکەوتوو';
    else if (price < e20 && e20 < e50 && e50 < e200) trend = 'داکەوتووی بەهێز';
    else if (price < e50 && e50 < e200) trend = 'داکەوتوو';
    else trend = 'لاتەریفی/ناڕوون';
  }

  return {
    price: round(price, 8),
    change24hPercent: round(((price - closes[Math.max(0, closes.length - 24)]) / closes[Math.max(0, closes.length - 24)]) * 100, 2),
    trend,
    ema20: round(e20, 8),
    ema50: round(e50, 8),
    ema200: round(e200, 8),
    rsi14: round(ind.last(rsi14), 2),
    macd: round(ind.last(macdRes.macd), 8),
    macdSignal: round(ind.last(macdRes.signal), 8),
    macdHistogram: round(ind.last(macdRes.histogram), 8),
    atr14: round(atrVal, 8),
    atrPercent: round((atrVal / price) * 100, 2),
    bbUpper: round(ind.last(bb.upper), 8),
    bbMiddle: round(ind.last(bb.middle), 8),
    bbLower: round(ind.last(bb.lower), 8),
    stochK: round(ind.last(stoch.k), 2),
    stochD: round(ind.last(stoch.d), 2),
    adx: round(ind.last(adxRes.adx), 2),
    plusDI: round(ind.last(adxRes.plusDI), 2),
    minusDI: round(ind.last(adxRes.minusDI), 2),
    vwap20: round(ind.last(vwap20), 8),
    volumeVsAvg: round(lastVol / (avgVol || 1), 2),
    supportLevels: levels.support.map((p) => round(p, 8)),
    resistanceLevels: levels.resistance.map((p) => round(p, 8)),
    recentHigh: round(Math.max(...highs.slice(-50)), 8),
    recentLow: round(Math.min(...lows.slice(-50)), 8),
  };
}

/** کۆکردنەوەی داتا لە چەند تایم‌فرەیمێکەوە بۆ شیکاری AI */
async function buildContext(symbol, marketType, timeframes = ['15m', '1h', '4h', '1d']) {
  const out = { symbol, marketType, generatedAt: new Date().toISOString(), timeframes: {} };

  for (const tf of timeframes) {
    try {
      const candles = await exchange.fetchOHLCV(symbol, tf, 300, marketType);
      if (candles.length < 60) continue;
      out.timeframes[tf] = snapshotFromCandles(candles);
    } catch (e) {
      out.timeframes[tf] = { error: e.message };
    }
  }

  try {
    const t = await exchange.fetchTicker(symbol, marketType);
    out.ticker = t;
  } catch (e) {
    out.ticker = { error: e.message };
  }

  return out;
}

module.exports = { snapshotFromCandles, buildContext };
