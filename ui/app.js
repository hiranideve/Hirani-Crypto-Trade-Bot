'use strict';

const t = (k) => window.i18n.t(k);
const $ = (id) => document.getElementById(id);

const state = {
  symbol: 'BTC/USDT',
  marketType: 'spot',
  timeframe: '1h',
  settings: null,
  exchanges: [],
  providers: [],
  candles: [],
  positions: [],
  algoOrders: [],
  lastSignal: null,
  lastResult: null,
  watchlist: [],
  chart: null,
  modalSymbol: null,
  refreshTimer: null,
};

/* ══════════ یارمەتیدەر ══════════ */

const fmt = (n, d = 2) =>
  n == null || Number.isNaN(Number(n))
    ? '—'
    : Number(n).toLocaleString('en-US', { maximumFractionDigits: d });

const fmtPrice = (n) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const a = Math.abs(n);
  return Number(n).toFixed(a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8);
};

const fmtCompact = (n) => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return fmt(n, 2);
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);

/** هەموو بانگەکانی IPC وەڵامی {ok,data|error} دەگەڕێننەوە */
async function call(promise) {
  const res = await promise;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

function toast(title, body) {
  const el = $('toast');
  el.innerHTML = `<div class="t-title">${esc(title)}</div><div class="t-body">${esc(body || '')}</div>`;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 4500);
}

/* ══════════ دەستپێک ══════════ */

window.addEventListener('DOMContentLoaded', async () => {
  initChart();
  bindTabs();
  bindHeader();
  bindChartToolbar();
  bindPositionModal();
  bindTrade();
  bindOrders();
  bindChat();
  bindAlerts();
  bindJournal();
  bindSettings();

  window.api.onToast(({ title, body }) => toast(title, body));

  await loadStaticLists();
  await loadSettings();
  await loadSymbols();
  await refreshAll();

  state.refreshTimer = setInterval(refreshLight, 15000);
});

async function loadStaticLists() {
  try {
    state.exchanges = await call(window.api.settings.exchanges());
    state.providers = await call(window.api.settings.aiProviders());
  } catch (e) {
    state.exchanges = [];
    state.providers = [];
  }

  // هەڵبژێری زمان — لە سەرەوە و لە ڕێکخستنەکان
  const opts = window.i18n.LANGUAGES.map(
    (l) => `<option value="${l.code}">${l.label}</option>`
  ).join('');
  $('langSelect').innerHTML = opts;
  $('setLanguage').innerHTML = opts;

  $('exchangeSelect').innerHTML = state.exchanges
    .map((e) => `<option value="${e.id}">${esc(e.name)}</option>`)
    .join('');
  $('aiProviderSelect').innerHTML = state.providers
    .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
    .join('');
}

/* ══════════ چارت ══════════ */

function initChart() {
  state.chart = new window.TradeChart($('chart'), {
    onDrawingsChange: async (items) => {
      await window.api.drawings.save({
        symbol: state.symbol,
        marketType: state.marketType,
        items,
      });
    },
    onSLTPChange: async ({ kind, price }) => {
      try {
        const payload = { symbol: state.symbol };
        if (kind === 'takeProfit') payload.takeProfit = Number(price.toFixed(8));
        else payload.stopLoss = Number(price.toFixed(8));

        // نرخی هەبووی ئەوی تر دەپارێزین تاکو نەسڕدرێتەوە
        const other = state.algoOrders.find((a) =>
          kind === 'takeProfit' ? a.kind === 'stopLoss' : a.kind === 'takeProfit'
        );
        if (other?.triggerPrice) {
          if (kind === 'takeProfit') payload.stopLoss = other.triggerPrice;
          else payload.takeProfit = other.triggerPrice;
        }

        await call(window.api.trade.setSLTP(payload));
        toast(t('common.success'), `${kind === 'takeProfit' ? 'TP' : 'SL'} → ${fmtPrice(price)}`);
      } catch (e) {
        toast(t('common.error'), e.message);
      }
      await refreshPositionOverlay();
    },
    onCrosshair: (candle) => {
      const el = $('ohlcReadout');
      if (!candle) {
        el.textContent = '';
        return;
      }
      const up = candle.close >= candle.open;
      el.innerHTML =
        `<span class="${up ? 'pos' : 'neg'}">O <b>${fmtPrice(candle.open)}</b> ` +
        `H <b>${fmtPrice(candle.high)}</b> L <b>${fmtPrice(candle.low)}</b> ` +
        `C <b>${fmtPrice(candle.close)}</b></span> · V <b>${fmtCompact(candle.volume)}</b>`;
    },
  });
  window.__chart = state.chart;
}

function bindChartToolbar() {
  document.querySelectorAll('#toolGroup .tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#toolGroup .tool').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.chart.setTool(btn.dataset.tool);
    });
  });

  document.querySelectorAll('#overlayGroup .tool').forEach((btn) => {
    btn.addEventListener('click', () =>
      btn.classList.toggle('active', state.chart.toggleOverlay(btn.dataset.overlay))
    );
  });

  document.querySelectorAll('#paneGroup .tool').forEach((btn) => {
    btn.addEventListener('click', () =>
      btn.classList.toggle('active', state.chart.togglePane(btn.dataset.pane))
    );
  });

  $('delDrawBtn').addEventListener('click', () => state.chart.deleteSelected());
  $('clearDrawBtn').addEventListener('click', async () => {
    state.chart.clearDrawings();
    await window.api.drawings.clear({ symbol: state.symbol, marketType: state.marketType });
  });
  $('resetViewBtn').addEventListener('click', () => state.chart.resetView());
  $('dashReloadPos').addEventListener('click', refreshPositionOverlay);

  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') state.chart.deleteSelected();
    if (e.key === 'Escape') document.querySelector('#toolGroup .tool[data-tool="cursor"]').click();
  });
}

/* ══════════ تابەکان و سەرەوە ══════════ */

function bindTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      btn.classList.add('active');
      $(`view-${btn.dataset.tab}`).classList.add('active');

      if (btn.dataset.tab === 'orders') loadPositionsAndOrders();
      if (btn.dataset.tab === 'journal') loadJournal();
      if (btn.dataset.tab === 'alerts') loadAlerts();
      if (btn.dataset.tab === 'dashboard') state.chart.render();
    });
  });
}

