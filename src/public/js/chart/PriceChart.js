import { COLORS, LAYOUT } from './constants.js';
import { BaseSection } from './BaseSection.js';
import { bus } from './EventBus.js';

export class PriceChart extends BaseSection {
  constructor(container, viewport) {
    super(container, viewport);

    this._addGroup('grid');
    this._addGroup('candles');
    this._addGroup('dealerLevels');
    this._addGroup('overlays');

    this._labelsOverlay = null;
    this._initOverlays();
    this._setupInteraction();

    this._unsubs = [
      bus.on('viewport:change', () => this.rebuild()),
      bus.on('interaction:crosshair', (data) => this._onExternalCrosshair(data)),
    ];

    this.startAnimation();
  }

  _initOverlays() {
    this._labelsOverlay = document.createElement('div');
    this._labelsOverlay.className = 'labels-overlay';
    this.container.appendChild(this._labelsOverlay);

    this._crosshairH = document.createElement('div');
    this._crosshairH.className = 'crosshair-h';
    this.container.appendChild(this._crosshairH);

    this._crosshairV = document.createElement('div');
    this._crosshairV.className = 'crosshair-v';
    this.container.appendChild(this._crosshairV);

    this._crosshairPrice = document.createElement('div');
    this._crosshairPrice.className = 'crosshair-price';
    this.container.appendChild(this._crosshairPrice);
  }

  get _axisWidth() { return LAYOUT.priceAxisWidth; }

  sectionBounds() {
    const w = this.width;
    const candleW = w - this._axisWidth - LAYOUT.marginLeft;
    return {
      candle: { left: LAYOUT.marginLeft, right: LAYOUT.marginLeft + candleW, width: candleW },
      axis: { left: LAYOUT.marginLeft + candleW, right: w, width: this._axisWidth },
      top: this.height - this._marginTop(),
      bottom: this._marginBottom(),
      chartH: this._chartH(),
    };
  }

  idxToX(idx) {
    const s = this.sectionBounds();
    const vp = this.viewport;
    const visibleCount = vp.viewEndIdx - vp.viewStartIdx;
    if (visibleCount <= 0) return s.candle.left;
    const t = (idx - vp.viewStartIdx) / visibleCount;
    return s.candle.left + t * s.candle.width;
  }

  rebuild() {
    const vp = this.viewport;
    if (!vp.priceData.length) return;

    this._clearAllGroups();
    this._buildGrid();
    this._buildCandles();
    this._buildSeparator();
    this._buildPriceLine();
    this._buildDealerLevels();
    this._updateLabels();
    this.render();
  }

  rebuildPrice() {
    this._clearGroup(this.groups.grid);
    this._clearGroup(this.groups.candles);
    this._clearGroup(this.groups.overlays);
    this._buildGrid();
    this._buildCandles();
    this._buildSeparator();
    this._buildPriceLine();
    this._updateLabels();
    this.render();
  }

  rebuildOverlays() {
    this._clearGroup(this.groups.dealerLevels);
    this._clearGroup(this.groups.overlays);
    this._buildSeparator();
    this._buildPriceLine();
    this._buildDealerLevels();
    this._updateLabels();
    this.render();
  }

  _buildGrid() {
    const vp = this.viewport;
    const range = vp.viewPriceMax - vp.viewPriceMin;
    if (range <= 0) return;
    const step = vp.niceStep(range, 10);
    const startP = Math.ceil(vp.viewPriceMin / step) * step;

    for (let p = startP; p <= vp.viewPriceMax; p += step) {
      const y = this.priceToY(p);
      this.groups.grid.add(
        this.makeLine([[LAYOUT.marginLeft, y], [this.width, y]], COLORS.grid, 0.5)
      );
    }
  }

  _buildCandles() {
    const vp = this.viewport;
    const s = this.sectionBounds();
    const visibleCount = vp.viewEndIdx - vp.viewStartIdx;
    if (visibleCount <= 0) return;

    const candleW = (s.candle.width / visibleCount) * (1 - LAYOUT.candleGap);
    const wickW = Math.max(1, candleW * 0.1);

    const drawStart = Math.max(0, Math.floor(vp.viewStartIdx));
    const drawEnd = Math.min(vp.priceData.length, Math.ceil(vp.viewEndIdx));
    for (let i = drawStart; i < drawEnd; i++) {
      const c = vp.priceData[i];
      if (!c) continue;
      const x = this.idxToX(i + 0.5) - candleW / 2;
      const isUp = c.close >= c.open;
      const color = isUp ? COLORS.candleUp : COLORS.candleDown;

      const bodyLow = Math.min(c.open, c.close);
      const bodyHigh = Math.max(c.open, c.close);
      const yLow = this.priceToY(bodyLow);
      const yHigh = this.priceToY(bodyHigh);
      const bodyH = Math.max(yHigh - yLow, 1);
      this.groups.candles.add(this.makePlane(x, yLow, candleW, bodyH, color));

      const wickYLow = this.priceToY(c.low);
      const wickYHigh = this.priceToY(c.high);
      const wickX = this.idxToX(i + 0.5) - wickW / 2;
      this.groups.candles.add(
        this.makePlane(wickX, wickYLow, wickW, wickYHigh - wickYLow, color)
      );
    }
  }

