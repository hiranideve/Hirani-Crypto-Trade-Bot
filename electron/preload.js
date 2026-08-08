'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// پردێکی سنووردار — ڕێندەرەر هیچ دەستڕاگەیشتنێکی ڕاستەوخۆی بە Node نییە
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  settings: {
    get: () => invoke('settings:get'),
    save: (patch) => invoke('settings:save', patch),
    exchanges: () => invoke('settings:exchanges'),
    aiProviders: () => invoke('settings:aiProviders'),
    saveExchangeKeys: (payload) => invoke('settings:saveExchangeKeys', payload),
    clearExchangeKeys: (id) => invoke('settings:clearExchangeKeys', id),
    saveAiKey: (payload) => invoke('settings:saveAiKey', payload),
    testExchange: () => invoke('settings:testExchange'),
    testAI: () => invoke('settings:testAI'),
  },
  app: {
    openExternal: (url) => invoke('app:openExternal', url),
  },
  market: {
    symbols: (marketType) => invoke('market:symbols', marketType),
    ticker: (symbol, marketType) => invoke('market:ticker', symbol, marketType),
    tickers: (symbols, marketType) => invoke('market:tickers', symbols, marketType),
    candles: (symbol, timeframe, limit, marketType) =>
      invoke('market:candles', symbol, timeframe, limit, marketType),
    indicators: (symbol, timeframe, marketType) =>
      invoke('market:indicators', symbol, timeframe, marketType),
  },
  account: {
    balance: (marketType) => invoke('account:balance', marketType),
    positions: (symbol) => invoke('account:positions', symbol),
    openOrders: (symbol, marketType) => invoke('account:openOrders', symbol, marketType),
    trades: (symbol, marketType) => invoke('account:trades', symbol, marketType),
    cancelOrder: (id, symbol, marketType) => invoke('account:cancelOrder', id, symbol, marketType),
  },
  ai: {
    analyze: (payload) => invoke('ai:analyze', payload),
    ask: (payload) => invoke('ai:ask', payload),
  },
  trade: {
    calculate: (payload) => invoke('trade:calculate', payload),
    place: (order) => invoke('trade:place', order),
    closePosition: (payload) => invoke('trade:closePosition', payload),
    setLeverage: (payload) => invoke('trade:setLeverage', payload),
    algoOrders: (symbol) => invoke('trade:algoOrders', symbol),
    setSLTP: (payload) => invoke('trade:setSLTP', payload),
    cancelAlgo: (payload) => invoke('trade:cancelAlgo', payload),
  },
  drawings: {
    list: (payload) => invoke('drawings:list', payload),
    save: (payload) => invoke('drawings:save', payload),
    clear: (payload) => invoke('drawings:clear', payload),
  },
  journal: {
    list: (limit) => invoke('journal:list', limit),
    stats: () => invoke('journal:stats'),
    clear: () => invoke('journal:clear'),
  },
  alerts: {
    list: () => invoke('alerts:list'),
    add: (alert) => invoke('alerts:add', alert),
    remove: (id) => invoke('alerts:remove', id),
  },
  onToast: (cb) => ipcRenderer.on('app:toast', (_e, payload) => cb(payload)),
});
