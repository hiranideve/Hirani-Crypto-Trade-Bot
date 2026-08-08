'use strict';

/**
 * TradeChart — چارتی کەندڵی کارلێکەر
 *
 * تایبەتمەندییەکان:
 *  · زووم (سکڕۆڵ) و پان (ڕاکێشان)، کرۆس‌هێر بە نرخ و کات
 *  · پانێڵی سەرەکی + پانێڵی قەبارە / RSI / MACD
 *  · ئۆڤەرلەی: EMA 20/50/200، بۆلینجەر، VWAP
 *  · ئامرازی هێڵکێشان: هێڵی ڕەوت، هێڵی ئاسۆیی، ڕەی، چوارگۆشە، فیبۆناچی
 *  · پۆزیشنی کراوە لەسەر چارت: چوونەژوورەوە، لیکویدەیشن، SL/TP بە دەستگیرەی ڕاکێشراو
 *
 * هەموو هێڵکاری و ئاستەکان بە (کات، نرخ) هەڵدەگیرێن نەک پیکسل،
 * بۆیە بە زووم و پان و گۆڕینی تایم‌فرەیم لە جێی خۆیان دەمێننەوە.
 */

(function () {
  const COLORS = {
    up: '#00c076',
    down: '#ff4d4f',
    upFill: 'rgba(0,192,118,0.5)',
    downFill: 'rgba(255,77,79,0.5)',
    grid: '#17191d',
    text: '#7d838c',
    ema20: '#4d9fff',
    ema50: '#f0a020',
    ema200: '#b47cff',
    bb: 'rgba(125,131,140,0.55)',
    vwap: '#22d3ee',
    entry: '#ffffff',
    liq: '#ff4d4f',
    sl: '#ff4d4f',
    tp: '#00c076',
    draw: '#f0a020',
    drawActive: '#ffffff',
    crosshair: '#5c626b',
    tagText: '#000000',
  };

  const AXIS_W = 74; // پانی ستوونی نرخ لای ڕاست
  const TIME_H = 22; // بەرزی ڕیزی کات لە خوارەوە

  class TradeChart {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');

      this.candles = [];
      this.positions = [];
      this.orders = []; // فەرمانە کراوەکان (limit)
      this.algo = []; // SL/TP ی هەبوو
      this.drawings = [];
      this.signal = null;

      this.overlays = { ema20: true, ema50: true, ema200: false, bb: false, vwap: false };
      this.panes = { volume: true, rsi: false, macd: false };

      this.tool = 'cursor';
      this.view = { start: 0, end: 0 }; // ئیندێکسی کەندڵەکان
      this.mouse = { x: null, y: null, inside: false };

      this.pending = null; // هێڵکاری لە ژێر دروستکردندا
      this.selected = null; // ئایدی هێڵکاری هەڵبژێردراو
      this.dragging = null; // {type, ...}

      this.onDrawingsChange = opts.onDrawingsChange || (() => {});
      this.onSLTPChange = opts.onSLTPChange || (() => {});
      this.onCrosshair = opts.onCrosshair || (() => {});

      this._bind();
      this._ro = new ResizeObserver(() => this.render());
      this._ro.observe(canvas.parentElement);
    }

    /* ================= داتا ================= */

    setCandles(candles, keepView = false) {
      const oldLen = this.candles.length;
      const oldEnd = this.view.end;
      const wasFollowing = oldLen > 0 && oldEnd >= oldLen - 1.5;
      this.candles = candles || [];
      const n = this.candles.length;

      if (!keepView || !oldLen) {
        // دیدی نوێ: کۆتا ١٢٠ کەندڵ
        this.view = { start: Math.max(0, n - 120), end: Math.max(1, n - 1) };
      } else if (wasFollowing) {
        // بەکارهێنەر لە لێواری ئێستادا بوو — هەمان ئاستی زووم دەپارێزین و دەشلەقێنین
        const span = oldEnd - this.view.start;
        this.view = { start: Math.max(0, n - 1 - span), end: n - 1 };
      }
      // ئەگەر بەکارهێنەر لە مێژووەکەدا بوو، دیدەکەی وەک خۆی دەمێنێتەوە

      this.view.end = Math.min(this.view.end, n - 1);
      this.view.start = Math.min(this.view.start, this.view.end - 5);
      this.render();
    }

    setPositions(list) {
      this.positions = list || [];
      this.render();
    }
    setOrders(list) {
      this.orders = list || [];
      this.render();
    }
    setAlgo(list) {
      this.algo = list || [];
      this.render();
    }
    setSignal(sig) {
      this.signal = sig || null;
      this.render();
    }
    setDrawings(list) {
      this.drawings = list || [];
      this.render();
    }
    setTool(tool) {
      this.tool = tool;
      this.pending = null;
      this.canvas.style.cursor = tool === 'cursor' ? 'crosshair' : 'copy';
      this.render();
    }
    toggleOverlay(name) {
      this.overlays[name] = !this.overlays[name];
      this.render();
      return this.overlays[name];
    }
    togglePane(name) {
      this.panes[name] = !this.panes[name];
      this.render();
      return this.panes[name];
    }

    deleteSelected() {
      if (!this.selected) return false;
      this.drawings = this.drawings.filter((d) => d.id !== this.selected);
      this.selected = null;
      this.onDrawingsChange(this.drawings);
      this.render();
      return true;
    }

    clearDrawings() {
      this.drawings = [];
      this.selected = null;
      this.onDrawingsChange(this.drawings);
      this.render();
    }

    resetView() {
      const n = this.candles.length;
      this.view = { start: Math.max(0, n - 120), end: Math.max(1, n - 1) };
      this.render();
    }

    /* ================= جوگرافیای پانێڵەکان ================= */

    _layout() {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const plotW = w - AXIS_W;

      const subs = [];
      if (this.panes.volume) subs.push({ key: 'volume', h: 62 });
      if (this.panes.rsi) subs.push({ key: 'rsi', h: 84 });
      if (this.panes.macd) subs.push({ key: 'macd', h: 84 });

      const subTotal = subs.reduce((a, s) => a + s.h + 6, 0);
      const mainH = Math.max(120, h - TIME_H - subTotal - 8);

      let y = 4;
      const main = { key: 'main', top: y, height: mainH };
      y += mainH + 6;
      for (const s of subs) {
        s.top = y;
        s.height = s.h;
        y += s.h + 6;
      }
      return { w, h, plotW, main, subs };
    }

    _visible() {
      // ئیندێکسەکان لەوانەیە نەریتی/نێگەتیڤ بن (پان بۆ دەرەوەی داتا) — دەیانبڕین
      const a = Math.max(0, Math.floor(this.view.start));
      const b = Math.min(this.candles.length - 1, Math.ceil(this.view.end));
      if (b < a) return [];
      return this.candles.slice(a, b + 1);
    }

    _xOfIndex(i, L) {
      const span = this.view.end - this.view.start || 1;
      return ((i - this.view.start) / span) * L.plotW;
    }

    _indexOfX(x, L) {
      const span = this.view.end - this.view.start || 1;
      return this.view.start + (x / L.plotW) * span;
    }

    // کات ↔ ئیندێکس (بۆ هێڵکاری کە بە کات هەڵگیراوە)
    _indexOfTime(t) {
      const c = this.candles;
      if (!c.length) return 0;
      if (t <= c[0].time) return 0;
      if (t >= c[c.length - 1].time) {
        const step = c.length > 1 ? c[c.length - 1].time - c[c.length - 2].time : 1;
        return c.length - 1 + (t - c[c.length - 1].time) / step;
      }
      let lo = 0;
      let hi = c.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (c[mid].time <= t) lo = mid;
        else hi = mid;
      }
      const span = c[hi].time - c[lo].time || 1;
      return lo + (t - c[lo].time) / span;
    }

    _timeOfIndex(idx) {
      const c = this.candles;
      if (!c.length) return Date.now();
      const step = c.length > 1 ? c[1].time - c[0].time : 60000;
      if (idx <= 0) return c[0].time + idx * step;
      if (idx >= c.length - 1) return c[c.length - 1].time + (idx - (c.length - 1)) * step;
      const lo = Math.floor(idx);
      const frac = idx - lo;
      return c[lo].time + frac * (c[lo + 1].time - c[lo].time);
    }

    _priceScale(pane, L) {
      const vis = this._visible();
      if (!vis.length) return { min: 0, max: 1, y: () => 0, inv: () => 0 };

      let min;
      let max;
      if (pane.key === 'main') {
        min = Math.min(...vis.map((c) => c.low));
        max = Math.max(...vis.map((c) => c.high));

        // ئاستە گرنگەکان (SL/TP/لیکویدەیشن) دەخەینە ناو دیدەوە — بەڵام تەنیا
        // ئەگەر نزیک بن. ئەگەرنا هێڵێکی دوور کەندڵەکان دەپەستێتەوە و وردەکاری لەدەست دەچێت.
        const span = max - min || max * 0.02;
        const lo = min - span * 0.55;
        const hi = max + span * 0.55;
        for (const p of this._priceLines()) {
          if (p.price >= lo && p.price <= hi) {
            min = Math.min(min, p.price);
            max = Math.max(max, p.price);
          }
        }
        const pad = (max - min) * 0.08 || max * 0.01;
        min -= pad;
        max += pad;
      } else if (pane.key === 'volume') {
        min = 0;
        max = Math.max(...vis.map((c) => c.volume)) * 1.1 || 1;
      } else if (pane.key === 'rsi') {
        min = 0;
        max = 100;
      } else {
        const from = Math.max(0, Math.floor(this.view.start));
        const to = Math.min(this.candles.length - 1, Math.ceil(this.view.end));
        const vals = this._macd()
          .slice(from, to + 1)
          .flatMap((m) => [m?.macd, m?.signal, m?.hist].filter((v) => v != null));
        // ئەگەر هێشتا داتای بەس نییە، پێوانەیەکی بنەڕەت بەکاردەهێنین
        const peak = vals.length ? Math.max(...vals.map(Math.abs)) : 0;
        const a = Number.isFinite(peak) && peak > 0 ? peak : 1;
        min = -a * 1.15;
        max = a * 1.15;
      }

      const y = (p) => pane.top + ((max - p) / (max - min || 1)) * pane.height;
      const inv = (py) => max - ((py - pane.top) / pane.height) * (max - min);
      return { min, max, y, inv };
    }

    /* ================= ژمێریاری ئەندیکەیتەر ================= */

    _ema(period) {
      const key = `ema${period}`;
      if (this._cache?.key === this._cacheKey() && this._cache[key]) return this._cache[key];
      const closes = this.candles.map((c) => c.close);
      const out = new Array(closes.length).fill(null);
      const k = 2 / (period + 1);
      let prev = null;
      for (let i = 0; i < closes.length; i++) {
        if (i === period - 1) {
          prev = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
          out[i] = prev;
        } else if (i >= period) {
          prev = closes[i] * k + prev * (1 - k);
          out[i] = prev;
        }
      }
      this._store(key, out);
      return out;
    }

    _cacheKey() {
      return `${this.candles.length}:${this.candles[this.candles.length - 1]?.time || 0}`;
    }
    _store(key, val) {
      if (!this._cache || this._cache.key !== this._cacheKey()) {
        this._cache = { key: this._cacheKey() };
      }
      this._cache[key] = val;
    }

    _bollinger(period = 20, mult = 2) {
      if (this._cache?.key === this._cacheKey() && this._cache.bb) return this._cache.bb;
      const closes = this.candles.map((c) => c.close);
      const upper = [];
      const mid = [];
      const lower = [];
      for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) {
          upper.push(null);
          mid.push(null);
          lower.push(null);
          continue;
        }
        const slice = closes.slice(i - period + 1, i + 1);
        const m = slice.reduce((a, b) => a + b, 0) / period;
        const sd = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / period);
        mid.push(m);
        upper.push(m + mult * sd);
        lower.push(m - mult * sd);
      }
      const bb = { upper, mid, lower };
      this._store('bb', bb);
      return bb;
    }

    _vwap(period = 20) {
      if (this._cache?.key === this._cacheKey() && this._cache.vwap) return this._cache.vwap;
      const out = [];
      for (let i = 0; i < this.candles.length; i++) {
        if (i < period - 1) {
          out.push(null);
          continue;
        }
        let pv = 0;
        let v = 0;
        for (let j = i - period + 1; j <= i; j++) {
          const c = this.candles[j];
          const tp = (c.high + c.low + c.close) / 3;
          pv += tp * c.volume;
          v += c.volume;
        }
        out.push(v ? pv / v : null);
      }
      this._store('vwap', out);
      return out;
    }

    _rsi(period = 14) {
      if (this._cache?.key === this._cacheKey() && this._cache.rsi) return this._cache.rsi;
      const closes = this.candles.map((c) => c.close);
      const out = new Array(closes.length).fill(null);
      let ag = 0;
      let al = 0;
      for (let i = 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        const g = d > 0 ? d : 0;
        const l = d < 0 ? -d : 0;
        if (i <= period) {
          ag += g / period;
          al += l / period;
          if (i === period) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
        } else {
          ag = (ag * (period - 1) + g) / period;
          al = (al * (period - 1) + l) / period;
          out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
        }
      }
      this._store('rsi', out);
      return out;
    }

    _macd() {
      if (this._cache?.key === this._cacheKey() && this._cache.macd) return this._cache.macd;
      const e12 = this._ema(12);
      const e26 = this._ema(26);
      const macdLine = e12.map((v, i) => (v == null || e26[i] == null ? null : v - e26[i]));

      const out = [];
      const k = 2 / 10;
      let prev = null;
      let count = 0;
      let sum = 0;
      for (let i = 0; i < macdLine.length; i++) {
        const m = macdLine[i];
        if (m == null) {
          out.push({ macd: null, signal: null, hist: null });
          continue;
        }
        count++;
        if (count < 9) {
          sum += m;
          out.push({ macd: m, signal: null, hist: null });
        } else if (count === 9) {
          sum += m;
          prev = sum / 9;
          out.push({ macd: m, signal: prev, hist: m - prev });
        } else {
          prev = m * k + prev * (1 - k);
          out.push({ macd: m, signal: prev, hist: m - prev });
        }
      }
      this._store('macd', out);
      return out;
    }

    /* ================= هێڵە گرنگەکان ================= */

    _priceLines() {
      const lines = [];

      // ناونیشانەکان بە کورتکراوەی ئینگلیزین — لە هەموو زمانەکاندا هەمان شت
      for (const p of this.positions) {
        lines.push({
          price: p.entryPrice,
          color: COLORS.entry,
          label: `ENTRY ${p.side === 'long' ? 'LONG' : 'SHORT'}`,
          kind: 'entry',
        });
        if (p.liquidationPrice) {
          lines.push({
            price: p.liquidationPrice,
            color: COLORS.liq,
            label: 'LIQ',
            kind: 'liq',
            dash: [2, 4],
          });
        }
      }

      for (const a of this.algo) {
        if (!a.triggerPrice) continue;
        lines.push({
          price: a.triggerPrice,
          color: a.kind === 'takeProfit' ? COLORS.tp : COLORS.sl,
          label: a.kind === 'takeProfit' ? 'TP' : 'SL',
          kind: a.kind,
          draggable: true,
          id: a.id,
          dash: [6, 4],
        });
      }

      for (const o of this.orders) {
        if (!o.price) continue;
        lines.push({
          price: o.price,
          color: o.side === 'buy' ? COLORS.up : COLORS.down,
          label: `${o.side === 'buy' ? 'BUY' : 'SELL'} ORDER`,
          kind: 'order',
          dash: [3, 3],
        });
      }

      const s = this.signal;
      if (s && !['wait', 'avoid'].includes(s.recommendation)) {
        lines.push({ price: s.entryPrice, color: COLORS.entry, label: 'AI ENTRY', dash: [5, 5] });
        lines.push({ price: s.stopLoss, color: COLORS.sl, label: 'AI SL', dash: [5, 5] });
        (s.takeProfits || []).forEach((tp, i) =>
          lines.push({ price: tp.price, color: COLORS.tp, label: `AI TP${i + 1}`, dash: [5, 5] })
        );
      }

      return lines.filter((l) => l.price != null && Number.isFinite(l.price));
    }

    /* ================= ڕێندەرکردن ================= */

    render() {
      const canvas = this.canvas;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.font = '11px "Segoe UI", sans-serif';

      if (!this.candles.length) {
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'center';
        ctx.fillText('داتا نییە', w / 2, h / 2);
        return;
      }

      const L = this._layout();
      this._L = L;

      this._drawPane(L.main, L, 'main');
      for (const s of L.subs) this._drawPane(s, L, s.key);
      this._drawTimeAxis(L);
      this._drawDrawings(L);
      this._drawCrosshair(L);
      this._drawLegend(L);
    }

    _drawPane(pane, L, kind) {
      const ctx = this.ctx;
      const sc = this._priceScale(pane, L);
      pane._scale = sc;

      // تۆڕ + نرخەکانی لای ڕاست
      ctx.strokeStyle = COLORS.grid;
      ctx.fillStyle = COLORS.text;
      ctx.lineWidth = 1;
      ctx.textAlign = 'left';
      const steps = kind === 'main' ? 5 : 2;
      for (let g = 0; g <= steps; g++) {
        const py = pane.top + (g / steps) * pane.height;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(L.plotW, py);
        ctx.stroke();
        const val = sc.max - (g / steps) * (sc.max - sc.min);
        ctx.fillText(this._fmtScale(val, kind), L.plotW + 6, py + 4);
      }

      if (kind === 'main') this._drawCandles(pane, L, sc);
      else if (kind === 'volume') this._drawVolume(pane, L, sc);
      else if (kind === 'rsi') this._drawRSI(pane, L, sc);
      else if (kind === 'macd') this._drawMACD(pane, L, sc);
    }

    _fmtScale(v, kind) {
      if (kind === 'volume') {
        if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
        if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
        if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
        return v.toFixed(0);
      }
      if (kind === 'rsi') return v.toFixed(0);
      if (kind === 'macd') return v.toFixed(4);
      const a = Math.abs(v);
      return v.toFixed(a >= 1000 ? 1 : a >= 1 ? 3 : a >= 0.01 ? 5 : 8);
    }

    _candleWidth(L) {
      const span = this.view.end - this.view.start || 1;
      return Math.max(1, (L.plotW / span) * 0.68);
    }

    _drawCandles(pane, L, sc) {
      const ctx = this.ctx;
      const bw = this._candleWidth(L);

      for (let i = Math.floor(this.view.start); i <= Math.ceil(this.view.end); i++) {
        const c = this.candles[i];
        if (!c) continue;
        const x = this._xOfIndex(i, L);
        const up = c.close >= c.open;
        ctx.strokeStyle = up ? COLORS.up : COLORS.down;
        ctx.fillStyle = up ? COLORS.up : COLORS.down;
        ctx.beginPath();
        ctx.moveTo(x, sc.y(c.high));
        ctx.lineTo(x, sc.y(c.low));
        ctx.stroke();
        const top = sc.y(Math.max(c.open, c.close));
        const bh = Math.max(1, Math.abs(sc.y(c.open) - sc.y(c.close)));
        ctx.fillRect(x - bw / 2, top, bw, bh);
      }

      // ئۆڤەرلەکان
      if (this.overlays.bb) {
        const bb = this._bollinger();
        this._line(bb.upper, sc, L, COLORS.bb, 1);
        this._line(bb.lower, sc, L, COLORS.bb, 1);
      }
      if (this.overlays.ema20) this._line(this._ema(20), sc, L, COLORS.ema20, 1.6);
      if (this.overlays.ema50) this._line(this._ema(50), sc, L, COLORS.ema50, 1.6);
      if (this.overlays.ema200) this._line(this._ema(200), sc, L, COLORS.ema200, 1.6);
      if (this.overlays.vwap) this._line(this._vwap(), sc, L, COLORS.vwap, 1.4);

      // نرخی ئێستا
      const lastC = this.candles[this.candles.length - 1];
      if (lastC) {
        const py = sc.y(lastC.close);
        if (py > pane.top && py < pane.top + pane.height) {
          ctx.strokeStyle = lastC.close >= lastC.open ? COLORS.up : COLORS.down;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(0, py);
          ctx.lineTo(L.plotW, py);
          ctx.stroke();
          ctx.setLineDash([]);
          this._tag(L.plotW, py, this._fmtScale(lastC.close, 'main'), ctx.strokeStyle);
        }
      }

      // هێڵە گرنگەکان + دەستگیرەکان
      this._handles = [];
      for (const l of this._priceLines()) {
        const py = sc.y(l.price);
        if (py < pane.top - 20 || py > pane.top + pane.height + 20) continue;
        ctx.strokeStyle = l.color;
        ctx.setLineDash(l.dash || []);
        ctx.lineWidth = l.draggable ? 1.8 : 1.2;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(L.plotW, py);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;

        ctx.fillStyle = l.color;
        ctx.textAlign = 'left';
        ctx.fillText(l.label, 6, py - 4);
        this._tag(L.plotW, py, this._fmtScale(l.price, 'main'), l.color);

        if (l.draggable) {
          // دەستگیرەی ڕاکێشان
          ctx.fillStyle = l.color;
          ctx.fillRect(L.plotW - 90, py - 4, 8, 8);
          this._handles.push({ y: py, kind: l.kind, id: l.id, price: l.price });
        }
      }
    }

    _tag(x, y, text, color) {
      const ctx = this.ctx;
      ctx.fillStyle = color;
      ctx.fillRect(x + 2, y - 8, AXIS_W - 4, 16);
      ctx.fillStyle = COLORS.tagText;
      ctx.textAlign = 'left';
      ctx.fillText(text, x + 6, y + 4);
    }

    _line(series, sc, L, color, width) {
      const ctx = this.ctx;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let started = false;
      for (let i = Math.floor(this.view.start); i <= Math.ceil(this.view.end); i++) {
        const v = series[i];
        if (v == null) continue;
        const x = this._xOfIndex(i, L);
        const y = sc.y(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    _drawVolume(pane, L, sc) {
      const ctx = this.ctx;
      const bw = this._candleWidth(L);
      for (let i = Math.floor(this.view.start); i <= Math.ceil(this.view.end); i++) {
        const c = this.candles[i];
        if (!c) continue;
        const x = this._xOfIndex(i, L);
        const y = sc.y(c.volume);
        ctx.fillStyle = c.close >= c.open ? COLORS.upFill : COLORS.downFill;
        ctx.fillRect(x - bw / 2, y, bw, pane.top + pane.height - y);
      }
    }

    _drawRSI(pane, L, sc) {
      const ctx = this.ctx;
      // ناوچەی زۆر کڕدراو / زۆر فرۆشراو
      ctx.fillStyle = 'rgba(255,77,79,0.07)';
      ctx.fillRect(0, sc.y(100), L.plotW, sc.y(70) - sc.y(100));
      ctx.fillStyle = 'rgba(0,192,118,0.07)';
      ctx.fillRect(0, sc.y(30), L.plotW, sc.y(0) - sc.y(30));
      ctx.strokeStyle = COLORS.grid;
      for (const lvl of [30, 50, 70]) {
        ctx.beginPath();
        ctx.moveTo(0, sc.y(lvl));
        ctx.lineTo(L.plotW, sc.y(lvl));
        ctx.stroke();
      }
      this._line(this._rsi(), sc, L, COLORS.draw, 1.5);
    }

    _drawMACD(pane, L, sc) {
      const ctx = this.ctx;
      const m = this._macd();
      const bw = this._candleWidth(L);
      const zero = sc.y(0);
      for (let i = Math.floor(this.view.start); i <= Math.ceil(this.view.end); i++) {
        const v = m[i];
        if (!v || v.hist == null) continue;
        const x = this._xOfIndex(i, L);
        ctx.fillStyle = v.hist >= 0 ? COLORS.upFill : COLORS.downFill;
        const y = sc.y(v.hist);
        ctx.fillRect(x - bw / 2, Math.min(y, zero), bw, Math.abs(y - zero));
      }
      this._line(m.map((v) => v?.macd ?? null), sc, L, COLORS.ema20, 1.4);
      this._line(m.map((v) => v?.signal ?? null), sc, L, COLORS.ema50, 1.4);
    }

    _drawTimeAxis(L) {
      const ctx = this.ctx;
      const y = L.h - TIME_H + 14;
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'center';
      const span = this.view.end - this.view.start;
      const step = Math.max(1, Math.floor(span / 7));
      for (let i = Math.ceil(this.view.start); i <= this.view.end; i += step) {
        const c = this.candles[i];
        if (!c) continue;
        const x = this._xOfIndex(i, L);
        if (x < 20 || x > L.plotW - 20) continue;
        const d = new Date(c.time);
        const label =
          span > 200
            ? `${d.getDate()}/${d.getMonth() + 1}`
            : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        ctx.fillText(label, x, y);
      }
      ctx.textAlign = 'left';
    }

    _drawLegend(L) {
      const ctx = this.ctx;
      const items = [];
      if (this.overlays.ema20) items.push(['EMA20', COLORS.ema20]);
      if (this.overlays.ema50) items.push(['EMA50', COLORS.ema50]);
      if (this.overlays.ema200) items.push(['EMA200', COLORS.ema200]);
      if (this.overlays.bb) items.push(['BB', COLORS.bb]);
      if (this.overlays.vwap) items.push(['VWAP', COLORS.vwap]);

      let x = 8;
      ctx.textAlign = 'left';
      for (const [label, color] of items) {
        ctx.fillStyle = color;
        ctx.fillRect(x, 8, 10, 3);
        ctx.fillText(label, x + 14, 12);
        x += ctx.measureText(label).width + 28;
      }
    }

    /* ================= هێڵکاری بەکارهێنەر ================= */

    _drawPointToXY(pt, L, sc) {
      return { x: this._xOfIndex(this._indexOfTime(pt.time), L), y: sc.y(pt.price) };
    }

    _drawDrawings(L) {
      const ctx = this.ctx;
      const sc = L.main._scale;
      if (!sc) return;

      const all = this.pending ? [...this.drawings, this.pending] : this.drawings;

      for (const d of all) {
        const active = d.id === this.selected || d === this.pending;
        ctx.strokeStyle = active ? COLORS.drawActive : d.color || COLORS.draw;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = active ? 2 : 1.5;
        ctx.setLineDash([]);

        const pts = d.points.map((p) => this._drawPointToXY(p, L, sc));

        if (d.type === 'hline') {
          ctx.beginPath();
          ctx.moveTo(0, pts[0].y);
          ctx.lineTo(L.plotW, pts[0].y);
          ctx.stroke();
          this._tag(L.plotW, pts[0].y, this._fmtScale(d.points[0].price, 'main'), ctx.strokeStyle);
        } else if (d.type === 'trend' && pts.length === 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.stroke();
        } else if (d.type === 'ray' && pts.length === 2) {
          const dx = pts[1].x - pts[0].x || 0.0001;
          const slope = (pts[1].y - pts[0].y) / dx;
          const endX = dx > 0 ? L.plotW : 0;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(endX, pts[0].y + slope * (endX - pts[0].x));
          ctx.stroke();
        } else if (d.type === 'rect' && pts.length === 2) {
          const x = Math.min(pts[0].x, pts[1].x);
          const y = Math.min(pts[0].y, pts[1].y);
          const rw = Math.abs(pts[1].x - pts[0].x);
          const rh = Math.abs(pts[1].y - pts[0].y);
          ctx.globalAlpha = 0.12;
          ctx.fillRect(x, y, rw, rh);
          ctx.globalAlpha = 1;
          ctx.strokeRect(x, y, rw, rh);
        } else if (d.type === 'fib' && pts.length === 2) {
          const p0 = d.points[0].price;
          const p1 = d.points[1].price;
          const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
          const x1 = Math.min(pts[0].x, pts[1].x);
          const x2 = Math.max(pts[0].x, pts[1].x);
          ctx.setLineDash([4, 3]);
          for (const lv of levels) {
            const price = p1 + (p0 - p1) * lv;
            const y = sc.y(price);
            ctx.beginPath();
            ctx.moveTo(x1, y);
            ctx.lineTo(Math.max(x2, x1 + 60), y);
            ctx.stroke();
            ctx.fillText(
              `${(lv * 100).toFixed(1)}%  ${this._fmtScale(price, 'main')}`,
              x1 + 4,
              y - 3
            );
          }
          ctx.setLineDash([]);
        }

        // خاڵەکانی کۆتایی بۆ هەڵبژێردراو
        if (active && d.type !== 'hline') {
          for (const p of pts) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.lineWidth = 1;
      }
    }

    _drawCrosshair(L) {
      if (!this.mouse.inside || this.mouse.x == null) return;
      const ctx = this.ctx;
      const { x, y } = this.mouse;
      if (x > L.plotW) return;

      ctx.strokeStyle = COLORS.crosshair;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, L.h - TIME_H);
      ctx.moveTo(0, y);
      ctx.lineTo(L.plotW, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // نرخی ژێر ماوس (تەنیا لە پانێڵی سەرەکیدا)
      const main = L.main;
      if (y >= main.top && y <= main.top + main.height && main._scale) {
        this._tag(L.plotW, y, this._fmtScale(main._scale.inv(y), 'main'), COLORS.crosshair);
      }

      // کاتی ژێر ماوس
      const idx = Math.round(this._indexOfX(x, L));
      const c = this.candles[idx];
      if (c) {
        const d = new Date(c.time);
        const label = `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(
          d.getMinutes()
        ).padStart(2, '0')}`;
        ctx.fillStyle = COLORS.crosshair;
        const tw = ctx.measureText(label).width + 10;
        ctx.fillRect(x - tw / 2, L.h - TIME_H, tw, 16);
        ctx.fillStyle = '#0d1117';
        ctx.textAlign = 'center';
        ctx.fillText(label, x, L.h - TIME_H + 12);
        ctx.textAlign = 'left';
      }
    }

    /* ================= کارلێکەری ماوس ================= */

    _bind() {
      const c = this.canvas;
      c.style.cursor = 'crosshair';

      c.addEventListener('mousemove', (e) => this._onMove(e));
      c.addEventListener('mousedown', (e) => this._onDown(e));
      window.addEventListener('mouseup', (e) => this._onUp(e));
      c.addEventListener('mouseleave', () => {
        this.mouse.inside = false;
        this.render();
      });
      c.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
      c.addEventListener('dblclick', () => this.resetView());
      c.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.selected) this.deleteSelected();
      });
    }

    _pos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    _dataPoint(x, y) {
      const L = this._L;
      const sc = L?.main?._scale;
      if (!sc) return null;
      return { time: this._timeOfIndex(this._indexOfX(x, L)), price: sc.inv(y) };
    }

    _onWheel(e) {
      e.preventDefault();
      const L = this._L;
      if (!L) return;
      const { x } = this._pos(e);
      const anchor = this._indexOfX(Math.min(x, L.plotW), L);
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;

      let start = anchor - (anchor - this.view.start) * factor;
      let end = anchor + (this.view.end - anchor) * factor;

      const minSpan = 12;
      const maxSpan = this.candles.length;
      if (end - start < minSpan) {
        const mid = (start + end) / 2;
        start = mid - minSpan / 2;
        end = mid + minSpan / 2;
      }
      if (end - start > maxSpan) {
        start = 0;
        end = maxSpan - 1;
      }

      this.view.start = Math.max(0, start);
      this.view.end = Math.min(this.candles.length - 1, end);
      if (this.view.end - this.view.start < minSpan) {
        this.view.end = Math.min(this.candles.length - 1, this.view.start + minSpan);
      }
      this.render();
    }

    _hitDrawing(x, y) {
      const L = this._L;
      const sc = L?.main?._scale;
      if (!sc) return null;
      const near = 7;

      for (let i = this.drawings.length - 1; i >= 0; i--) {
        const d = this.drawings[i];
        const pts = d.points.map((p) => this._drawPointToXY(p, L, sc));

        if (d.type === 'hline') {
          if (Math.abs(y - pts[0].y) < near) return { drawing: d, pointIndex: -1 };
        } else if (pts.length === 2) {
          for (let pi = 0; pi < 2; pi++) {
            if (Math.hypot(x - pts[pi].x, y - pts[pi].y) < near + 2) {
              return { drawing: d, pointIndex: pi };
            }
          }
          if (d.type === 'rect' || d.type === 'fib') {
            const inX = x >= Math.min(pts[0].x, pts[1].x) - near && x <= Math.max(pts[0].x, pts[1].x) + near;
            const inY = y >= Math.min(pts[0].y, pts[1].y) - near && y <= Math.max(pts[0].y, pts[1].y) + near;
            if (inX && inY) return { drawing: d, pointIndex: -1 };
          } else if (this._distToSegment(x, y, pts[0], pts[1]) < near) {
            return { drawing: d, pointIndex: -1 };
          }
        }
      }
      return null;
    }

    _distToSegment(px, py, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (!len2) return Math.hypot(px - a.x, py - a.y);
      let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
    }

    _onDown(e) {
      const { x, y } = this._pos(e);
      const L = this._L;
      if (!L) return;

      // ١) دەستگیرەی SL/TP
      if (this.tool === 'cursor' && this._handles) {
        const h = this._handles.find((hh) => Math.abs(hh.y - y) < 7 && x > L.plotW - 110);
        if (h) {
          this.dragging = { type: 'sltp', kind: h.kind, id: h.id, y };
          return;
        }
      }

      // ٢) دروستکردنی هێڵکاری نوێ
      if (this.tool !== 'cursor' && x <= L.plotW) {
        const p = this._dataPoint(x, y);
        if (!p) return;

        if (this.tool === 'hline') {
          this._commitDrawing({ type: 'hline', points: [p] });
          return;
        }
        if (!this.pending) {
          this.pending = {
            id: `d${Date.now()}`,
            type: this.tool,
            points: [p, p],
            color: COLORS.draw,
          };
        } else {
          this.pending.points[1] = p;
          this._commitDrawing(this.pending);
          this.pending = null;
        }
        this.render();
        return;
      }

      // ٣) هەڵبژاردن / جوڵاندنی هێڵکاری
      if (this.tool === 'cursor') {
        const hit = this._hitDrawing(x, y);
        if (hit) {
          this.selected = hit.drawing.id;
          this.dragging = {
            type: 'drawing',
            drawing: hit.drawing,
            pointIndex: hit.pointIndex,
            origin: this._dataPoint(x, y),
            snapshot: JSON.parse(JSON.stringify(hit.drawing.points)),
          };
          this.render();
          return;
        }
        this.selected = null;
      }

      // ٤) پان
      this.dragging = { type: 'pan', x, start: this.view.start, end: this.view.end };
      this.canvas.style.cursor = 'grabbing';
      this.render();
    }

    _onMove(e) {
      const { x, y } = this._pos(e);
      this.mouse = { x, y, inside: true };
      const L = this._L;
      if (!L) return;

      const d = this.dragging;
      if (d?.type === 'pan') {
        const span = this.view.end - this.view.start;
        const shift = ((d.x - x) / L.plotW) * span;
        let start = d.start + shift;
        let end = d.end + shift;
        const maxEnd = this.candles.length + span * 0.25;
        if (start < -span * 0.25) {
          end += -span * 0.25 - start;
          start = -span * 0.25;
        }
        if (end > maxEnd) {
          start -= end - maxEnd;
          end = maxEnd;
        }
        this.view.start = start;
        this.view.end = end;
      } else if (d?.type === 'drawing') {
        const now = this._dataPoint(x, y);
        if (now) {
          if (d.pointIndex >= 0) {
            d.drawing.points[d.pointIndex] = now;
          } else {
            const dt = now.time - d.origin.time;
            const dp = now.price - d.origin.price;
            d.drawing.points = d.snapshot.map((p) => ({ time: p.time + dt, price: p.price + dp }));
          }
        }
      } else if (d?.type === 'sltp') {
        d.y = y;
        const sc = L.main._scale;
        d.newPrice = sc.inv(y);
      } else if (this.pending) {
        const p = this._dataPoint(x, y);
        if (p) this.pending.points[1] = p;
      }

      // نیشاندانی داتای کەندڵ لە ژێر ماوس
      const idx = Math.round(this._indexOfX(x, L));
      this.onCrosshair(this.candles[idx] || null);

      this.render();
    }

    _onUp() {
      const d = this.dragging;
      this.dragging = null;
      this.canvas.style.cursor = this.tool === 'cursor' ? 'crosshair' : 'copy';

      if (!d) return;

      if (d.type === 'drawing') {
        this.onDrawingsChange(this.drawings);
      } else if (d.type === 'sltp' && d.newPrice) {
        const price = d.newPrice;
        this.onSLTPChange({ kind: d.kind, id: d.id, price });
      }
      this.render();
    }

    _commitDrawing(d) {
      const item = { id: d.id || `d${Date.now()}`, type: d.type, points: d.points, color: COLORS.draw };
      this.drawings.push(item);
      this.selected = item.id;
      this.onDrawingsChange(this.drawings);
      this.render();
    }
  }

  window.TradeChart = TradeChart;
})();
