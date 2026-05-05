import * as THREE from 'three';
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

    const upBodies = [], downBodies = [], upWicks = [], downWicks = [];

    const drawStart = Math.max(0, Math.floor(vp.viewStartIdx));
    const drawEnd = Math.min(vp.priceData.length, Math.ceil(vp.viewEndIdx));
    for (let i = drawStart; i < drawEnd; i++) {
      const c = vp.priceData[i];
      if (!c) continue;
      const x = this.idxToX(i + 0.5) - candleW / 2;
      const isUp = c.close >= c.open;

      const bodyLow = Math.min(c.open, c.close);
      const bodyHigh = Math.max(c.open, c.close);
      const yLow = this.priceToY(bodyLow);
      const yHigh = this.priceToY(bodyHigh);
      const bodyH = Math.max(yHigh - yLow, 1);
      (isUp ? upBodies : downBodies).push({ x, y: yLow, w: candleW, h: bodyH });

      const wickYLow = this.priceToY(c.low);
      const wickYHigh = this.priceToY(c.high);
      const wickX = this.idxToX(i + 0.5) - wickW / 2;
      (isUp ? upWicks : downWicks).push({ x: wickX, y: wickYLow, w: wickW, h: wickYHigh - wickYLow });
    }

    for (const [rects, color] of [[upBodies, COLORS.candleUp], [downBodies, COLORS.candleDown], [upWicks, COLORS.candleUp], [downWicks, COLORS.candleDown]]) {
      const mesh = this.batchPlanes(rects, color);
      if (mesh) this.groups.candles.add(mesh);
    }
  }

  _buildPriceLine() {
    const vp = this.viewport;
    if (!vp.spotPrice) return;
    const y = this.priceToY(vp.spotPrice);
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(LAYOUT.marginLeft, y, 0),
      new THREE.Vector3(this.width, y, 0),
    ]);
    const mat = new THREE.LineDashedMaterial({
      color: COLORS.priceLine,
      dashSize: 6,
      gapSize: 4,
      opacity: 0.8,
      transparent: true,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    this.groups.overlays.add(line);
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

    const drawDashedLine = (price, color) => {
      const y = this.priceToY(price);
      if (y < s.bottom || y > s.top) return;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(s.candle.left, y, 0),
        new THREE.Vector3(s.candle.right, y, 0),
      ]);
      const mat = new THREE.LineDashedMaterial({
        color,
        dashSize: 6,
        gapSize: 4,
        opacity: 0.6,
        transparent: true,
      });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      this.groups.dealerLevels.add(line);
    };

    if (resistanceStrike) drawDashedLine(resistanceStrike, COLORS.dealerResistance);
    if (supportStrike) drawDashedLine(supportStrike, COLORS.dealerSupport);
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
    const frag = document.createDocumentFragment();
    const s = this.sectionBounds();

    const range = vp.viewPriceMax - vp.viewPriceMin;
    if (range > 0) {
      const step = vp.niceStep(range, 10);
      const startP = Math.ceil(vp.viewPriceMin / step) * step;

      for (let p = startP; p <= vp.viewPriceMax; p += step) {
        const y = this.height - this.priceToY(p);
        const lbl = document.createElement('div');
        lbl.className = 'price-label';
        lbl.style.top = y - 6 + 'px';
        lbl.style.left = s.axis.left + 4 + 'px';
        lbl.textContent = p.toFixed(p >= 1000 ? 0 : 2);
        frag.appendChild(lbl);
      }
    }

    if (vp.spotPrice) {
      const y = this.height - this.priceToY(vp.spotPrice);
      const tag = document.createElement('div');
      tag.className = 'current-price-tag';
      tag.style.top = y - 8 + 'px';
      tag.style.left = s.axis.left + 2 + 'px';
      tag.textContent = vp.spotPrice.toFixed(2);
      frag.appendChild(tag);
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
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      lbl.textContent = `${months[d.getMonth()]} ${d.getDate()}`;
      frag.appendChild(lbl);
    }

    overlay.innerHTML = '';
    overlay.appendChild(frag);
  }

  // --- Interaction ---

  _setupInteraction() {
    const el = this.container;

    this._axisDrag = { active: false, startY: 0, startPriceMin: 0, startPriceMax: 0, anchorFrac: 0 };
    this._chartDrag = { active: false, startX: 0, startY: 0, startViewStart: 0, startViewEnd: 0, startPriceMin: 0, startPriceMax: 0 };
    this._xAxisDrag = { active: false, startX: 0, startViewStart: 0, startViewEnd: 0, anchorFrac: 0 };

    // Gesture state
    this._pointers = new Map(); // pointerId -> {x, y}
    this._longPressTimer = null;
    this._longPressCrosshair = false;
    this._lastTapTime = 0;
    this._lastTapX = 0;
    this._lastTapY = 0;
    this._pinchStartDist = 0;
    this._pinchStartViewStart = 0;
    this._pinchStartViewEnd = 0;
    this._pinchAnchorFrac = 0;
    this._pointerDownPos = { x: 0, y: 0 };

    el.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    el.addEventListener('pointermove', (e) => this._onPointerMove(e));
    el.addEventListener('pointerup', (e) => this._onPointerUp(e));
    el.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    el.addEventListener('pointerleave', (e) => this._onPointerLeave(e));

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

  _onPointerDown(e) {
    const el = this.container;
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture(e.pointerId);

    // Two-finger pinch start
    if (this._pointers.size === 2) {
      this._cancelLongPress();
      this._axisDrag.active = false;
      this._chartDrag.active = false;
      this._xAxisDrag.active = false;
      this._longPressCrosshair = false;
      this._startPinch();
      return;
    }

    // Single pointer down
    if (this._pointers.size === 1) {
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      this._pointerDownPos = { x: e.clientX, y: e.clientY };

      // Double-tap detection
      const now = performance.now();
      const dt = now - this._lastTapTime;
      const dx = Math.abs(mx - this._lastTapX);
      const dy = Math.abs(my - this._lastTapY);
      if (dt < 300 && dx < 20 && dy < 20) {
        this._cancelLongPress();
        this._handleDoubleTap(mx);
        this._lastTapTime = 0;
        return;
      }
      this._lastTapTime = now;
      this._lastTapX = mx;
      this._lastTapY = my;

      // Start long-press timer for touch crosshair
      this._cancelLongPress();
      this._longPressTimer = setTimeout(() => {
        this._longPressTimer = null;
        // Only activate if pointer hasn't moved much and no drag is active
        if (!this._axisDrag.active && !this._chartDrag.active && !this._xAxisDrag.active) {
          this._longPressCrosshair = true;
          const rect2 = el.getBoundingClientRect();
          const ptr = this._pointers.values().next().value;
          if (ptr) {
            this._showCrosshairAt(ptr.x - rect2.left, ptr.y - rect2.top);
          }
        }
      }, 500);

      // Start drag regions (same logic as old mousedown)
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
    }
  }

  _onPointerMove(e) {
    const el = this.container;

    // Update pointer position
    if (this._pointers.has(e.pointerId)) {
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Cancel long-press if pointer moved too far
    if (this._longPressTimer) {
      const dx = e.clientX - this._pointerDownPos.x;
      const dy = e.clientY - this._pointerDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 10) {
        this._cancelLongPress();
      }
    }

    // Pinch zoom (2 pointers)
    if (this._pointers.size === 2 && this._pinchStartDist > 0) {
      this._handlePinch();
      return;
    }

    // Long-press crosshair mode: update crosshair position
    if (this._longPressCrosshair && this._pointers.size === 1) {
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this._showCrosshairAt(mx, my);
      return;
    }

    // Single pointer drag or hover
    if (this._pointers.size <= 1) {
      this._handleDragMove(e);
    }
  }

  _onPointerUp(e) {
    const el = this.container;
    this._pointers.delete(e.pointerId);

    try { el.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }

    this._cancelLongPress();

    // If we were pinching and now have < 2 pointers, end pinch
    if (this._pinchStartDist > 0 && this._pointers.size < 2) {
      this._pinchStartDist = 0;
    }

    // End long-press crosshair on lift
    if (this._longPressCrosshair && this._pointers.size === 0) {
      this._longPressCrosshair = false;
      this._hideCrosshair();
      bus.emit('interaction:crosshair', null);
    }

    // End drags when all pointers are up
    if (this._pointers.size === 0) {
      this._handleDragEnd();
    }
  }

  _onPointerLeave(e) {
    // Only hide crosshair if no active drags and no captured pointers
    if (!this._axisDrag.active && !this._chartDrag.active && !this._xAxisDrag.active && !this._longPressCrosshair && this._pointers.size === 0) {
      this._hideCrosshair();
      bus.emit('interaction:crosshair', null);
    }
  }

  _startPinch() {
    const pts = [...this._pointers.values()];
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    this._pinchStartDist = Math.sqrt(dx * dx + dy * dy);

    const vp = this.viewport;
    this._pinchStartViewStart = vp.viewStartIdx;
    this._pinchStartViewEnd = vp.viewEndIdx;

    // Anchor at midpoint of two fingers
    const el = this.container;
    const rect = el.getBoundingClientRect();
    const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
    const s = this.sectionBounds();
    this._pinchAnchorFrac = (midX - s.candle.left) / s.candle.width;
  }

  _handlePinch() {
    const pts = [...this._pointers.values()];
    if (pts.length < 2) return;

    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (this._pinchStartDist === 0) return;

    const scale = this._pinchStartDist / dist; // >1 means zoom out, <1 means zoom in
    const origCount = this._pinchStartViewEnd - this._pinchStartViewStart;
    const newCount = Math.max(5, origCount * scale);

    const vp = this.viewport;
    const anchorIdx = this._pinchStartViewStart + this._pinchAnchorFrac * origCount;
    vp.viewStartIdx = anchorIdx - this._pinchAnchorFrac * newCount;
    vp.viewEndIdx = anchorIdx + (1 - this._pinchAnchorFrac) * newCount;

    bus.emit('viewport:change');
  }

  _handleDoubleTap(mx) {
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
  }

  _cancelLongPress() {
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  }

  _showCrosshairAt(mx, my) {
    const s = this.sectionBounds();

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

  _handleHoverCrosshair(e) {
    const el = this.container;
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

      this._showCrosshairAt(mx, my);
    }
  }

  _handleDragMove(e) {
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

    // Hover crosshair (no button pressed, no active drag)
    this._handleHoverCrosshair(e);
  }

  _handleDragEnd() {
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

  dispose() {
    this._cancelLongPress();
    for (const unsub of this._unsubs) unsub();
    super.dispose();
  }
}
