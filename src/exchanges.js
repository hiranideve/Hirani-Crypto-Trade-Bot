'use strict';

/**
 * تۆماری بۆرسەکان.
 *
 * هەر بۆرسەیەک جیاوازی خۆی هەیە: هەندێکیان Passphrase دەوێت، هەندێکیان
 * ژینگەی تاقیکردنەوەیان هەیە، و ناوی بازاڕی فیوچەریان جیاوازە.
 * ئەمە یەک شوێنە بۆ هەموو ئەو جیاوازییانە.
 */

const EXCHANGES = {
  okx: {
    id: 'okx',
    name: 'OKX',
    ccxtId: 'okx',
    swapType: 'swap',
    needsPassword: true,
    sandbox: true,
    // OKX کلیلی جیاوازی هەیە بۆ Demo Trading
    separateDemoKeys: true,
    tdMode: true,
    docs: 'https://www.okx.com/account/my-api',
  },
  binance: {
    id: 'binance',
    name: 'Binance',
    ccxtId: 'binance',
    swapType: 'future',
    needsPassword: false,
    sandbox: true,
    separateDemoKeys: true,
    docs: 'https://www.binance.com/en/my/settings/api-management',
  },
  bybit: {
    id: 'bybit',
    name: 'Bybit',
    ccxtId: 'bybit',
    swapType: 'swap',
    needsPassword: false,
    sandbox: true,
    separateDemoKeys: true,
    docs: 'https://www.bybit.com/app/user/api-management',
  },
  bitget: {
    id: 'bitget',
    name: 'Bitget',
    ccxtId: 'bitget',
    swapType: 'swap',
    needsPassword: true,
    sandbox: false,
    docs: 'https://www.bitget.com/account/newapi',
  },
  gate: {
    id: 'gate',
    name: 'Gate.io',
    ccxtId: 'gate',
    swapType: 'swap',
    needsPassword: false,
    sandbox: false,
    docs: 'https://www.gate.io/myaccount/api_key_manage',
  },
  mexc: {
    id: 'mexc',
    name: 'MEXC',
    ccxtId: 'mexc',
    swapType: 'swap',
    needsPassword: false,
    sandbox: false,
    docs: 'https://www.mexc.com/user/openapi',
  },
  kucoin: {
    id: 'kucoin',
    name: 'KuCoin',
    ccxtId: 'kucoin',
    futuresCcxtId: 'kucoinfutures', // KuCoin کلاسێکی جیاوازی هەیە بۆ فیوچەر
    swapType: 'swap',
    needsPassword: true,
    sandbox: true,
    docs: 'https://www.kucoin.com/account/api',
  },
  htx: {
    id: 'htx',
    name: 'HTX (Huobi)',
    ccxtId: 'htx',
    swapType: 'swap',
    needsPassword: false,
    sandbox: false,
    docs: 'https://www.htx.com/en-us/apikey/',
  },
  coinbase: {
    id: 'coinbase',
    name: 'Coinbase',
    ccxtId: 'coinbase',
    swapType: null, // تەنیا سپۆت
    needsPassword: false,
    sandbox: false,
    docs: 'https://www.coinbase.com/settings/api',
  },
  kraken: {
    id: 'kraken',
    name: 'Kraken',
    ccxtId: 'kraken',
    swapType: null,
    needsPassword: false,
    sandbox: false,
    docs: 'https://www.kraken.com/u/security/api',
  },
};

function get(id) {
  const ex = EXCHANGES[id];
  if (!ex) throw new Error(`بۆرسەی ناناسراو: ${id}`);
  return ex;
}

function list() {
  return Object.values(EXCHANGES).map((e) => ({
    id: e.id,
    name: e.name,
    needsPassword: e.needsPassword,
    sandbox: e.sandbox,
    separateDemoKeys: Boolean(e.separateDemoKeys),
    supportsFutures: Boolean(e.swapType),
    docs: e.docs,
  }));
}

module.exports = { EXCHANGES, get, list };