function bindHeader() {
  document.querySelectorAll('#marketTypeSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#marketTypeSeg .seg-btn').forEach((b) =>
        b.classList.remove('active')
      );
      btn.classList.add('active');
      state.marketType = btn.dataset.value;
      toggleFuturesFields();
      await window.api.settings.save({ marketType: state.marketType });
      await loadSymbols();
      await refreshAll();
    });
  });

  document.querySelectorAll('#tfSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#tfSeg .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.timeframe = btn.dataset.tf;
      $('chartTf').textContent = btn.textContent;
      await window.api.settings.save({ defaultTimeframe: state.timeframe });
      await refreshChart();
      await refreshIndicators();
    });
  });

  $('symbolInput').addEventListener('change', async () => {
    const v = $('symbolInput').value.trim().toUpperCase();
    if (!v) return;
    state.symbol = v;
    await window.api.settings.save({ defaultSymbol: v });
    await refreshAll();
  });

  $('refreshBtn').addEventListener('click', refreshAll);
  $('analyzeBtn').addEventListener('click', runAnalysis);

  $('addWatchBtn').addEventListener('click', async () => {
    const sym = $('symbolInput').value.trim().toUpperCase();
    if (!sym || state.watchlist.includes(sym)) return;
    state.watchlist.push(sym);
    await window.api.settings.save({ watchlist: state.watchlist });
    await refreshWatchlist();
  });

  $('langSelect').addEventListener('change', async () => {
    await applyLanguage($('langSelect').value, true);
  });
}

async function applyLanguage(code, persist) {
  window.i18n.setLanguage(code);
  $('langSelect').value = code;
  $('setLanguage').value = code;
  if (persist) await window.api.settings.save({ language: code });
  // ڕووکارە دینامیکییەکان دووبارە دەنووسرێنەوە بە زمانی نوێ
  renderPositionsTable(state.positions);
  if (state.lastResult) renderSignal(state.lastResult);
  else renderSignalEmpty();
  await refreshIndicators();
  await refreshBalance();
}

function toggleFuturesFields() {
  const isSwap = state.marketType === 'swap';
  $('ordLevWrap').classList.toggle('hidden', !isSwap);
  $('ordMarginWrap').classList.toggle('hidden', !isSwap);
}

/* ══════════ بارکردن ══════════ */

async function loadSettings() {
  state.settings = await call(window.api.settings.get());
  const s = state.settings;

  state.symbol = s.defaultSymbol || 'BTC/USDT';
  state.marketType = s.marketType || 'spot';
  state.timeframe = s.defaultTimeframe || '1h';
  state.watchlist = s.watchlist || [];

  window.i18n.setLanguage(s.language || 'ku');
  $('langSelect').value = window.i18n.getLanguage();
  $('setLanguage').value = window.i18n.getLanguage();

  $('symbolInput').value = state.symbol;
  document.querySelectorAll('#marketTypeSeg .seg-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.value === state.marketType)
  );
  document.querySelectorAll('#tfSeg .seg-btn').forEach((b) => {
    const on = b.dataset.tf === state.timeframe;
    b.classList.toggle('active', on);
    if (on) $('chartTf').textContent = b.textContent;
  });

  const ex = state.exchanges.find((e) => e.id === s.exchangeId) || { name: s.exchangeId };
  $('exchangeBadge').textContent = ex.name;
  const demoActive = s.demoMode && ex.sandbox !== false;
  $('modeBadge').textContent = demoActive ? t('common.demo') : t('common.live');
  $('modeBadge').className = `chip ${demoActive ? 'demo' : 'live'}`;

  const prov = state.providers.find((p) => p.id === s.aiProvider);
  $('aiProviderChip').textContent = prov ? prov.name : s.aiProvider;

  // فۆرمی ڕێکخستن
  $('exchangeSelect').value = s.exchangeId;
  $('setDemo').checked = !!s.demoMode;
  $('aiProviderSelect').value = s.aiProvider;
  $('setAiEffort').value = s.aiEffort || 'high';
  $('setRisk').value = s.riskPercent;
  $('setMaxLev').value = s.maxLeverage;
  $('setDefLev').value = s.defaultLeverage;
  $('setMaxPos').value = s.maxOpenPositions;
  $('setDailyLoss').value = s.dailyLossLimitPercent;
  $('setConfirm').checked = !!s.confirmBeforeOrder;
  $('ordLeverage').value = s.defaultLeverage;
  $('ordMargin').value = s.marginMode;
  $('calcRisk').value = s.riskPercent;

  syncExchangeForm();
  syncAiForm();
  toggleFuturesFields();
  renderSignalEmpty();
}

function syncExchangeForm() {
  const s = state.settings;
  const id = $('exchangeSelect').value || s.exchangeId;
  const info = state.exchanges.find((e) => e.id === id) || {};
  const keys = s.exchangeKeys?.[id] || {};

  $('exPassWrap').classList.toggle('hidden', !info.needsPassword);
  $('setExKey').placeholder = keys.apiKeySet ? keys.hint : '—';
  $('setExSecret').placeholder = keys.secretSet ? '••••••••' : '—';
  $('setExPass').placeholder = keys.passwordSet ? '••••••••' : '—';
  $('exchangeDocsLink').href = info.docs || '#';
  $('exchangeDocsLink').classList.toggle('hidden', !info.docs);

  const noSandbox = info.sandbox === false;
  $('setDemo').disabled = noSandbox;
  $('demoNote').textContent = noSandbox ? t('settings.noDemo') : t('settings.demoNote');
}

function syncAiForm() {
  const s = state.settings;
  const id = $('aiProviderSelect').value || s.aiProvider;
  const info = state.providers.find((p) => p.id === id) || { models: [] };
  const key = s.aiKeys?.[id] || {};

  $('setAiKey').placeholder = key.set ? key.hint : '—';
  $('setAiModel').value = s.aiModels?.[id] || info.models[0] || '';
  $('aiModelList').innerHTML = (info.models || []).map((m) => `<option value="${m}">`).join('');
  $('aiDocsLink').href = info.keyUrl || '#';
  $('aiEffortWrap').classList.toggle('hidden', !info.supportsEffort);
}

