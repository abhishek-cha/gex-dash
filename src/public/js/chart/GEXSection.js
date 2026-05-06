import { COLORS } from './constants.js';
import { BaseSection } from './BaseSection.js';
import { bus } from './EventBus.js';

function hexCss(c) {
  return '#' + c.toString(16).padStart(6, '0');
}

export class GEXSection extends BaseSection {
  constructor(container, viewport, layoutOverrides) {
    super(container, viewport, layoutOverrides);

    this._addGroup('gexBars');
    this._addGroup('cumulativeLine');
    this._initHighlightGroup();

    this._labelsOverlay = null;
    this._tooltip = null;
    this._displayMode = 'gex'; // 'gex' or 'oi'
    this._cachedMax = { maxCall: 1, maxPut: 1 };

    this._initOverlays();
    this._initToggle();

    this._setupInteraction();

    this._unsubs = [
      bus.on('viewport:change', () => this.rebuild()),
      bus.on('interaction:crosshair', (data) => this._onCrosshair(data)),
    ];

  }

  _initOverlays() {
    this._labelsOverlay = document.createElement('div');
    this._labelsOverlay.className = 'labels-overlay';
    this.container.appendChild(this._labelsOverlay);

    this._crosshairH = document.createElement('div');
    this._crosshairH.className = 'crosshair-h';
    this.container.appendChild(this._crosshairH);

    this._tooltip = document.createElement('div');
    this._tooltip.className = 'tooltip';
    this.container.appendChild(this._tooltip);
  }

  _initToggle() {
    if (this.layout.hideToggle) return;

    const toggle = document.createElement('div');
    toggle.className = 'gex-mode-toggle';

    const gexBtn = document.createElement('button');
    gexBtn.textContent = 'GEX';
    gexBtn.className = 'active';
    gexBtn.addEventListener('click', () => {
      if (this._displayMode === 'gex') return;
      this._displayMode = 'gex';
      gexBtn.classList.add('active');
      oiBtn.classList.remove('active');
      this.rebuild();
    });

    const oiBtn = document.createElement('button');
    oiBtn.textContent = 'OI';
    oiBtn.addEventListener('click', () => {
      if (this._displayMode === 'oi') return;
      this._displayMode = 'oi';
      oiBtn.classList.add('active');
      gexBtn.classList.remove('active');
      this.rebuild();
    });

    toggle.appendChild(gexBtn);
    toggle.appendChild(oiBtn);
    this.container.appendChild(toggle);
  }

  setDisplayMode(mode) {
    this._displayMode = mode;
    this.rebuild();
  }

  rebuild() {
    this._clearAllGroups();
    this._highlightedStrike = null;
    this._clearHighlightGroup();
    if (this._displayMode === 'oi') {
      this._cachedMax = this._visibleOIMax();
      this._buildOIBars();
    } else {
      this._cachedMax = this._visibleGexMax();
      this._buildGEXBars();
      this._buildCumulativeLine();
    }
    this._buildSeparator();
    this._updateLabels();
    this.render();
  }

  // --- Rendering (runs on every rebuild: pan, zoom, resize) ---

  _visibleLevels() {
    const vp = this.viewport;
    const pMin = vp.viewPriceMin;
    const pMax = vp.viewPriceMax;
    return vp.sortedLevels.filter(l => l.strike >= pMin && l.strike <= pMax);
  }

  _visibleGexMax() {
    let maxCall = 1, maxPut = 1;
    for (const l of this._visibleLevels()) {
      const ac = Math.abs(l.callGex);
      const ap = Math.abs(l.putGex);
      if (ac > maxCall) maxCall = ac;
      if (ap > maxPut) maxPut = ap;
    }
    return { maxCall, maxPut };
  }

  _visibleOIMax() {
    let maxCall = 1, maxPut = 1;
    for (const l of this._visibleLevels()) {
      const c = l.callOI || 0;
      const p = l.putOI || 0;
      if (c > maxCall) maxCall = c;
      if (p > maxPut) maxPut = p;
    }
    return { maxCall, maxPut };
  }