  _buildPriceLine() {
    const vp = this.viewport;
    if (!vp.spotPrice) return;
    const y = this.priceToY(vp.spotPrice);
    const dashLen = 6;
    const gapLen = 4;
    for (let x = LAYOUT.marginLeft; x < this.width; x += dashLen + gapLen) {
      this.groups.overlays.add(
        this.makeLine(
          [[x, y], [Math.min(x + dashLen, this.width), y]],
          COLORS.priceLine, 0.8
        )
      );
    }
  }

  _buildDealerLevels() {
    const vp = this.viewport;
    const s = this.sectionBounds();
    if (!vp.gexLevels.length || !vp.spotPrice) return;

    let resistanceStrike = null, maxGex = 0;
    let supportStrike = null, minGex = 0;

    for (const level of vp.gexLevels) {
      if (level.strike > vp.spotPrice && level.netGex > maxGex) {
        maxGex = level.netGex;
        resistanceStrike = level.strike;
      } else if (level.strike < vp.spotPrice && level.netGex < minGex) {
        minGex = level.netGex;
        supportStrike = level.strike;
      }
    }

    const dashLen = 6;
    const gapLen = 4;
    const drawDottedLine = (price, color) => {
      const y = this.priceToY(price);
      if (y < s.bottom || y > s.top) return;
      for (let x = s.candle.left; x < s.candle.right; x += dashLen + gapLen) {
        this.groups.dealerLevels.add(
          this.makeLine(
            [[x, y], [Math.min(x + dashLen, s.candle.right), y]],
            color, 0.6
          )
        );
      }
    };

    if (resistanceStrike) drawDottedLine(resistanceStrike, COLORS.dealerResistance);
    if (supportStrike) drawDottedLine(supportStrike, COLORS.dealerSupport);
  }

  _buildSeparator() {
    const s = this.sectionBounds();
    // Opaque background behind axis to occlude candles during pan
    const bg = this.makePlane(s.axis.left, 0, s.axis.width, this.height, COLORS.bg);
    bg.position.z = 0.5;
    this.groups.overlays.add(bg);
    this.groups.overlays.add(
      this.makeLine(
        [[s.axis.left, 0], [s.axis.left, this.height]],
        COLORS.separator, 0.6
      )
    );
  }

  _updateLabels() {
    const vp = this.viewport;
    const overlay = this._labelsOverlay;
    overlay.innerHTML = '';
    const s = this.sectionBounds();

    const range = vp.viewPriceMax - vp.viewPriceMin;
    if (range <= 0) return;
    const step = vp.niceStep(range, 10);
    const startP = Math.ceil(vp.viewPriceMin / step) * step;

    for (let p = startP; p <= vp.viewPriceMax; p += step) {
      const y = this.height - this.priceToY(p);
      const lbl = document.createElement('div');
      lbl.className = 'price-label';
      lbl.style.top = y - 6 + 'px';
      lbl.style.left = s.axis.left + 4 + 'px';
      lbl.textContent = p.toFixed(p >= 1000 ? 0 : 2);
      overlay.appendChild(lbl);
    }

    if (vp.spotPrice) {
      const y = this.height - this.priceToY(vp.spotPrice);
      const tag = document.createElement('div');
      tag.className = 'current-price-tag';
      tag.style.top = y - 8 + 'px';
      tag.style.left = s.axis.left + 2 + 'px';
      tag.textContent = vp.spotPrice.toFixed(2);
      overlay.appendChild(tag);
    }

    const visCount = vp.viewEndIdx - vp.viewStartIdx;
    const labelEvery = Math.max(1, Math.floor(visCount / 10));
    const labelStart = Math.max(0, Math.floor(vp.viewStartIdx));
    const labelEnd = Math.min(vp.priceData.length, Math.ceil(vp.viewEndIdx));
    for (let i = labelStart; i < labelEnd; i += labelEvery) {
      const c = vp.priceData[i];
      if (!c) continue;
      const x = this.idxToX(i + 0.5);
      const lbl = document.createElement('div');
      lbl.className = 'date-label';
      lbl.style.left = x + 'px';
      const d = c.date;
      lbl.textContent = `${d.getMonth() + 1}/${d.getDate()}`;
      overlay.appendChild(lbl);
    }
  }

  // --- Interaction ---

