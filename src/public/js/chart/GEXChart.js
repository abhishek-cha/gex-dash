import * as THREE from 'three';
import { COLORS, LAYOUT } from './constants.js';
import { buildGrid, buildCandles, buildGEXBars, buildNetGEXBars, buildSeparators, buildPriceLine } from './renderers.js';
import { setupInteraction } from './interaction.js';
import { updateLabels } from './labels.js';

export class GEXChart {
  constructor(container) {
    this.container = container;
    this.width = container.clientWidth;
    this.height = container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.bg);

    this.camera = new THREE.OrthographicCamera(
      0, this.width, this.height, 0, -10, 10
    );
    this.camera.position.z = 1;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.width, this.height);
    container.insertBefore(this.renderer.domElement, container.firstChild);

    this.groups = {
      grid: new THREE.Group(),
      candles: new THREE.Group(),
      gexBars: new THREE.Group(),
      netGexBars: new THREE.Group(),
      overlays: new THREE.Group(),
    };
    for (const g of Object.values(this.groups)) this.scene.add(g);

    this.priceData = [];
    this.gexLevels = [];
    this.spotPrice = 0;

    this.viewPriceMin = 0;
    this.viewPriceMax = 0;
    this.viewStartIdx = 0;
    this.viewEndIdx = 0;

    setupInteraction(this);
    this._animate();

    window.addEventListener('resize', () => this._onResize());
  }

  _sectionBounds() {
    const w = this.width;
    const h = this.height;
    const netW = w * LAYOUT.netGexSectionRatio;
    const gexW = w * LAYOUT.gexSectionRatio;
    const axisW = LAYOUT.priceAxisWidth;
    const candleW = w - gexW - netW - axisW - LAYOUT.marginLeft;

    return {
      candle: { left: LAYOUT.marginLeft, right: LAYOUT.marginLeft + candleW, width: candleW },
      axis:   { left: LAYOUT.marginLeft + candleW, right: LAYOUT.marginLeft + candleW + axisW, width: axisW },
      gex:    { left: w - netW - gexW, right: w - netW, width: gexW },
      netGex: { left: w - netW, right: w, width: netW },
      top: h - LAYOUT.marginTop,
      bottom: LAYOUT.marginBottom,
      chartH: h - LAYOUT.marginTop - LAYOUT.marginBottom,
    };
  }

  _priceToY(price) {
    const s = this._sectionBounds();
    const t = (price - this.viewPriceMin) / (this.viewPriceMax - this.viewPriceMin);
    return s.bottom + t * s.chartH;
  }

  _yToPrice(y) {
    const s = this._sectionBounds();
    const t = (y - s.bottom) / s.chartH;
    return this.viewPriceMin + t * (this.viewPriceMax - this.viewPriceMin);
  }

  _idxToX(idx) {
    const s = this._sectionBounds();
    const visibleCount = this.viewEndIdx - this.viewStartIdx;
    if (visibleCount <= 0) return s.candle.left;
    const t = (idx - this.viewStartIdx) / visibleCount;
    return s.candle.left + t * s.candle.width;
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

    this.rebuild();
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

  loadGEXData(gexData) {
    this.gexLevels = gexData.gexLevels || [];
    this.spotPrice = gexData.underlyingPrice || gexData.underlying?.last || 0;
    this.rebuild();
  }

  clearGEX() {
    this.gexLevels = [];
    this.spotPrice = 0;
    this.rebuild();
  }

  rebuild() {
    for (const g of Object.values(this.groups)) {
      while (g.children.length) {
        const c = g.children[0];
        g.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      }
    }
    buildGrid(this);
    buildCandles(this);
    buildGEXBars(this);
    buildNetGEXBars(this);
    buildSeparators(this);
    buildPriceLine(this);
    updateLabels(this);
    this._render();
  }

  _makePlane(x, y, w, h, color, opacity = 1.0) {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + w / 2, y + h / 2, 0);
    return mesh;
  }

  _makeLine(points, color, opacity = 1.0) {
    const geo = new THREE.BufferGeometry().setFromPoints(
      points.map(p => new THREE.Vector3(p[0], p[1], 0))
    );
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
    });
    return new THREE.Line(geo, mat);
  }

  _gexBarBounds(strike, sortedStrikes) {
    const idx = sortedStrikes.indexOf(strike);
    const y = this._priceToY(strike);
    let top, bottom;
    if (sortedStrikes.length < 2) return { y, h: 4 };
    if (idx <= 0) {
      const nextY = this._priceToY(sortedStrikes[1]);
      const halfGap = Math.abs(y - nextY) / 2;
      top = y + halfGap;
      bottom = y - halfGap;
    } else if (idx >= sortedStrikes.length - 1) {
      const prevY = this._priceToY(sortedStrikes[idx - 1]);
      const halfGap = Math.abs(y - prevY) / 2;
      top = y + halfGap;
      bottom = y - halfGap;
    } else {
      const prevY = this._priceToY(sortedStrikes[idx - 1]);
      const nextY = this._priceToY(sortedStrikes[idx + 1]);
      top = (y + prevY) / 2;
      bottom = (y + nextY) / 2;
      if (top < bottom) [top, bottom] = [bottom, top];
    }
    const fullH = Math.abs(top - bottom);
    const inset = Math.min(0.5, fullH * 0.1);
    const h = Math.max(1, fullH - inset * 2);
    return { y: bottom + inset, h };
  }

  _niceStep(range, targetTicks) {
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

  _nearestGexLevel(price) {
    let best = null;
    let bestDist = Infinity;
    for (const l of this.gexLevels) {
      const d = Math.abs(l.strike - price);
      if (d < bestDist) { bestDist = d; best = l; }
    }
    return best;
  }

  _fmtGex(val) {
    const abs = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';
    return sign + abs.toFixed(0);
  }

  _render() {
    this.renderer.render(this.scene, this.camera);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this._render();
  }

  _onResize() {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    this.camera.right = this.width;
    this.camera.top = this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
    if (this.priceData.length) this.rebuild();
  }
}
