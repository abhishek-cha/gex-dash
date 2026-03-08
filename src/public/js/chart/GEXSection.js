import * as THREE from 'three';
import { COLORS } from './constants.js';
import { BaseSection } from './BaseSection.js';
import { bus } from './EventBus.js';

function hexCss(c) {
  return '#' + c.toString(16).padStart(6, '0');
}

export class GEXSection extends BaseSection {
  constructor(container, viewport) {
    super(container, viewport);

    this._addGroup('gexBars');
    this._highlightGroup = new THREE.Group();
    this.scene.add(this._highlightGroup);
    this._highlightedStrike = null;

    this._labelsOverlay = null;
    this._tooltip = null;
    this._initOverlays();

    this._setupInteraction();

    this._unsubs = [
      bus.on('viewport:change', () => this.rebuild()),
      bus.on('interaction:crosshair', (data) => this._onCrosshair(data)),
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

    this._tooltip = document.createElement('div');
    this._tooltip.className = 'tooltip';
    this.container.appendChild(this._tooltip);
  }

  rebuild() {
    this._clearAllGroups();
    this._highlightedStrike = null;
    this._clearHighlightGroup();
    this._buildGEXBars();
    this._buildSeparator();
    this._updateLabels();
    this.render();
  }

  _buildGEXBars() {
    const vp = this.viewport;
    if (!vp.gexLevels.length) return;

    const maxCallGex = Math.max(...vp.gexLevels.map(l => Math.abs(l.callGex)), 1);
    const maxPutGex = Math.max(...vp.gexLevels.map(l => Math.abs(l.putGex)), 1);
    const maxGex = Math.max(maxCallGex, maxPutGex);
    const halfW = this.width / 2;
    const centerX = halfW;

    const strikes = vp.gexLevels.map(l => l.strike).sort((a, b) => a - b);

    for (const level of vp.gexLevels) {
      const py = this.priceToY(level.strike);
      if (py < this._marginBottom() || py > this.height - this._marginTop()) continue;
      const { y: barY, h: barH } = this._gexBarBounds(level.strike, strikes);

      if (level.callGex > 0) {
        const w = (level.callGex / maxGex) * halfW;
        this.groups.gexBars.add(
          this.makePlane(centerX, barY, w, barH, COLORS.callGex, 0.85)
        );
      }

      if (level.putGex < 0) {
        const w = (Math.abs(level.putGex) / maxGex) * halfW;
        this.groups.gexBars.add(
          this.makePlane(centerX - w, barY, w, barH, COLORS.putGex, 0.85)
        );
      }
    }
  }

  _buildSeparator() {
    // Left edge separator
    this.groups.gexBars.add(
      this.makeLine([[0, 0], [0, this.height]], COLORS.separator, 0.6)
    );
  }

  _gexBarBounds(strike, sortedStrikes) {
    const idx = sortedStrikes.indexOf(strike);
    const y = this.priceToY(strike);
    let top, bottom;
    if (sortedStrikes.length < 2) return { y, h: 4 };
    if (idx <= 0) {
      const nextY = this.priceToY(sortedStrikes[1]);
      const halfGap = Math.abs(y - nextY) / 2;
      top = y + halfGap;
      bottom = y - halfGap;
    } else if (idx >= sortedStrikes.length - 1) {
      const prevY = this.priceToY(sortedStrikes[idx - 1]);
      const halfGap = Math.abs(y - prevY) / 2;
      top = y + halfGap;
      bottom = y - halfGap;
    } else {
      const prevY = this.priceToY(sortedStrikes[idx - 1]);
      const nextY = this.priceToY(sortedStrikes[idx + 1]);
      top = (y + prevY) / 2;
      bottom = (y + nextY) / 2;
      if (top < bottom) [top, bottom] = [bottom, top];
    }
    const fullH = Math.abs(top - bottom);
    const inset = Math.min(0.5, fullH * 0.1);
    const h = Math.max(1, fullH - inset * 2);
    return { y: bottom + inset, h };
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
      this._tooltip.innerHTML =
        `<div>Strike: ${nearest.strike}</div>` +
        `<div style="color:${hexCss(COLORS.callGex)}">Call GEX: ${vp.fmtGex(nearest.callGex)}</div>` +
        `<div style="color:${hexCss(COLORS.putGex)}">Put GEX: ${vp.fmtGex(nearest.putGex)}</div>` +
        `<div style="color:${hexCss(COLORS.netGex)}">Net GEX: ${vp.fmtGex(nearest.netGex)}</div>` +
        `<div style="color:${hexCss(COLORS.volume)}">Volume: ${vp.fmtVol(nearest.totalVolume)}</div>` +
        `<div>OI: ${vp.fmtVol(nearest.totalOI)}</div>`;
    } else {
      this.clearHighlight();
      this._tooltip.style.display = 'none';
    }
  }