  _setupInteraction() {
    const el = this.container;

    this._axisDrag = { active: false, startY: 0, startPriceMin: 0, startPriceMax: 0, anchorFrac: 0 };
    this._chartDrag = { active: false, startX: 0, startY: 0, startViewStart: 0, startViewEnd: 0, startPriceMin: 0, startPriceMax: 0 };
    this._xAxisDrag = { active: false, startX: 0, startViewStart: 0, startViewEnd: 0, anchorFrac: 0 };

    el.addEventListener('mousedown', (e) => {
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const s = this.sectionBounds();
      const vp = this.viewport;
      const inXAxis = my > (this.height - this._marginBottom()) && mx >= s.candle.left && mx <= s.candle.right;

      if (inXAxis) {
        e.preventDefault();
        this._xAxisDrag.active = true;
        this._xAxisDrag.startX = e.clientX;
        this._xAxisDrag.startViewStart = vp.viewStartIdx;
        this._xAxisDrag.startViewEnd = vp.viewEndIdx;
        this._xAxisDrag.anchorFrac = (mx - s.candle.left) / s.candle.width;
        el.style.cursor = 'ew-resize';
      } else if (mx >= s.axis.left && mx <= s.axis.right) {
        e.preventDefault();
        this._axisDrag.active = true;
        this._axisDrag.startY = e.clientY;
        this._axisDrag.startPriceMin = vp.viewPriceMin;
        this._axisDrag.startPriceMax = vp.viewPriceMax;
        this._axisDrag.anchorFrac = 1 - (my / this.height);
        vp._manualYScale = true;
        el.style.cursor = 'ns-resize';
      } else if (mx >= s.candle.left && mx <= s.candle.right) {
        e.preventDefault();
        this._chartDrag.active = true;
        this._chartDrag.startX = e.clientX;
        this._chartDrag.startY = e.clientY;
        this._chartDrag.startViewStart = vp.viewStartIdx;
        this._chartDrag.startViewEnd = vp.viewEndIdx;
        this._chartDrag.startPriceMin = vp.viewPriceMin;
        this._chartDrag.startPriceMax = vp.viewPriceMax;
        vp._manualYScale = true;
        el.style.cursor = 'grabbing';
      }
    });

    this._onMouseMove = (e) => this._handleMouseMove(e);
    this._onMouseUp = () => this._handleMouseUp();
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);

    el.addEventListener('dblclick', (e) => {
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const s = this.sectionBounds();
      const vp = this.viewport;
      if (mx >= s.axis.left && mx <= s.axis.right) {
        vp._manualYScale = false;
        vp._autoFitY();
        bus.emit('viewport:change');
      } else if (mx >= s.candle.left && mx <= s.candle.right) {
        vp._manualYScale = false;
        vp.viewStartIdx = 0;
        vp.viewEndIdx = vp.priceData.length;
        vp._autoFitY();
        bus.emit('viewport:change');
      }
    });

    el.addEventListener('mouseleave', () => {
      if (!this._axisDrag.active && !this._chartDrag.active && !this._xAxisDrag.active) {
        this._hideCrosshair();
        bus.emit('interaction:crosshair', null);
      }
    });