async function loadSymbols() {
  try {
    const symbols = await call(window.api.market.symbols(state.marketType));
    $('symbolList').innerHTML = symbols
      .slice(0, 600)
      .map((s) => `<option value="${s}">`)
      .join('');
  } catch (e) {
    /* بێ کلیلیش دەکرێت بازاڕ ببینرێت؛ ئەگەر نەکرا بێدەنگ تێدەپەڕین */
  }
}

/* ══════════ نوێکردنەوە ══════════ */

async function refreshAll() {
  $('chartTitle').textContent = state.symbol;
  await Promise.all([
    refreshChart(),
    refreshIndicators(),
    refreshWatchlist(),
    refreshBalance(),
    refreshPositionOverlay(),
  ]);
}

async function refreshLight() {
  await Promise.all([
    refreshTicker(),
    refreshWatchlist(),
    refreshPositionOverlay(),
    refreshCandlesLive(),
  ]);
}

async function refreshTicker() {
  try {
    const tk = await call(window.api.market.ticker(state.symbol, state.marketType));
    const up = (tk.change ?? 0) >= 0;
    $('priceBadge').textContent = fmtPrice(tk.last);
    $('priceBadge').className = `price ${up ? 'up' : 'down'}`;
    $('changeBadge').textContent = `${up ? '+' : ''}${fmt(tk.change, 2)}%`;
    $('changeBadge').className = `change ${up ? 'up' : 'down'}`;
    $('stat24h').textContent = fmtPrice(tk.high);
    $('stat24l').textContent = fmtPrice(tk.low);
    $('statVol').textContent = fmtCompact(tk.volume);
  } catch (e) {
    $('priceBadge').textContent = '—';
  }
}

async function refreshChart() {
  try {
    const candles = await call(
      window.api.market.candles(state.symbol, state.timeframe, 500, state.marketType)
    );
    state.candles = candles;
    state.chart.setCandles(candles);

    const items = await call(
      window.api.drawings.list({ symbol: state.symbol, marketType: state.marketType })
    );
    state.chart.setDrawings(items);
    state.chart.setSignal(
      state.lastSignal && state.lastSignal.symbol === state.symbol ? state.lastSignal : null
    );
    await refreshTicker();
  } catch (e) {
    $('ohlcReadout').textContent = `${t('common.error')}: ${e.message}`;
  }
}

async function refreshCandlesLive() {
  try {
    const candles = await call(
      window.api.market.candles(state.symbol, state.timeframe, 500, state.marketType)
    );
    state.candles = candles;
    state.chart.setCandles(candles, true);
  } catch (e) {
    /* هەڵەی تۆڕ — خولی داهاتوو هەوڵ دەداتەوە */
  }
}

async function refreshIndicators() {
  const box = $('indicatorsGrid');
  box.className = 'indicators muted';
  box.textContent = t('common.loading');
  try {
    const i = await call(
      window.api.market.indicators(state.symbol, state.timeframe, state.marketType)
    );
    const rsiCls = i.rsi14 > 70 ? 'neg' : i.rsi14 < 30 ? 'pos' : '';
    const macdCls = i.macdHistogram > 0 ? 'pos' : 'neg';

    const cells = [
      [t('ind.trend'), i.trend, ''],
      [t('ind.rsi'), fmt(i.rsi14, 1), rsiCls],
      [t('ind.adx'), fmt(i.adx, 1), ''],
      [t('ind.macd'), fmt(i.macdHistogram, 4), macdCls],
      [t('ind.ema20'), fmtPrice(i.ema20), ''],
      [t('ind.ema50'), fmtPrice(i.ema50), ''],
      [t('ind.ema200'), fmtPrice(i.ema200), ''],
      [t('ind.atr'), `${fmt(i.atrPercent, 2)}%`, ''],
      [t('ind.stoch'), fmt(i.stochK, 1), ''],
      [t('ind.bbUpper'), fmtPrice(i.bbUpper), ''],
      [t('ind.bbLower'), fmtPrice(i.bbLower), ''],
      [t('ind.volume'), `${fmt(i.volumeVsAvg, 2)}×`, ''],
      [t('ind.support'), (i.supportLevels || []).map(fmtPrice).join(' · ') || '—', 'pos'],
      [t('ind.resistance'), (i.resistanceLevels || []).map(fmtPrice).join(' · ') || '—', 'neg'],
    ];

    box.className = 'indicators';
    box.innerHTML = cells
      .map(
        ([k, v, cls]) =>
          `<div class="ind-cell"><div class="ind-label">${esc(k)}</div>` +
          `<div class="ind-value ${cls}">${esc(v)}</div></div>`
      )
      .join('');
  } catch (e) {
    box.className = 'indicators muted';
    box.textContent = `${t('common.error')}: ${e.message}`;
  }
}

async function refreshWatchlist() {
  const box = $('watchlist');
  if (!state.watchlist.length) {
    box.innerHTML = `<div class="muted small">${t('watchlist.empty')}</div>`;
    return;
  }
  try {
    const tickers = await call(window.api.market.tickers(state.watchlist, state.marketType));
    box.innerHTML = tickers
      .map((tk) => {
        if (tk.error) {
          return `<div class="watch-row" data-sym="${esc(tk.symbol)}">
            <span class="watch-sym">${esc(tk.symbol)}</span><span class="muted small">—</span></div>`;
        }
        const up = (tk.change ?? 0) >= 0;
        return `<div class="watch-row ${tk.symbol === state.symbol ? 'active' : ''}" data-sym="${esc(
          tk.symbol
        )}">
          <span class="watch-sym">${esc(tk.symbol)}</span>
          <span class="watch-right">
            <span class="watch-price">${fmtPrice(tk.last)}</span>
            <span class="watch-chg ${up ? 'pos' : 'neg'}">${up ? '+' : ''}${fmt(tk.change, 2)}%</span>
          </span></div>`;
      })
      .join('');

    box.querySelectorAll('.watch-row').forEach((row) =>
      row.addEventListener('click', async () => {
        state.symbol = row.dataset.sym;
        $('symbolInput').value = state.symbol;
        await refreshAll();
      })
    );
  } catch (e) {
    box.innerHTML = `<div class="muted small">${esc(e.message)}</div>`;
  }
}