  _buildGEXBars() {
    const vp = this.viewport;
    if (!vp.gexLevels.length) return;

    const { maxCall, maxPut } = this._cachedMax;
    const callFrac = maxCall / (maxCall + maxPut);
    const callW = this.width * callFrac;
    const putW = this.width - callW;
    const centerX = putW;
    const strikes = vp.sortedStrikes;

    for (const level of vp.sortedLevels) {
      const py = this.priceToY(level.strike);
      if (py < this._marginBottom() || py > this.height - this._marginTop()) continue;
      const idx = vp.strikeIndex.get(level.strike);
      const { y: barY, h: barH } = this._gexBarBounds(level.strike, strikes, idx);

      if (level.callGex > 0) {
        const w = Math.max(2, (level.callGex / maxCall) * callW);
        this.groups.gexBars.add(
          this.makePlane(centerX, barY, w, barH, COLORS.callGex, 0.85)
        );
      }

      if (level.putGex < 0) {
        const w = Math.max(2, (Math.abs(level.putGex) / maxPut) * putW);
        this.groups.gexBars.add(
          this.makePlane(centerX - w, barY, w, barH, COLORS.putGex, 0.85)
        );
      }
    }
  }

  _buildOIBars() {
    const vp = this.viewport;
    if (!vp.gexLevels.length) return;

    const { maxCall, maxPut } = this._cachedMax;
    const callFrac = maxCall / (maxCall + maxPut);
    const callW = this.width * callFrac;
    const putW = this.width - callW;
    const centerX = putW;
    const strikes = vp.sortedStrikes;

    for (const level of vp.sortedLevels) {
      const py = this.priceToY(level.strike);
      if (py < this._marginBottom() || py > this.height - this._marginTop()) continue;
      const idx = vp.strikeIndex.get(level.strike);
      const { y: barY, h: barH } = this._gexBarBounds(level.strike, strikes, idx);

      const callOI = level.callOI || 0;
      const putOI = level.putOI || 0;

      if (callOI > 0) {
        const w = Math.max(2, (callOI / maxCall) * callW);
        this.groups.gexBars.add(
          this.makePlane(centerX, barY, w, barH, COLORS.callGex, 0.85)
        );
      }

      if (putOI > 0) {
        const w = Math.max(2, (putOI / maxPut) * putW);
        this.groups.gexBars.add(
          this.makePlane(centerX - w, barY, w, barH, COLORS.putGex, 0.85)
        );
      }
    }
  }

  _buildCumulativeLine() {
    const vp = this.viewport;
    if (!vp.gexLevels.length) return;
    const combined = vp.combinedCumulative;
    if (!combined || vp.maxCumulativeAbs === 0) return;

    const { maxCall, maxPut } = this._cachedMax;
    const callFrac = maxCall / (maxCall + maxPut);
    const callW = this.width * callFrac;
    const putW = this.width - callW;
    const centerX = putW;

    const sorted = vp.sortedLevels;
    const n = sorted.length;
    const maxAbs = vp.maxCumulativeAbs;
    const marginX = 20;
    const usableW = this.width - marginX * 2;
    const points = [];
    for (let i = 0; i < n; i++) {
      const py = this.priceToY(sorted[i].strike);
      if (py < this._marginBottom() || py > this.height - this._marginTop()) continue;
      const xFrac = combined[i] / maxAbs;
      const x = centerX + xFrac * (usableW / 2);
      points.push([x, py]);
    }

    if (points.length < 2) return;
    this.groups.cumulativeLine.add(
      this.makeLine(points, COLORS.cumulativeGex, 0.9)
    );
  }

  _buildSeparator() {
    // Left edge separator
    this.groups.gexBars.add(
      this.makeLine([[0, 0], [0, this.height]], COLORS.separator, 0.6)
    );
  }

  _setupInteraction() {
    this.container.addEventListener('mousemove', (e) => {
      const rect = this.container.getBoundingClientRect();
      const my = e.clientY - rect.top;
      const price = this.yToPrice(this.height - my);
      bus.emit('interaction:crosshair', { price, source: 'gex' });
    });
    this.container.addEventListener('mouseleave', () => {
      bus.emit('interaction:crosshair', null);
    });
  }

