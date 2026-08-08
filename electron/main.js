'use strict';

const { app, BrowserWindow, ipcMain, dialog, Notification, shell } = require('electron');
const path = require('path');

const store = require('../src/store');
const exchange = require('../src/exchange');
const analysis = require('../src/analysis');
const ai = require('../src/ai');
const risk = require('../src/risk');
const journal = require('../src/journal');
const drawings = require('../src/drawings');

let mainWindow = null;
let alertTimer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: '#000000',
    title: 'Hirani Crypto Trade Bot',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();

  // بەستەرە دەرەکییەکان لە وێبگەڕی سیستەمدا بکەرەوە، نەک لە ناو ئەپەکەدا
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  startAlertWatcher();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (alertTimer) clearInterval(alertTimer);
  if (process.platform !== 'darwin') app.quit();
});

/* ══════════ یارمەتیدەر ══════════ */

// کۆدە باوەکانی هەڵە دەکەنە پەیامێکی ڕوون
function translateError(message) {
  const s = store.load();
  const raw = String(message || '');
  const info = (() => {
    try {
      return exchange.meta();
    } catch (e) {
      return { name: 'exchange', sandbox: false };
    }
  })();

  if (raw.includes('50101') || /does not match current environment/i.test(raw)) {
    return s.demoMode
      ? `کلیلی API لەگەڵ ژینگەکە یەک ناگرێتەوە: ئەپەکە لە مۆدی Demo دایە بەڵام کلیلەکەت هی هەژماری ڕاستەقینەیە. یان لە ${info.name} کلیلێکی Demo دروست بکە، یان لە ڕێکخستنەکان مۆدی تاقیکردنەوە لابدە.`
      : `کلیلی API لەگەڵ ژینگەکە یەک ناگرێتەوە: ئەپەکە لە مۆدی Live دایە بەڵام کلیلەکەت هی ژینگەی تاقیکردنەوەیە.`;
  }
  if (/Invalid Sign|signature|50111|50113|API-key format invalid/i.test(raw)) {
    return 'کلیلی API یان Secret نادروستە. لە ڕێکخستنەکان دووبارە دایانبنێ.';
  }
  if (/passphrase|50105/i.test(raw)) {
    return 'Passphrase نادروستە. ئەوەیە کە لە کاتی دروستکردنی کلیلەکەدا نووسیوتە.';
  }
  if (/50110|IP .*not|restricted ip/i.test(raw)) {
    return 'ئای‌پی ئەم ئامێرە ڕێپێدراو نییە بۆ ئەم کلیلە. لە بۆرسەکە ئای‌پی زیاد بکە یان سنووری ئای‌پی لابدە.';
  }
  if (/insufficient|51008|balance/i.test(raw)) {
    return 'باڵانسی پێویست نییە بۆ ئەم فەرمانە.';
  }
  if (/leverage|51004/i.test(raw)) {
    return 'کێشە لە لیڤەرێج یان قەبارەی پۆزیشن — لیڤەرێج کەم بکەرەوە یان قەبارە بگۆڕە.';
  }
  if (/ETIMEDOUT|ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(raw)) {
    return 'پەیوەندی نەکرا. ئینتەرنێت بپشکنە (لەوانەیە پێویستت بە VPN بێت).';
  }
  if (/401|Unauthorized|invalid_api_key|API key not valid/i.test(raw)) {
    return 'کلیلی AI نادروستە یان بەسەرچووە. لە ڕێکخستنەکان بیگۆڕە.';
  }
  if (/429|rate limit|quota/i.test(raw)) {
    return 'سنووری داواکاری تێپەڕێنرا. چەند چرکەیەک چاوەڕێ بکە و دووبارە هەوڵ بدەوە.';
  }
  return raw;
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: translateError(err?.message || String(err)) };
    }
  });
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
  mainWindow?.webContents.send('app:toast', { title, body });
}

/* ══════════ ڕێکخستنەکان ══════════ */

handle('settings:get', async () => store.publicSettings());

handle('settings:save', async (patch) => {
  store.save(patch || {});
  exchange.reset();
  ai.resetClient();
  return store.publicSettings();
});

handle('settings:exchanges', async () => exchange.listExchanges());
handle('settings:aiProviders', async () => ai.listProviders());

handle('settings:saveExchangeKeys', async ({ exchangeId, apiKey, secret, password }) => {
  store.setExchangeCreds(exchangeId, { apiKey, secret, password });
  exchange.reset();
  return store.publicSettings();
});