async function refreshBalance() {
  const box = $('balanceBox');
  try {
    const b = await call(window.api.account.balance(state.marketType));
    box.className = 'balance-box';
    box.innerHTML =
      `<div class="bal-total">${fmt(b.totalUSDT, 2)} <small>USDT</small></div>` +
      `<div class="bal-list">${b.rows
        .slice(0, 7)
        .map((r) => `<div class="bal-row"><span>${esc(r.coin)}</span><span>${fmt(r.total, 6)}</span></div>`)
        .join('')}</div>`;
    $('calcBalance').value = Number(b.totalUSDT).toFixed(2);
  } catch (e) {
    box.className = 'balance-box muted';
    box.textContent = t('balance.needKey');
  }
}

/* ══════════ پۆزیشنەکان ══════════ */

async function refreshPositionOverlay() {
  let positions = [];
  let algo = [];
  let orders = [];

  if (state.marketType === 'swap') {
    try {
      positions = await call(window.api.account.positions());
    } catch (e) {
      /* بێ کلیل یان بۆرسەی بێ فیوچەر */
    }
    try {
      algo = await call(window.api.trade.algoOrders(state.symbol));
    } catch (e) {
      /* هەندێک بۆرسە algo پشتگیری ناکات */
    }
  }
  try {
    orders = await call(window.api.account.openOrders(state.symbol, state.marketType));
  } catch (e) {
    /* بێ کلیل */
  }

  state.positions = positions;
  state.algoOrders = algo;

  const mine = positions.filter((p) => p.symbol === state.symbol);
  state.chart.setPositions(mine);
  state.chart.setAlgo(mine.length ? algo : []);
  state.chart.setOrders(orders);

  renderPositionsTable(positions);
}

function renderPositionsTable(positions) {
  const box = $('dashPositions');
  if (!positions.length) {
    box.className = 'muted';
    box.textContent =
      state.marketType === 'swap' ? t('positions.empty') : t('positions.spotNote');
    return;
  }

  box.className = 'table-wrap';
  box.innerHTML = `<table>
    <thead><tr>
      <th>${t('positions.symbol')}</th>
      <th>${t('positions.side')}</th>
      <th>${t('positions.size')}</th>
      <th>${t('positions.entry')}</th>
      <th>${t('positions.mark')}</th>
      <th>${t('ai.leverage')}</th>
      <th>${t('positions.liq')}</th>
      <th>${t('positions.pnl')}</th>
      <th>${t('positions.actions')}</th>
    </tr></thead>
    <tbody>${positions
      .map((p) => {
        const cls = p.unrealizedPnl >= 0 ? 'pos' : 'neg';
        const roe = p.percentage != null ? `${p.percentage >= 0 ? '+' : ''}${fmt(p.percentage, 2)}%` : '';
        return `<tr>
          <td><b>${esc(p.symbol)}</b></td>
          <td><span class="side-pill ${p.side}">${
            p.side === 'long' ? t('positions.long') : t('positions.short')
          }</span></td>
          <td>${fmt(p.contracts, 4)}</td>
          <td>${fmtPrice(p.entryPrice)}</td>
          <td>${fmtPrice(p.markPrice)}</td>
          <td>${p.leverage || 1}×</td>
          <td class="neg">${fmtPrice(p.liquidationPrice)}</td>
          <td class="${cls}"><b>${fmt(p.unrealizedPnl, 2)}</b> <span class="small">${roe}</span></td>
          <td><div class="cell-actions">
            <button class="btn tiny edit-pos" data-sym="${esc(p.symbol)}">${t('positions.edit')}</button>
            <button class="btn tiny goto-pos" data-sym="${esc(p.symbol)}">${t('positions.show')}</button>
            <button class="btn tiny danger quick-close" data-sym="${esc(p.symbol)}">${t(
          'positions.close'
        )}</button>
          </div></td>
        </tr>`;
      })
      .join('')}</tbody></table>`;

  box.querySelectorAll('.edit-pos').forEach((b) =>
    b.addEventListener('click', () => openPositionModal(b.dataset.sym))
  );
  box.querySelectorAll('.goto-pos').forEach((b) =>
    b.addEventListener('click', async () => {
      state.symbol = b.dataset.sym;
      $('symbolInput').value = state.symbol;
      await refreshAll();
    })
  );
  box.querySelectorAll('.quick-close').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await call(window.api.trade.closePosition({ symbol: b.dataset.sym, percent: 100 }));
        toast(t('common.success'), b.dataset.sym);
        await refreshPositionOverlay();
        await refreshBalance();
      } catch (e) {
        toast(t('common.error'), e.message);
        b.disabled = false;
      }
    })
  );
}

/* ══════════ دیالۆگی پۆزیشن ══════════ */

function bindPositionModal() {
  const modal = $('posModal');
  const close = () => modal.classList.add('hidden');

  $('posModalClose').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  $('posModalApply').addEventListener('click', async () => {
    const out = $('posModalResult');
    const sl = $('posModalSL').value ? Number($('posModalSL').value) : undefined;
    const tp = $('posModalTP').value ? Number($('posModalTP').value) : undefined;
    if (!sl && !tp) {
      out.className = 'result err';
      out.textContent = 'SL / TP';
      return;
    }
    out.className = 'result';
    out.innerHTML = `<span class="spinner"></span>${t('common.loading')}`;
    try {
      await call(
        window.api.trade.setSLTP({ symbol: state.modalSymbol, stopLoss: sl, takeProfit: tp })
      );
      out.className = 'result ok';
      out.textContent = `✓ ${t('common.success')}`;
      await refreshPositionOverlay();
    } catch (e) {
      out.className = 'result err';
      out.textContent = `${t('common.error')}: ${e.message}`;
    }
  });

  modal.querySelectorAll('.close-pct').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const out = $('posModalResult');
      out.className = 'result';
      out.innerHTML = `<span class="spinner"></span>${t('common.loading')}`;
      try {
        await call(
          window.api.trade.closePosition({
            symbol: state.modalSymbol,
            percent: Number(btn.dataset.pct),
          })
        );
        out.className = 'result ok';
        out.textContent = `✓ ${btn.dataset.pct}%`;
        await refreshPositionOverlay();
        await refreshBalance();
        if (btn.dataset.pct === '100') setTimeout(close, 900);
      } catch (e) {
        out.className = 'result err';
        out.textContent = `${t('common.error')}: ${e.message}`;
      }
    })
  );
}