  _onCrosshair(data) {
    if (!data) {
      this.clearHighlight();
      this._crosshairH.style.display = 'none';
      this._tooltip.style.display = 'none';
      return;
    }

    const myY = this.height - this.priceToY(data.price);
    this._crosshairH.style.display = 'block';
    this._crosshairH.style.top = myY + 'px';

    const vp = this.viewport;
    const nearest = vp.nearestGexLevel(data.price);
    if (nearest) {
      this.highlightStrike(nearest);
      this._tooltip.style.display = 'block';
      this._tooltip.style.left = '8px';
      const myFromPrice = this.height - this.priceToY(data.price);
      this._tooltip.style.top = (myFromPrice - 10) + 'px';

      if (this._displayMode === 'oi') {
        this._tooltip.innerHTML =
          `<div>Strike: ${nearest.strike}</div>` +
          `<div style="color:${hexCss(COLORS.callGex)}">Call OI: ${vp.fmtVol(nearest.callOI || 0)}</div>` +
          `<div style="color:${hexCss(COLORS.putGex)}">Put OI: ${vp.fmtVol(nearest.putOI || 0)}</div>` +
          `<div>Total OI: ${vp.fmtVol(nearest.totalOI)}</div>` +
          `<div style="color:${hexCss(COLORS.volume)}">Volume: ${vp.fmtVol(nearest.totalVolume)}</div>`;
      } else {
        this._tooltip.innerHTML =
          `<div>Strike: ${nearest.strike}</div>` +
          `<div style="color:${hexCss(COLORS.callGex)}">Call GEX: ${vp.fmtGex(nearest.callGex)}</div>` +
          `<div style="color:${hexCss(COLORS.putGex)}">Put GEX: ${vp.fmtGex(nearest.putGex)}</div>` +
          `<div style="color:${hexCss(COLORS.netGex)}">Net GEX: ${vp.fmtGex(nearest.netGex)}</div>` +
          `<div style="color:${hexCss(COLORS.volume)}">Volume: ${vp.fmtVol(nearest.totalVolume)}</div>` +
          `<div>OI: ${vp.fmtVol(nearest.totalOI)}</div>` +
          (vp.cumulativeMap && vp.cumulativeMap.has(nearest.strike)
            ? `<div style="color:${hexCss(COLORS.cumulativeGex)}">Cum. GEX: ${vp.fmtGex(vp.cumulativeMap.get(nearest.strike))}</div>`
            : '');
      }
    } else {
      this.clearHighlight();
      this._tooltip.style.display = 'none';
    }
  }

  highlightStrike(level) {
    if (!level || this._highlightedStrike === level.strike) return;
    this._highlightedStrike = level.strike;
    this._clearHighlightGroup();

    const py = this.priceToY(level.strike);
    if (py < this._marginBottom() || py > this.height - this._marginTop()) return;

    const vp = this.viewport;
    const strikes = vp.sortedStrikes;
    const idx = vp.strikeIndex.get(level.strike);
    if (idx === undefined) return;
    const { y: barY, h: barH } = this._gexBarBounds(level.strike, strikes, idx);
    const glowPad = Math.max(2, barH * 0.3);
    const glowY = barY - glowPad / 2;
    const glowH = barH + glowPad;

    const { maxCall, maxPut } = this._cachedMax;
    const callFrac = maxCall / (maxCall + maxPut);
    const callW = this.width * callFrac;
    const putW = this.width - callW;
    const centerX = putW;

    if (this._displayMode === 'oi') {
      const callOI = level.callOI || 0;
      const putOI = level.putOI || 0;
      if (callOI > 0) {
        const w = (callOI / maxCall) * callW + glowPad;
        this._highlightGroup.add(
          this.makePlane(centerX, glowY, w, glowH, COLORS.callGex, 0.25)
        );
      }
      if (putOI > 0) {
        const w = (putOI / maxPut) * putW + glowPad;
        this._highlightGroup.add(
          this.makePlane(centerX - w, glowY, w, glowH, COLORS.putGex, 0.25)
        );
      }
    } else {
      if (level.callGex > 0) {
        const w = (level.callGex / maxCall) * callW + glowPad;
        this._highlightGroup.add(
          this.makePlane(centerX, glowY, w, glowH, COLORS.callGex, 0.25)
        );
      }
      if (level.putGex < 0) {
        const w = (Math.abs(level.putGex) / maxPut) * putW + glowPad;
        this._highlightGroup.add(
          this.makePlane(centerX - w, glowY, w, glowH, COLORS.putGex, 0.25)
        );
      }
    }
    this.render();
  }

