'use strict';

// ئەندیکەیتەری تەکنیکی — هەموویان بە دەستی نووسراون (بێ پاکێجی دەرەکی)
// هەموو فەنکشنەکان ئارەیەک دەگەڕێننەوە بە هەمان درێژی داتاکە، ناچالاکەکان = null

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += values[j];
      prev = sum / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function rma(values, period) {
  // Wilder's smoothing — بۆ RSI و ATR
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += values[j];
      prev = sum / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = (prev * (period - 1) + values[i]) / period;
      out[i] = prev;
    }
  }
  return out;
}

function rsi(closes, period = 14) {
  const gains = [0];
  const losses = [0];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  const ag = rma(gains, period);
  const al = rma(losses, period);
  return closes.map((_, i) => {
    if (ag[i] == null || al[i] == null) return null;
    if (al[i] === 0) return 100;
    const rs = ag[i] / al[i];
    return 100 - 100 / (1 + rs);
  });
}

function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    ef[i] == null || es[i] == null ? null : ef[i] - es[i]
  );
  const valid = macdLine.filter((v) => v != null);
  const sigValid = ema(valid, signalPeriod);
  const offset = macdLine.length - valid.length;
  const signal = new Array(closes.length).fill(null);
  for (let i = 0; i < sigValid.length; i++) {
    if (sigValid[i] != null) signal[i + offset] = sigValid[i];
  }
  const hist = macdLine.map((v, i) =>
    v == null || signal[i] == null ? null : v - signal[i]
  );
  return { macd: macdLine, signal, histogram: hist };
}

function trueRange(highs, lows, closes) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      )
    );
  }
  return tr;
}

function atr(highs, lows, closes, period = 14) {
  return rma(trueRange(highs, lows, closes), period);
}

function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(sum / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { upper, middle: mid, lower };
}

function stochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const k = new Array(closes.length).fill(null);
  for (let i = kPeriod - 1; i < closes.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    k[i] = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
  }
  const kValid = k.filter((v) => v != null);
  const dValid = sma(kValid, dPeriod);
  const offset = k.length - kValid.length;
  const d = new Array(closes.length).fill(null);
  for (let i = 0; i < dValid.length; i++) {
    if (dValid[i] != null) d[i + offset] = dValid[i];
  }
  return { k, d };
}

function adx(highs, lows, closes, period = 14) {
  const plusDM = [0];
  const minusDM = [0];
  for (let i = 1; i < closes.length; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const trs = rma(trueRange(highs, lows, closes), period);
  const pdm = rma(plusDM, period);
  const mdm = rma(minusDM, period);
  const plusDI = closes.map((_, i) =>
    trs[i] == null || pdm[i] == null || trs[i] === 0 ? null : (pdm[i] / trs[i]) * 100
  );
  const minusDI = closes.map((_, i) =>
    trs[i] == null || mdm[i] == null || trs[i] === 0 ? null : (mdm[i] / trs[i]) * 100
  );
  const dx = closes.map((_, i) => {
    if (plusDI[i] == null || minusDI[i] == null) return null;
    const s = plusDI[i] + minusDI[i];
    return s === 0 ? 0 : (Math.abs(plusDI[i] - minusDI[i]) / s) * 100;
  });
  const dxValid = dx.filter((v) => v != null);
  const adxValid = rma(dxValid, period);
  const offset = dx.length - dxValid.length;
  const adxArr = new Array(closes.length).fill(null);
  for (let i = 0; i < adxValid.length; i++) {
    if (adxValid[i] != null) adxArr[i + offset] = adxValid[i];
  }
  return { adx: adxArr, plusDI, minusDI };
}

// پێوانەی قەبارە — VWAP ی گەڕاوە بۆ n کەندڵی کۆتایی
function vwap(highs, lows, closes, volumes, period = 20) {
  const out = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let pv = 0;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const tp = (highs[j] + lows[j] + closes[j]) / 3;
      pv += tp * volumes[j];
      v += volumes[j];
    }
    out[i] = v === 0 ? null : pv / v;
  }
  return out;
}

// دۆزینەوەی ئاستی پشتیوانی/بەرگری بە پیڤۆتی سوینگ
function pivots(highs, lows, left = 5, right = 5) {
  const resistances = [];
  const supports = [];
  for (let i = left; i < highs.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isHigh = false;
      if (lows[j] <= lows[i]) isLow = false;
    }
    if (isHigh) resistances.push({ index: i, price: highs[i] });
    if (isLow) supports.push({ index: i, price: lows[i] });
  }
  return { supports, resistances };
}

// نزیکترین ئاستەکان بۆ نرخی ئێستا
function nearestLevels(price, { supports, resistances }, count = 3) {
  const below = supports
    .map((s) => s.price)
    .concat(resistances.map((r) => r.price))
    .filter((p) => p < price)
    .sort((a, b) => b - a)
    .slice(0, count);
  const above = supports
    .map((s) => s.price)
    .concat(resistances.map((r) => r.price))
    .filter((p) => p > price)
    .sort((a, b) => a - b)
    .slice(0, count);
  return { support: below, resistance: above };
}

const last = (arr) => {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
};

module.exports = {
  sma,
  ema,
  rma,
  rsi,
  macd,
  atr,
  bollinger,
  stochastic,
  adx,
  vwap,
  pivots,
  nearestLevels,
  last,
};