async function openPositionModal(symbol) {
  state.modalSymbol = symbol;
  const p = state.positions.find((x) => x.symbol === symbol);
  if (!p) return;

  $('posModalTitle').textContent = `${symbol} · ${
    p.side === 'long' ? t('positions.long') : t('positions.short')
  }`;
  $('posModalResult').textContent = '';
  $('posModalInfo').innerHTML = `
    ${t('positions.entry')}: <b>${fmtPrice(p.entryPrice)}</b> · ${t('positions.mark')}: <b>${fmtPrice(
    p.markPrice
  )}</b><br />
    ${t('positions.size')}: <b>${fmt(p.contracts, 4)}</b> · ${t('ai.leverage')}: <b>${p.leverage || 1}×</b><br />
    ${t('positions.pnl')}: <b class="${p.unrealizedPnl >= 0 ? 'pos' : 'neg'}">${fmt(
    p.unrealizedPnl,
    2
  )} USDT</b><br />
    ${t('positions.liq')}: <b class="neg">${fmtPrice(p.liquidationPrice)}</b>`;

  $('posModalSL').value = '';
  $('posModalTP').value = '';
  try {
    const algo = await call(window.api.trade.algoOrders(symbol));
    const sl = algo.find((a) => a.kind === 'stopLoss');
    const tp = algo.find((a) => a.kind === 'takeProfit');
    if (sl) $('posModalSL').value = sl.triggerPrice;
    if (tp) $('posModalTP').value = tp.triggerPrice;
  } catch (e) {
    /* بەتاڵ دەمێنێتەوە */
  }

  $('posModal').classList.remove('hidden');
}

/* ══════════ شیکاری AI ══════════ */

function renderSignalEmpty() {
  $('signalBox').innerHTML = `<div class="ai-empty">${t('ai.empty')}</div>`;
  $('execBtn').classList.add('hidden');
  $('fillManualBtn').classList.add('hidden');
}