handle('settings:clearExchangeKeys', async (exchangeId) => {
  store.clearExchangeCreds(exchangeId);
  exchange.reset();
  return store.publicSettings();
});

handle('settings:saveAiKey', async ({ provider, key }) => {
  store.setAiKey(provider, key);
  ai.resetClient();
  return store.publicSettings();
});

handle('settings:testExchange', async () => exchange.testConnection());
handle('settings:testAI', async () => ai.testProvider());

handle('app:openExternal', async (url) => {
  if (/^https:\/\//i.test(url)) await shell.openExternal(url);
  return true;
});

/* ══════════ بازاڕ ══════════ */

handle('market:symbols', async (marketType) => exchange.listSymbols(marketType || 'spot'));
handle('market:ticker', async (symbol, marketType) => exchange.fetchTicker(symbol, marketType));
handle('market:tickers', async (symbols, marketType) => exchange.fetchTickers(symbols, marketType));
handle('market:candles', async (symbol, timeframe, limit, marketType) =>
  exchange.fetchOHLCV(symbol, timeframe, limit || 300, marketType)
);
handle('market:indicators', async (symbol, timeframe, marketType) => {
  const candles = await exchange.fetchOHLCV(symbol, timeframe, 300, marketType);
  return analysis.snapshotFromCandles(candles);
});

/* ══════════ هەژمار ══════════ */

handle('account:balance', async (marketType) => exchange.fetchBalance(marketType));
handle('account:positions', async (symbol) => exchange.fetchPositions(symbol));
handle('account:openOrders', async (symbol, marketType) =>
  exchange.fetchOpenOrders(symbol, marketType)
);
handle('account:trades', async (symbol, marketType) => exchange.fetchMyTrades(symbol, marketType));
handle('account:cancelOrder', async (id, symbol, marketType) =>
  exchange.cancelOrder(id, symbol, marketType)
);

/* ══════════ AI ══════════ */

handle('ai:analyze', async ({ symbol, marketType, timeframes, userNote }) => {
  const context = await analysis.buildContext(
    symbol,
    marketType,
    timeframes && timeframes.length ? timeframes : ['15m', '1h', '4h', '1d']
  );

  let balanceUSDT = null;
  try {
    balanceUSDT = (await exchange.fetchBalance(marketType)).totalUSDT;
  } catch (e) {
    /* بێ کلیلی API — بەبێ باڵانس بەردەوام دەبین */
  }

  const signal = await ai.getSignal(context, {
    userNote,
    balanceUSDT,
    exchangeName: exchange.meta().name,
  });

  const position =
    balanceUSDT && signal.entryPrice && signal.stopLoss
      ? risk.calculatePosition({
          balanceUSDT,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          leverage: signal.leverage,
        })
      : null;

  const firstTP = signal.takeProfits?.[0]?.price;
  journal.add({ kind: 'signal', symbol, marketType, signal });

  return {
    signal,
    position,
    validation: risk.validate(signal, position, {}),
    computedRR: firstTP ? risk.riskReward(signal.entryPrice, signal.stopLoss, firstTP) : null,
    balanceUSDT,
    context,
  };
});

handle('ai:ask', async ({ question, symbol, marketType, includeContext }) => {
  let context = null;
  if (includeContext && symbol) {
    context = await analysis.buildContext(symbol, marketType, ['1h', '4h', '1d']);
  }
  return { answer: await ai.ask(question, context) };
});

/* ══════════ مامەڵە ══════════ */

handle('trade:calculate', async (payload) => risk.calculatePosition(payload));

handle('trade:place', async (order) => {
  const s = store.load();

  // کردارێکی گەڕانەوەناپەزیرە — داوای دڵنیایی دەکەین
  if (s.confirmBeforeOrder) {
    const info = exchange.meta();
    const detail = [
      `${info.name} · ${order.marketType === 'swap' ? 'FUTURES' : 'SPOT'}`,
      `${order.symbol}`,
      `${order.side === 'buy' ? 'BUY / LONG' : 'SELL / SHORT'} · ${order.type}`,
      order.quoteAmount ? `${order.quoteAmount} USDT` : `${order.amount}`,
      order.price ? `@ ${order.price}` : '',
      order.leverage ? `${order.leverage}x` : '',
      order.stopLoss ? `SL: ${order.stopLoss}` : '',
      order.takeProfit ? `TP: ${order.takeProfit}` : '',
      '',
      s.demoMode ? '⚠ DEMO MODE' : '🔴 LIVE ACCOUNT — REAL MONEY',
    ]
      .filter(Boolean)
      .join('\n');

    const res = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Confirm', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Confirm order',
      message: 'Place this order?',
      detail,
    });
    if (res.response !== 0) throw new Error('فەرمانەکە هەڵوەشێنرایەوە');
  }

  const result = await exchange.placeOrder(order);
  journal.add({ kind: 'order', symbol: order.symbol, request: order, result });
  notify('Order placed', `${order.symbol} · ${order.side} · ${result.status || 'ok'}`);
  return result;
});

