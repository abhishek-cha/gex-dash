import { bus } from './EventBus.js';

export class ViewportModel {
  constructor() {
    this.priceData = [];
    this.gexLevels = [];
    this._coldGexLevels = [];
    this.spotPrice = 0;

    this.viewPriceMin = 0;
    this.viewPriceMax = 0;
    this.viewStartIdx = 0;
    this.viewEndIdx = 0;

    this._manualYScale = false;

    // Derived GEX data — computed on commitGEX, cleared on clearGEX
    this.sortedStrikes = [];
    this.strikeIndex = new Map();
    this.sortedLevels = [];
    this.gexMax = 1;
    this.cumulativeMap = null;
    this.combinedCumulative = null;
    this.maxCumulativeAbs = 0;
  }

  loadPriceData(priceHistory) {
    this.priceData = priceHistory.candles.map(c => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      date: new Date(c.datetime),
    }));

    if (this.priceData.length > 0) {
      this.viewStartIdx = 0;
      this.viewEndIdx = this.priceData.length;
      this._autoFitY();
    }
    bus.emit('viewport:change');
  }

  autoFitY() {
    this._autoFitY();
    bus.emit('viewport:change');
  }

  _autoFitY() {
    const start = Math.max(0, Math.floor(this.viewStartIdx));
    const end = Math.min(this.priceData.length, Math.ceil(this.viewEndIdx));
    if (start >= end) return;
    let lo = Infinity, hi = -Infinity;
    for (let i = start; i < end; i++) {
      const c = this.priceData[i];
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
    }
    if (lo === Infinity) return;
    const pad = (hi - lo) * 0.06 || 1;
    this.viewPriceMin = lo - pad;
    this.viewPriceMax = hi + pad;
  }

  mergeGEXChunk(gexData) {
    const incoming = gexData.gexLevels || [];
    if (this._coldGexLevels.length === 0) {
      this._coldGexLevels = incoming;
      return;
    }
    const map = new Map();
    for (const l of this._coldGexLevels) map.set(l.strike, { ...l });
    for (const l of incoming) {
      const existing = map.get(l.strike);
      if (existing) {
        existing.callGex += l.callGex;
        existing.putGex += l.putGex;
        existing.netGex += l.netGex;
        existing.totalVolume += l.totalVolume;
        existing.totalOI += l.totalOI;
      } else {
        map.set(l.strike, { ...l });
      }
    }
    this._coldGexLevels = [...map.values()].sort((a, b) => a.strike - b.strike);
  }

  commitGEX() {
    this.gexLevels = this._coldGexLevels;
    this._coldGexLevels = [];
    this._postProcessGEX();
  }

  setSpotPrice(price) {
    this.spotPrice = price || 0;
  }

  clearGEX() {
    this.gexLevels = [];
    this._coldGexLevels = [];
    this.spotPrice = 0;
    this._clearDerivedGEX();
  }

  clearPrice() {
    this.priceData = [];
    this.viewStartIdx = 0;
    this.viewEndIdx = 0;
  }

  _postProcessGEX() {
    if (!this.gexLevels.length) {
      this._clearDerivedGEX();
      return;
    }

    // Sorted strikes + index
    const levelMap = new Map(this.gexLevels.map(l => [l.strike, l]));
    this.sortedStrikes = [...levelMap.keys()].sort((a, b) => a - b);
    this.strikeIndex = new Map();
    for (let i = 0; i < this.sortedStrikes.length; i++) {
      this.strikeIndex.set(this.sortedStrikes[i], i);
    }
    this.sortedLevels = this.sortedStrikes.map(s => levelMap.get(s));

    // GEX max
    let maxCallGex = 1, maxPutGex = 1;
    for (const l of this.gexLevels) {
      const ac = Math.abs(l.callGex);
      const ap = Math.abs(l.putGex);
      if (ac > maxCallGex) maxCallGex = ac;
      if (ap > maxPutGex) maxPutGex = ap;
    }
    this.gexMax = Math.max(maxCallGex, maxPutGex);

    // Cumulative GEX
    this._computeCumulative();
  }

  _computeCumulative() {
    const sorted = this.sortedLevels;
    const n = sorted.length;
    if (n < 2) {
      this.cumulativeMap = null;
      this.combinedCumulative = null;
      this.maxCumulativeAbs = 0;
      return;
    }

    // Bottom-up cumulative (lowest strike → highest)
    const bottomUp = new Array(n);
    bottomUp[0] = sorted[0].netGex;
    for (let i = 1; i < n; i++) bottomUp[i] = bottomUp[i - 1] + sorted[i].netGex;

    // Top-down cumulative (highest strike → lowest)
    const topDown = new Array(n);
    topDown[n - 1] = sorted[n - 1].netGex;
    for (let i = n - 2; i >= 0; i--) topDown[i] = topDown[i + 1] + sorted[i].netGex;

    // Find flip point: sign change closest to spot price
    const totalNet = bottomUp[n - 1];
    const cum = totalNet >= 0 ? bottomUp : topDown;
    const spot = this.spotPrice || 0;
    let flipIdx = -1;
    let bestDist = Infinity;
    for (let i = 1; i < n; i++) {
      if ((cum[i - 1] >= 0 && cum[i] < 0) || (cum[i - 1] < 0 && cum[i] >= 0)) {
        const idx = Math.abs(cum[i - 1]) <= Math.abs(cum[i]) ? i - 1 : i;
        const dist = Math.abs(sorted[idx].strike - spot);
        if (dist < bestDist) { bestDist = dist; flipIdx = idx; }
      }
    }
    if (flipIdx === -1) {
      flipIdx = 0;
      let minAbs = Math.abs(cum[0]);
      for (let i = 1; i < n; i++) {
        const a = Math.abs(cum[i]);
        if (a < minAbs) { minAbs = a; flipIdx = i; }
      }
    }

    // Splice: bottom-up below flip, top-down above flip
    const combined = new Array(n);
    for (let i = 0; i <= flipIdx; i++) combined[i] = bottomUp[i];
    for (let i = flipIdx + 1; i < n; i++) combined[i] = topDown[i];

    this.combinedCumulative = combined;

    // Cumulative map for tooltip
    this.cumulativeMap = new Map();
    for (let i = 0; i < n; i++) {
      this.cumulativeMap.set(sorted[i].strike, combined[i]);
    }

    // Max absolute for scaling
    let maxAbs = 0;
    for (const c of combined) {
      const a = Math.abs(c);
      if (a > maxAbs) maxAbs = a;
    }
    this.maxCumulativeAbs = maxAbs;
  }

  _clearDerivedGEX() {
    this.sortedStrikes = [];
    this.strikeIndex = new Map();
    this.sortedLevels = [];
    this.gexMax = 1;
    this.cumulativeMap = null;
    this.combinedCumulative = null;
    this.maxCumulativeAbs = 0;
  }

  nearestGexLevel(price) {
    let best = null;
    let bestDist = Infinity;
    for (const l of this.gexLevels) {
      const d = Math.abs(l.strike - price);
      if (d < bestDist) { bestDist = d; best = l; }
    }
    return best;
  }

  niceStep(range, targetTicks) {
    const rough = range / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const frac = rough / mag;
    let nice;
    if (frac <= 1.5) nice = 1;
    else if (frac <= 3.5) nice = 2;
    else if (frac <= 7.5) nice = 5;
    else nice = 10;
    return nice * mag;
  }

  fmtGex(val) {
    const abs = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';
    return sign + abs.toFixed(0);
  }

  fmtVol(val) {
    if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M';
    if (val >= 1e3) return (val / 1e3).toFixed(1) + 'K';
    return val.toFixed(0);
  }
}
