'use strict';

const store = require('./store');

/**
 * قەبارەی پۆزیشن دەژمێرێت بەپێی مەترسی ڕێژەیی.
 * فۆرمولا: مەترسی بە دۆلار = باڵانس × riskPercent
 *          بڕی مامەڵە (USDT) = مەترسی ÷ (دووری ستۆپ بە ڕێژە)
 */
function calculatePosition({ balanceUSDT, entryPrice, stopLoss, leverage = 1, riskPercent }) {
  const s = store.load();
  const risk = riskPercent != null ? riskPercent : s.riskPercent;

  if (!balanceUSDT || !entryPrice || !stopLoss) {
    return { error: 'داتای ناتەواو بۆ ژمێریاری قەبارە' };
  }

  const stopDistance = Math.abs(entryPrice - stopLoss);
  const stopDistancePercent = (stopDistance / entryPrice) * 100;
  if (stopDistancePercent <= 0) return { error: 'ستۆپ لۆس نادروستە' };

  const riskAmountUSDT = (balanceUSDT * risk) / 100;

  // بڕی نۆشناڵ کە ئەگەر ستۆپ بکەوێت هێندە زیانمان دەبێت
  const notionalUSDT = riskAmountUSDT / (stopDistancePercent / 100);

  // مارجینی پێویست (بۆ سپۆت leverage = 1)
  const marginUSDT = notionalUSDT / leverage;

  const capped = Math.min(marginUSDT, balanceUSDT * 0.95);
  const cappedNotional = capped * leverage;

  return {
    riskPercent: risk,
    riskAmountUSDT: Number(riskAmountUSDT.toFixed(2)),
    stopDistancePercent: Number(stopDistancePercent.toFixed(2)),
    notionalUSDT: Number(cappedNotional.toFixed(2)),
    marginUSDT: Number(capped.toFixed(2)),
    leverage,
    wasCapped: marginUSDT > balanceUSDT * 0.95,
    liquidationEstimate:
      leverage > 1
        ? Number((entryPrice * (1 - 0.9 / leverage)).toFixed(8))
        : null,
  };
}

/** ڕێژەی مەترسی/قازانج دەژمێرێت */
function riskReward(entry, stopLoss, takeProfit) {
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (risk === 0) return null;
  return Number((reward / risk).toFixed(2));
}

/** پشکنینی ئاسایشی پێش ناردنی فەرمان */
function validate(signal, position, extra = {}) {
  const s = store.load();
  const issues = [];

  if (!signal) issues.push('سیگناڵ بەردەست نییە');
  if (signal && ['wait', 'avoid'].includes(signal.recommendation)) {
    issues.push('AI پێشنیاری چاوەڕوانی/دوورکەوتنەوە دەکات — مامەڵە پێشنیار ناکرێت');
  }
  if (signal && signal.confidence < 50) {
    issues.push(`متمانەی AI نزمە (${signal.confidence}%)`);
  }
  if (signal && signal.riskRewardRatio < 1.5) {
    issues.push(`ڕێژەی R:R نزمە (${signal.riskRewardRatio})`);
  }
  if (position?.error) issues.push(position.error);
  if (position?.wasCapped) {
    issues.push('قەبارەکە بۆ سنووری باڵانس کەمکراوەتەوە');
  }
  if (signal && signal.leverage > s.maxLeverage) {
    issues.push(`لیڤەرێج لە سنوور تێپەڕیوە (زۆرترین ${s.maxLeverage}x)`);
  }
  if (extra.openPositions != null && extra.openPositions >= s.maxOpenPositions) {
    issues.push(`ژمارەی پۆزیشنە کراوەکان گەیشتووەتە سنوور (${s.maxOpenPositions})`);
  }

  return { ok: issues.length === 0, issues };
}

module.exports = { calculatePosition, riskReward, validate };