handle('trade:closePosition', async ({ symbol, percent }) => {
  const result = await exchange.closePosition(symbol, percent || 100);
  journal.add({ kind: 'close', symbol, percent, result });
  notify('Position closed', `${symbol} · ${percent || 100}%`);
  return result;
});

handle('trade:setLeverage', async ({ symbol, leverage, marginMode }) =>
  exchange.setLeverage(symbol, leverage, marginMode)
);

handle('trade:algoOrders', async (symbol) => exchange.fetchAlgoOrders(symbol));

handle('trade:setSLTP', async ({ symbol, stopLoss, takeProfit }) => {
  const s = store.load();

  if (s.confirmBeforeOrder) {
    const res = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Confirm', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Update SL / TP',
      message: `Update protections for ${symbol}?`,
      detail: [
        stopLoss ? `Stop loss: ${stopLoss}` : 'Stop loss: unchanged',
        takeProfit ? `Take profit: ${takeProfit}` : 'Take profit: unchanged',
        '',
        'Existing conditional orders will be cancelled first.',
      ].join('\n'),
    });
    if (res.response !== 0) throw new Error('گۆڕانکاری هەڵوەشێنرایەوە');
  }

  const result = await exchange.setPositionSLTP(symbol, { stopLoss, takeProfit });
  journal.add({ kind: 'sltp', symbol, request: { stopLoss, takeProfit }, result });
  notify('SL/TP updated', symbol);
  return result;
});

handle('trade:cancelAlgo', async ({ id, symbol }) => exchange.cancelAlgoOrder(id, symbol));

/* ══════════ هێڵکاری ══════════ */

handle('drawings:list', async ({ symbol, marketType }) => drawings.list(symbol, marketType));
handle('drawings:save', async ({ symbol, marketType, items }) =>
  drawings.save(symbol, marketType, items)
);
handle('drawings:clear', async ({ symbol, marketType }) => drawings.clear(symbol, marketType));

/* ══════════ تۆمار ══════════ */

handle('journal:list', async (limit) => journal.list(limit));
handle('journal:stats', async () => journal.stats());
handle('journal:clear', async () => journal.clear());

/* ══════════ ئاگاداری ══════════ */

handle('alerts:list', async () => store.load().alerts || []);

handle('alerts:add', async (alert) => {
  const s = store.load();
  const alerts = [...(s.alerts || [])];
  alerts.push({
    id: `${Date.now()}`,
    symbol: alert.symbol,
    marketType: alert.marketType || 'spot',
    condition: alert.condition,
    price: Number(alert.price),
    triggered: false,
  });
  store.save({ alerts });
  return alerts;
});

handle('alerts:remove', async (id) => {
  const s = store.load();
  const alerts = (s.alerts || []).filter((a) => a.id !== id);
  store.save({ alerts });
  return alerts;
});

function startAlertWatcher() {
  alertTimer = setInterval(async () => {
    const s = store.load();
    const alerts = s.alerts || [];
    const pending = alerts.filter((a) => !a.triggered);
    if (!pending.length) return;

    let changed = false;
    for (const a of pending) {
      try {
        const t = await exchange.fetchTicker(a.symbol, a.marketType);
        const hit =
          (a.condition === 'above' && t.last >= a.price) ||
          (a.condition === 'below' && t.last <= a.price);
        if (hit) {
          a.triggered = true;
          changed = true;
          notify(
            `Alert: ${a.symbol}`,
            `Price ${a.condition} ${a.price} — now ${t.last}`
          );
        }
      } catch (e) {
        /* هەڵەی تۆڕ — لە خولی داهاتوودا هەوڵ دەدەینەوە */
      }
    }
    if (changed) store.save({ alerts });
  }, 30000);
}