  clearHighlight() {
    if (this._highlightedStrike === null) return;
    this._highlightedStrike = null;
    this._clearHighlightGroup();
    this.render();
  }

  _updateLabels() {
    const vp = this.viewport;
    const overlay = this._labelsOverlay;
    const frag = document.createDocumentFragment();

    if (vp.gexLevels.length > 0) {
      if (this._displayMode === 'oi') {
        this._addOIScale(frag);
      } else {
        this._addGexScale(frag);
      }
    }

    overlay.innerHTML = '';
    overlay.appendChild(frag);
  }

  _addGexScale(frag) {
    const vp = this.viewport;
    const { maxCall, maxPut } = this._cachedMax;
    const callFrac = maxCall / (maxCall + maxPut);
    const callW = this.width * callFrac;
    const putW = this.width - callW;
    const centerX = putW;
    const minPxPerTick = 60;

    const zeroLbl = document.createElement('div');
    zeroLbl.className = 'gex-scale-label';
    zeroLbl.style.left = centerX + 'px';
    zeroLbl.textContent = '0';
    frag.appendChild(zeroLbl);

    const callTicks = Math.max(1, Math.floor(callW / minPxPerTick));
    const callStep = vp.niceStep(maxCall, callTicks);
    for (let v = callStep; v <= maxCall * 1.05; v += callStep) {
      const rx = centerX + (v / maxCall) * callW;
      if (rx < this.width - 30) {
        const rl = document.createElement('div');
        rl.className = 'gex-scale-label';
        rl.style.left = rx + 'px';
        rl.style.color = hexCss(COLORS.callGex);
        rl.textContent = vp.fmtGex(v);
        frag.appendChild(rl);
      }
    }

    const putTicks = Math.max(1, Math.floor(putW / minPxPerTick));
    const putStep = vp.niceStep(maxPut, putTicks);
    for (let v = putStep; v <= maxPut * 1.05; v += putStep) {
      const lx = centerX - (v / maxPut) * putW;
      if (lx > 30) {
        const ll = document.createElement('div');
        ll.className = 'gex-scale-label';
        ll.style.left = lx + 'px';
        ll.style.color = hexCss(COLORS.putGex);
        ll.textContent = vp.fmtGex(v);
        frag.appendChild(ll);
      }
    }
  }

  _addOIScale(frag) {
    const vp = this.viewport;
    const { maxCall, maxPut } = this._cachedMax;
    const callFrac = maxCall / (maxCall + maxPut);
    const callW = this.width * callFrac;
    const putW = this.width - callW;
    const centerX = putW;
    const minPxPerTick = 60;

    const zeroLbl = document.createElement('div');
    zeroLbl.className = 'gex-scale-label';
    zeroLbl.style.left = centerX + 'px';
    zeroLbl.textContent = '0';
    frag.appendChild(zeroLbl);

    const callTicks = Math.max(1, Math.floor(callW / minPxPerTick));
    const callStep = vp.niceStep(maxCall, callTicks);
    for (let v = callStep; v <= maxCall * 1.05; v += callStep) {
      const rx = centerX + (v / maxCall) * callW;
      if (rx < this.width - 30) {
        const rl = document.createElement('div');
        rl.className = 'gex-scale-label';
        rl.style.left = rx + 'px';
        rl.style.color = hexCss(COLORS.callGex);
        rl.textContent = vp.fmtVol(v);
        frag.appendChild(rl);
      }
    }

    const putTicks = Math.max(1, Math.floor(putW / minPxPerTick));
    const putStep = vp.niceStep(maxPut, putTicks);
    for (let v = putStep; v <= maxPut * 1.05; v += putStep) {
      const lx = centerX - (v / maxPut) * putW;
      if (lx > 30) {
        const ll = document.createElement('div');
        ll.className = 'gex-scale-label';
        ll.style.left = lx + 'px';
        ll.style.color = hexCss(COLORS.putGex);
        ll.textContent = vp.fmtVol(v);
        frag.appendChild(ll);
      }
    }
  }

  dispose() {
    for (const unsub of this._unsubs) unsub();
    super.dispose();
  }
}