async function runAnalysis() {
  const btn = $('analyzeBtn');
  btn.disabled = true;
  $('aiStatus').innerHTML = `<span class="spinner"></span>${t('ai.working')}`;
  $('signalBox').innerHTML = '';
  $('execBtn').classList.add('hidden');
  $('fillManualBtn').classList.add('hidden');

  try {
    const res = await call(
      window.api.ai.analyze({
        symbol: state.symbol,
        marketType: state.marketType,
        timeframes: ['15m', '1h', '4h', '1d'],
        userNote: $('aiNote').value.trim(),
      })
    );
    state.lastSignal = res.signal;
    state.lastResult = res;
    $('aiStatus').textContent = `${res.signal.model || ''} · ${new Date().toLocaleTimeString('en-GB')}`;
    renderSignal(res);
    state.chart.setSignal(res.signal);
  } catch (e) {
    $('aiStatus').textContent = '';
    $('signalBox').innerHTML = `<div class="ai-empty" style="color:var(--red)">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

function renderSignal(res) {
  const s = res.signal;
  const p = res.position;

  const actionText = {
    long: 'LONG',
    short: 'SHORT',
    buy: 'BUY',
    wait: 'WAIT',
    avoid: 'AVOID',
  }[s.recommendation];

  const horizon = {
    scalp: 'Scalp',
    short_term: 'Short term',
    swing: 'Swing',
    long_term: 'Long term',
  }[s.timeHorizon] || s.timeHorizon;

  const metric = (label, value, cls = '', sub = '') =>
    `<div class="signal-metric">
      <div class="metric-label">${esc(label)}</div>
      <div class="metric-value ${cls}">${esc(value)}</div>
      ${sub ? `<div class="metric-sub">${esc(sub)}</div>` : ''}
    </div>`;

  const tps = (s.takeProfits || [])
    .map((tp, i) =>
      metric(`${t('ai.takeProfit')} ${i + 1}`, fmtPrice(tp.price), 'pos', `${tp.allocationPercent}%`)
    )
    .join('');

  const canExecute = !['wait', 'avoid'].includes(s.recommendation);
  const issues = res.validation && !res.validation.ok ? res.validation.issues : [];
  const warnings = [...(s.warnings || []), ...issues];

  $('signalBox').innerHTML = `
    <div class="signal-verdict ${s.recommendation}">
      <div class="verdict-action ${s.recommendation}">${actionText}</div>
      <div class="verdict-meta">${esc(horizon)} · ${esc(s.symbol)}</div>
      <div class="verdict-meta">${t('ai.confidence')} ${s.confidence}%</div>
      <div class="conf-bar"><div class="conf-fill" style="width:${s.confidence}%"></div></div>
    </div>

    ${metric(t('ai.entry'), fmtPrice(s.entryPrice), '', s.entryType === 'market' ? 'Market' : 'Limit')}
    ${metric(t('ai.stopLoss'), fmtPrice(s.stopLoss), 'neg')}
    ${tps}
    ${metric(t('ai.leverage'), `${s.leverage}×`)}
    ${metric(t('ai.rr'), fmt(res.computedRR ?? s.riskRewardRatio, 2), 'pos')}
    ${
      p && !p.error
        ? metric(t('ai.size'), `${fmt(p.marginUSDT)} USDT`, '', `${fmt(p.notionalUSDT)} notional`) +
          metric(t('ai.riskAmount'), `${fmt(p.riskAmountUSDT)} USDT`, 'neg', `${p.riskPercent}%`)
        : ''
    }

    <div class="signal-text">
      <div class="text-block">
        <div class="tb-label">${t('ai.trend')}</div>${esc(s.trendSummary)}
      </div>
      <div class="text-block">
        <div class="tb-label">${t('ai.reasoning')}</div>${esc(s.reasoning)}
      </div>
      <div class="text-block">
        <div class="tb-label">${t('ai.invalidation')}</div>${esc(s.invalidation)}
      </div>
      ${
        warnings.length
          ? `<div class="text-block warn"><div class="tb-label">${t('ai.warnings')}</div>
             <ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
          : ''
      }
    </div>`;

  $('execBtn').classList.toggle('hidden', !canExecute);
  $('fillManualBtn').classList.toggle('hidden', !canExecute);
  $('execBtn').disabled = false;
  $('execBtn').textContent = t('ai.execute');

  $('execBtn').onclick = () => executeSignal(res);
  $('fillManualBtn').onclick = () => {
    fillManualForm(res);
    document.querySelector('.tab[data-tab="trade"]').click();
  };
}

async function executeSignal(res) {
  const s = res.signal;
  const btn = $('execBtn');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${t('common.loading')}`;

  try {
    const quoteAmount = res.position && !res.position.error ? res.position.marginUSDT : null;
    if (!quoteAmount) throw new Error(t('balance.needKey'));

    const result = await call(
      window.api.trade.place({
        symbol: s.symbol,
        marketType: s.marketType,
        side: s.recommendation === 'short' ? 'sell' : 'buy',
        type: s.entryType,
        price: s.entryType === 'limit' ? s.entryPrice : undefined,
        quoteAmount,
        leverage: s.marketType === 'swap' ? s.leverage : undefined,
        marginMode: state.settings?.marginMode || 'isolated',
        stopLoss: s.stopLoss,
        takeProfit: s.takeProfits?.[0]?.price,
      })
    );
    toast(t('common.success'), `ID: ${result.id}`);
    btn.textContent = '✓';
    await refreshBalance();
    await refreshPositionOverlay();
  } catch (e) {
    toast(t('common.error'), e.message);
    btn.disabled = false;
    btn.textContent = t('ai.execute');
  }
}

function fillManualForm(res) {
  const s = res.signal;
  $('ordType').value = s.entryType;
  $('ordSide').value = s.recommendation === 'short' ? 'sell' : 'buy';
  $('ordPrice').value = s.entryPrice;
  $('ordPriceWrap').classList.toggle('hidden', s.entryType !== 'limit');
  $('ordQuote').value = res.position && !res.position.error ? res.position.marginUSDT : '';
  $('ordLeverage').value = s.leverage;
  $('ordSL').value = s.stopLoss;
  $('ordTP').value = s.takeProfits?.[0]?.price ?? '';
}

/* ══════════ مامەڵەی دەستی ══════════ */

function bindTrade() {
  $('ordType').addEventListener('change', () =>
    $('ordPriceWrap').classList.toggle('hidden', $('ordType').value !== 'limit')
  );

  $('manualForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('manualResult');
    out.className = 'result';
    out.innerHTML = `<span class="spinner"></span>${t('common.loading')}`;
    try {
      const r = await call(
        window.api.trade.place({
          symbol: state.symbol,
          marketType: state.marketType,
          side: $('ordSide').value,
          type: $('ordType').value,
          price: $('ordType').value === 'limit' ? Number($('ordPrice').value) : undefined,
          quoteAmount: Number($('ordQuote').value),
          leverage: state.marketType === 'swap' ? Number($('ordLeverage').value) : undefined,
          marginMode: $('ordMargin').value,
          stopLoss: $('ordSL').value ? Number($('ordSL').value) : undefined,
          takeProfit: $('ordTP').value ? Number($('ordTP').value) : undefined,
        })
      );
      out.className = 'result ok';
      out.textContent = `✓ ${r.id} · ${r.side} ${fmt(r.amount, 6)} @ ${fmtPrice(r.price)}`;
      await refreshBalance();
      await refreshPositionOverlay();
    } catch (err) {
      out.className = 'result err';
      out.textContent = `${t('common.error')}: ${err.message}`;
    }
  });

  $('calcForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('calcResult');
    try {
      const r = await call(
        window.api.trade.calculate({
          balanceUSDT: Number($('calcBalance').value),
          entryPrice: Number($('calcEntry').value),
          stopLoss: Number($('calcStop').value),
          leverage: Number($('calcLev').value),
          riskPercent: Number($('calcRisk').value),
        })
      );
      if (r.error) throw new Error(r.error);
      out.className = 'result ok';
      out.innerHTML = `
        ${t('trade.riskAmount')}: <b>${fmt(r.riskAmountUSDT)} USDT</b> (${r.riskPercent}%)<br />
        ${t('trade.stopDist')}: <b>${r.stopDistancePercent}%</b><br />
        ${t('trade.margin')}: <b>${fmt(r.marginUSDT)} USDT</b><br />
        ${t('trade.notional')}: <b>${fmt(r.notionalUSDT)} USDT</b>
        ${r.liquidationEstimate ? `<br />${t('trade.liqEst')}: <b>${fmtPrice(r.liquidationEstimate)}</b>` : ''}`;
    } catch (err) {
      out.className = 'result err';
      out.textContent = `${t('common.error')}: ${err.message}`;
    }
  });
}

/* ══════════ پۆزیشن و فەرمان (تابی جیا) ══════════ */

function bindOrders() {
  $('reloadPositions').addEventListener('click', loadPositionsAndOrders);
  $('reloadOrders').addEventListener('click', loadPositionsAndOrders);
}

async function loadPositionsAndOrders() {
  const pBox = $('positionsBox');
  pBox.className = 'muted';
  pBox.textContent = t('common.loading');
  try {
    const positions = await call(window.api.account.positions());
    state.positions = positions;
    if (!positions.length) {
      pBox.textContent = t('positions.empty');
    } else {
      pBox.className = 'table-wrap';
      pBox.innerHTML = `<table>
        <thead><tr>
          <th>${t('positions.symbol')}</th><th>${t('positions.side')}</th><th>${t('positions.size')}</th>
          <th>${t('positions.entry')}</th><th>${t('positions.mark')}</th><th>${t('ai.leverage')}</th>
          <th>${t('positions.pnl')}</th><th>${t('positions.liq')}</th><th></th>
        </tr></thead>
        <tbody>${positions
          .map(
            (p) => `<tr>
              <td><b>${esc(p.symbol)}</b></td>
              <td><span class="side-pill ${p.side}">${
                p.side === 'long' ? t('positions.long') : t('positions.short')
              }</span></td>
              <td>${fmt(p.contracts, 4)}</td>
              <td>${fmtPrice(p.entryPrice)}</td>
              <td>${fmtPrice(p.markPrice)}</td>
              <td>${p.leverage || 1}×</td>
              <td class="${p.unrealizedPnl >= 0 ? 'pos' : 'neg'}">${fmt(p.unrealizedPnl, 2)}</td>
              <td class="neg">${fmtPrice(p.liquidationPrice)}</td>
              <td><button class="btn tiny danger close-pos" data-sym="${esc(p.symbol)}">${t(
              'positions.close'
            )}</button></td>
            </tr>`
          )
          .join('')}</tbody></table>`;

      pBox.querySelectorAll('.close-pos').forEach((b) =>
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            await call(window.api.trade.closePosition({ symbol: b.dataset.sym, percent: 100 }));
            toast(t('common.success'), b.dataset.sym);
            await loadPositionsAndOrders();
          } catch (e) {
            toast(t('common.error'), e.message);
            b.disabled = false;
          }
        })
      );
    }
  } catch (e) {
    pBox.textContent = `${t('common.error')}: ${e.message}`;
  }

  const oBox = $('ordersBox');
  oBox.className = 'muted';
  oBox.textContent = t('common.loading');
  try {
    const orders = await call(window.api.account.openOrders(state.symbol, state.marketType));
    if (!orders.length) {
      oBox.textContent = t('orders.empty');
    } else {
      oBox.className = 'table-wrap';
      oBox.innerHTML = `<table>
        <thead><tr>
          <th>${t('positions.symbol')}</th><th>${t('orders.type')}</th><th>${t('positions.side')}</th>
          <th>${t('orders.price')}</th><th>${t('orders.amount')}</th><th>${t('orders.filled')}</th><th></th>
        </tr></thead>
        <tbody>${orders
          .map(
            (o) => `<tr>
              <td>${esc(o.symbol)}</td>
              <td>${esc(o.type)}</td>
              <td class="${o.side === 'buy' ? 'pos' : 'neg'}">${esc(o.side)}</td>
              <td>${fmtPrice(o.price)}</td>
              <td>${fmt(o.amount, 6)}</td>
              <td>${fmt(o.filled, 6)}</td>
              <td><button class="btn tiny danger cancel-ord" data-id="${esc(o.id)}" data-sym="${esc(
              o.symbol
            )}">${t('orders.cancel')}</button></td>
            </tr>`
          )
          .join('')}</tbody></table>`;

      oBox.querySelectorAll('.cancel-ord').forEach((b) =>
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            await call(window.api.account.cancelOrder(b.dataset.id, b.dataset.sym, state.marketType));
            toast(t('common.success'), b.dataset.id);
            await loadPositionsAndOrders();
          } catch (e) {
            toast(t('common.error'), e.message);
            b.disabled = false;
          }
        })
      );
    }
  } catch (e) {
    oBox.textContent = `${t('common.error')}: ${e.message}`;
  }
}

/* ══════════ چات ══════════ */

function bindChat() {
  $('chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('chatInput');
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    appendChat('user', q);
    const placeholder = appendChat('ai', '…');

    try {
      const r = await call(
        window.api.ai.ask({
          question: q,
          symbol: state.symbol,
          marketType: state.marketType,
          includeContext: $('chatContext').checked,
        })
      );
      placeholder.querySelector('.bubble').textContent = r.answer;
    } catch (err) {
      placeholder.querySelector('.bubble').textContent = `${t('common.error')}: ${err.message}`;
    }
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
  });
}

function appendChat(who, text) {
  const div = document.createElement('div');
  div.className = `msg ${who}`;
  div.innerHTML = `<div class="who">${who === 'user' ? t('chat.you') : 'AI'}</div><div class="bubble"></div>`;
  div.querySelector('.bubble').textContent = text;
  $('chatLog').appendChild(div);
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
  return div;
}

/* ══════════ ئاگاداری ══════════ */

function bindAlerts() {
  $('alertForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call(
        window.api.alerts.add({
          symbol: $('alertSymbol').value.trim().toUpperCase() || state.symbol,
          marketType: state.marketType,
          condition: $('alertCondition').value,
          price: Number($('alertPrice').value),
        })
      );
      $('alertPrice').value = '';
      await loadAlerts();
    } catch (err) {
      toast(t('common.error'), err.message);
    }
  });
}

async function loadAlerts() {
  const box = $('alertsBox');
  try {
    const alerts = await call(window.api.alerts.list());
    if (!alerts.length) {
      box.className = 'muted';
      box.textContent = t('alerts.empty');
      return;
    }
    box.className = 'table-wrap';
    box.innerHTML = `<table>
      <thead><tr><th>${t('positions.symbol')}</th><th></th><th>${t('alerts.price')}</th>
      <th>${t('alerts.status')}</th><th></th></tr></thead>
      <tbody>${alerts
        .map(
          (a) => `<tr>
            <td>${esc(a.symbol)}</td>
            <td>${a.condition === 'above' ? t('alerts.above') : t('alerts.below')}</td>
            <td>${fmtPrice(a.price)}</td>
            <td>${a.triggered ? `<span class="pos">${t('alerts.triggered')}</span>` : t('alerts.waiting')}</td>
            <td><button class="btn tiny danger del-alert" data-id="${esc(a.id)}">${t(
            'alerts.delete'
          )}</button></td>
          </tr>`
        )
        .join('')}</tbody></table>`;

    box.querySelectorAll('.del-alert').forEach((b) =>
      b.addEventListener('click', async () => {
        await call(window.api.alerts.remove(b.dataset.id));
        await loadAlerts();
      })
    );
  } catch (e) {
    box.className = 'muted';
    box.textContent = `${t('common.error')}: ${e.message}`;
  }
}

/* ══════════ تۆمار ══════════ */

function bindJournal() {
  $('reloadJournal').addEventListener('click', loadJournal);
  $('clearJournal').addEventListener('click', async () => {
    await call(window.api.journal.clear());
    await loadJournal();
  });
}

async function loadJournal() {
  try {
    const [rows, st] = await Promise.all([
      call(window.api.journal.list(200)),
      call(window.api.journal.stats()),
    ]);

    $('journalStats').innerHTML =
      `<span>${t('journal.total')}: <b>${st.totalEntries}</b></span>` +
      `<span>${t('journal.orders')}: <b>${st.ordersExecuted}</b></span>` +
      `<span>${t('journal.signals')}: <b>${st.signalsGenerated}</b></span>`;

    const box = $('journalBox');
    if (!rows.length) {
      box.className = 'muted';
      box.textContent = t('journal.empty');
      return;
    }
    box.className = 'table-wrap';
    box.innerHTML = `<table>
      <thead><tr><th>${t('journal.time')}</th><th>${t('journal.kind')}</th>
      <th>${t('positions.symbol')}</th><th>${t('journal.detail')}</th></tr></thead>
      <tbody>${rows
        .map((r) => {
          let detail = '';
          if (r.kind === 'signal') {
            detail = `${r.signal?.recommendation ?? '—'} · ${r.signal?.confidence ?? '—'}% · SL ${fmtPrice(
              r.signal?.stopLoss
            )}`;
          } else if (r.kind === 'order') {
            detail = `${r.result?.side ?? ''} ${fmt(r.result?.amount, 6)} @ ${fmtPrice(r.result?.price)}`;
          } else if (r.kind === 'close') {
            detail = `${r.percent}%`;
          } else if (r.kind === 'sltp') {
            detail = `SL ${fmtPrice(r.request?.stopLoss)} · TP ${fmtPrice(r.request?.takeProfit)}`;
          }
          return `<tr>
            <td>${new Date(r.createdAt).toLocaleString('en-GB')}</td>
            <td>${esc(r.kind)}</td>
            <td>${esc(r.symbol || '—')}</td>
            <td>${esc(detail)}</td>
          </tr>`;
        })
        .join('')}</tbody></table>`;
  } catch (e) {
    $('journalBox').textContent = `${t('common.error')}: ${e.message}`;
  }
}

/* ══════════ ڕێکخستن ══════════ */

function bindSettings() {
  $('exchangeSelect').addEventListener('change', syncExchangeForm);
  $('aiProviderSelect').addEventListener('change', syncAiForm);

  for (const [linkId, getUrl] of [
    ['exchangeDocsLink', () => $('exchangeDocsLink').href],
    ['aiDocsLink', () => $('aiDocsLink').href],
  ]) {
    $(linkId).addEventListener('click', (e) => {
      e.preventDefault();
      const url = getUrl();
      if (url && url !== '#') window.api.app.openExternal(url);
    });
  }

  $('exchangeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('exResult');
    const id = $('exchangeSelect').value;
    try {
      await call(
        window.api.settings.saveExchangeKeys({
          exchangeId: id,
          apiKey: $('setExKey').value,
          secret: $('setExSecret').value,
          password: $('setExPass').value,
        })
      );
      await call(window.api.settings.save({ exchangeId: id, demoMode: $('setDemo').checked }));
      $('setExKey').value = '';
      $('setExSecret').value = '';
      $('setExPass').value = '';
      out.className = 'result ok';
      out.textContent = `✓ ${t('settings.saved')}`;
      await loadSettings();
      await loadSymbols();
      await refreshAll();
    } catch (err) {
      out.className = 'result err';
      out.textContent = `${t('common.error')}: ${err.message}`;
    }
  });

  $('testExBtn').addEventListener('click', async () => {
    const out = $('exResult');
    out.className = 'result';
    out.innerHTML = `<span class="spinner"></span>${t('common.loading')}`;
    try {
      const r = await call(window.api.settings.testExchange());
      out.className = 'result ok';
      out.textContent = `✓ ${r.exchange} · ${r.markets} markets · ${
        r.authenticated ? `${fmt(r.totalUSDT)} USDT` : 'public only'
      } · ${r.demo ? 'DEMO' : 'LIVE'}`;
    } catch (err) {
      out.className = 'result err';
      out.textContent = `${t('common.error')}: ${err.message}`;
    }
  });

  $('aiForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('aiResult');
    const provider = $('aiProviderSelect').value;
    try {
      if ($('setAiKey').value) {
        await call(window.api.settings.saveAiKey({ provider, key: $('setAiKey').value }));
      }
      await call(
        window.api.settings.save({
          aiProvider: provider,
          aiModels: { [provider]: $('setAiModel').value.trim() },
          aiEffort: $('setAiEffort').value,
        })
      );
      $('setAiKey').value = '';
      out.className = 'result ok';
      out.textContent = `✓ ${t('settings.saved')}`;
      await loadSettings();
    } catch (err) {
      out.className = 'result err';
      out.textContent = `${t('common.error')}: ${err.message}`;
    }
  });

  $('testAiBtn').addEventListener('click', async () => {
    const out = $('aiResult');
    out.className = 'result';
    out.innerHTML = `<span class="spinner"></span>${t('common.loading')}`;
    try {
      const r = await call(window.api.settings.testAI());
      out.className = 'result ok';
      out.textContent = `✓ ${r.model} — ${r.reply}`;
    } catch (err) {
      out.className = 'result err';
      out.textContent = `${t('common.error')}: ${err.message}`;
    }
  });

  $('riskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('riskResult');
    try {
      await call(
        window.api.settings.save({
          riskPercent: Number($('setRisk').value),
          maxLeverage: Number($('setMaxLev').value),
          defaultLeverage: Number($('setDefLev').value),
          maxOpenPositions: Number($('setMaxPos').value),
          dailyLossLimitPercent: Number($('setDailyLoss').value),
          confirmBeforeOrder: $('setConfirm').checked,
        })
      );
      out.className = 'result ok';
      out.textContent = `✓ ${t('settings.saved')}`;
      await loadSettings();
    } catch (err) {
      out.className = 'result err';
      out.textContent = `${t('common.error')}: ${err.message}`;
    }
  });

  $('generalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await applyLanguage($('setLanguage').value, true);
    const out = $('generalResult');
    out.className = 'result ok';
    out.textContent = `✓ ${t('settings.saved')}`;
  });
}