  highlightStrike(level) {
    if (!level || this._highlightedStrike === level.strike) return;
    this._highlightedStrike = level.strike;
    this._clearHighlightGroup();

    const vp = this.viewport;
    const py = this.priceToY(level.strike);
    if (py < this._marginBottom() || py > this.height - this._marginTop()) return;

    const strikes = vp.gexLevels.map(l => l.strike).sort((a, b) => a - b);
    const { y: barY, h: barH } = this._gexBarBounds(level.strike, strikes);
    const glowPad = Math.max(2, barH * 0.3);
    const glowY = barY - glowPad / 2;
    const glowH = barH + glowPad;

    const maxCallGex = Math.max(...vp.gexLevels.map(l => Math.abs(l.callGex)), 1);
    const maxPutGex = Math.max(...vp.gexLevels.map(l => Math.abs(l.putGex)), 1);
    const maxGex = Math.max(maxCallGex, maxPutGex);
    const halfW = this.width / 2;
    const centerX = halfW;

    if (level.callGex > 0) {
      const w = (level.callGex / maxGex) * halfW + glowPad;
      this._highlightGroup.add(
        this.makePlane(centerX, glowY, w, glowH, COLORS.callGex, 0.25)
      );
    }
    if (level.putGex < 0) {
      const w = (Math.abs(level.putGex) / maxGex) * halfW + glowPad;
      this._highlightGroup.add(
        this.makePlane(centerX - w, glowY, w, glowH, COLORS.putGex, 0.25)
      );
    }
  }

  clearHighlight() {
    if (this._highlightedStrike === null) return;
    this._highlightedStrike = null;
    this._clearHighlightGroup();
  }

  _clearHighlightGroup() {
    while (this._highlightGroup.children.length) {
      const c = this._highlightGroup.children[0];
      this._highlightGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
  }

  _updateLabels() {
    const vp = this.viewport;
    const overlay = this._labelsOverlay;
    overlay.innerHTML = '';

    const gexLabel = document.createElement('div');
    gexLabel.className = 'section-label';
    gexLabel.style.left = '8px';
    gexLabel.textContent = 'CALL / PUT GEX';
    overlay.appendChild(gexLabel);

    if (vp.gexLevels.length > 0) {
      this._addGexScale(overlay);
    }
  }

  _addGexScale(overlay) {
    const vp = this.viewport;
    const maxCallGex = Math.max(...vp.gexLevels.map(l => Math.abs(l.callGex)), 1);
    const maxPutGex = Math.max(...vp.gexLevels.map(l => Math.abs(l.putGex)), 1);
    const maxGex = Math.max(maxCallGex, maxPutGex);
    const halfW = this.width / 2;
    const centerX = halfW;
    const ticks = 3;
    const scaleStep = vp.niceStep(maxGex, ticks);

    const zeroLbl = document.createElement('div');
    zeroLbl.className = 'gex-scale-label';
    zeroLbl.style.left = centerX + 'px';
    zeroLbl.textContent = '0';
    overlay.appendChild(zeroLbl);

    for (let v = scaleStep; v <= maxGex * 1.05; v += scaleStep) {
      const frac = v / maxGex;
      if (frac > 1.05) break;

      const rx = centerX + frac * halfW;
      if (rx < this.width - 5) {
        const rl = document.createElement('div');
        rl.className = 'gex-scale-label';
        rl.style.left = rx + 'px';
        rl.style.color = hexCss(COLORS.callGex);
        rl.textContent = vp.fmtGex(v);
        overlay.appendChild(rl);
      }

      const lx = centerX - frac * halfW;
      if (lx > 5) {
        const ll = document.createElement('div');
        ll.className = 'gex-scale-label';
        ll.style.left = lx + 'px';
        ll.style.color = hexCss(COLORS.putGex);
        ll.textContent = vp.fmtGex(v);
        overlay.appendChild(ll);
      }
    }
  }

  dispose() {
    for (const unsub of this._unsubs) unsub();
    super.dispose();
  }
}