    el.addEventListener('wheel', (e) => {
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const s = this.sectionBounds();
      const inCandle = mx >= s.candle.left && mx <= s.candle.right && my <= (this.height - this._marginBottom());
      if (!inCandle) return;

      e.preventDefault();
      const vp = this.viewport;
      const zoomFactor = Math.pow(1.03, e.deltaY > 0 ? 1 : -1);

      const anchorFrac = (mx - s.candle.left) / s.candle.width;
      const visCount = vp.viewEndIdx - vp.viewStartIdx;
      const anchorIdx = vp.viewStartIdx + anchorFrac * visCount;
      const newCount = Math.max(5, visCount * zoomFactor);
      vp.viewStartIdx = anchorIdx - anchorFrac * newCount;
      vp.viewEndIdx = anchorIdx + (1 - anchorFrac) * newCount;

      const priceFrac = 1 - (my - (this.height - this.sectionBounds().top)) / this._chartH();
      const priceRange = vp.viewPriceMax - vp.viewPriceMin;
      const anchorPrice = vp.viewPriceMin + priceFrac * priceRange;
      const newRange = Math.max(0.01, priceRange * zoomFactor);
      vp.viewPriceMin = anchorPrice - priceFrac * newRange;
      vp.viewPriceMax = anchorPrice + (1 - priceFrac) * newRange;
      vp._manualYScale = true;

      bus.emit('viewport:change');
    }, { passive: false });
  }

  _handleMouseMove(e) {
    const vp = this.viewport;
    const el = this.container;

    if (this._axisDrag.active) {
      const dy = e.clientY - this._axisDrag.startY;
      const origRange = this._axisDrag.startPriceMax - this._axisDrag.startPriceMin;
      const zoomFactor = Math.pow(2, dy / (this._chartH() * 0.5));
      const newRange = Math.max(1, origRange * zoomFactor);
      const anchorPrice = this._axisDrag.startPriceMin + this._axisDrag.anchorFrac * origRange;
      vp.viewPriceMin = anchorPrice - this._axisDrag.anchorFrac * newRange;
      vp.viewPriceMax = anchorPrice + (1 - this._axisDrag.anchorFrac) * newRange;
      bus.emit('viewport:change');
      return;
    }

    if (this._chartDrag.active) {
      const s = this.sectionBounds();
      const dx = e.clientX - this._chartDrag.startX;
      const dy = e.clientY - this._chartDrag.startY;
      const visCount = this._chartDrag.startViewEnd - this._chartDrag.startViewStart;

      const idxShift = -(dx / s.candle.width) * visCount;
      vp.viewStartIdx = this._chartDrag.startViewStart + idxShift;
      vp.viewEndIdx = this._chartDrag.startViewEnd + idxShift;

      const priceRange = this._chartDrag.startPriceMax - this._chartDrag.startPriceMin;
      const priceShift = (dy / s.chartH) * priceRange;
      vp.viewPriceMin = this._chartDrag.startPriceMin + priceShift;
      vp.viewPriceMax = this._chartDrag.startPriceMax + priceShift;

      bus.emit('viewport:change');
      return;
    }

    if (this._xAxisDrag.active) {
      const s = this.sectionBounds();
      const dx = e.clientX - this._xAxisDrag.startX;
      const origCount = this._xAxisDrag.startViewEnd - this._xAxisDrag.startViewStart;
      const anchorIdx = this._xAxisDrag.startViewStart + this._xAxisDrag.anchorFrac * origCount;
      const zoomFactor = Math.pow(2, dx / (s.candle.width * 0.5));
      const newCount = Math.max(5, origCount * zoomFactor);
      vp.viewStartIdx = anchorIdx - this._xAxisDrag.anchorFrac * newCount;
      vp.viewEndIdx = anchorIdx + (1 - this._xAxisDrag.anchorFrac) * newCount;
      bus.emit('viewport:change');
      return;
    }

    // Crosshair
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (mx >= 0 && mx <= this.width && my >= 0 && my <= this.height) {
      const s = this.sectionBounds();
      const inXAxis = my > (this.height - this._marginBottom()) && mx >= s.candle.left && mx <= s.candle.right;
      if (inXAxis) {
        el.style.cursor = 'ew-resize';
      } else if (mx >= s.axis.left && mx <= s.axis.right) {
        el.style.cursor = 'ns-resize';
      } else if (mx >= s.candle.left && mx <= s.candle.right) {
        el.style.cursor = 'grab';
      } else {
        el.style.cursor = '';
      }

      this._crosshairH.style.display = 'block';
      this._crosshairV.style.display = 'block';
      this._crosshairH.style.top = my + 'px';
      this._crosshairV.style.left = mx + 'px';

      const price = this.yToPrice(this.height - my);
      this._crosshairPrice.style.display = 'block';
      this._crosshairPrice.style.top = my + 'px';
      this._crosshairPrice.style.left = s.axis.left + 2 + 'px';
      this._crosshairPrice.textContent = price.toFixed(price >= 1000 ? 0 : 2);

      bus.emit('interaction:crosshair', { price, mx, my, source: 'price' });
    }
  }

  _onExternalCrosshair(data) {
    if (!data) {
      this._hideCrosshair();
      return;
    }
    if (data.source === 'price') return;

    const my = this.height - this.priceToY(data.price);
    const s = this.sectionBounds();

    this._crosshairH.style.display = 'block';
    this._crosshairH.style.top = my + 'px';
    this._crosshairV.style.display = 'none';

    this._crosshairPrice.style.display = 'block';
    this._crosshairPrice.style.top = my + 'px';
    this._crosshairPrice.style.left = s.axis.left + 2 + 'px';
    this._crosshairPrice.textContent = data.price.toFixed(data.price >= 1000 ? 0 : 2);
  }

  _hideCrosshair() {
    this._crosshairH.style.display = 'none';
    this._crosshairV.style.display = 'none';
    this._crosshairPrice.style.display = 'none';
  }

  _handleMouseUp() {
    const el = this.container;
    if (this._axisDrag.active) {
      this._axisDrag.active = false;
      el.style.cursor = '';
    }
    if (this._chartDrag.active) {
      this._chartDrag.active = false;
      el.style.cursor = '';
    }
    if (this._xAxisDrag.active) {
      this._xAxisDrag.active = false;
      el.style.cursor = '';
    }
  }

  dispose() {
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    for (const unsub of this._unsubs) unsub();
    super.dispose();
  }
}
