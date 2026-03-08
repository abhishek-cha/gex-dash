import * as THREE from 'three';
import { COLORS } from './constants.js';
import { BaseSection } from './BaseSection.js';
import { bus } from './EventBus.js';

export class VolumeSection extends BaseSection {
  constructor(container, viewport) {
    super(container, viewport);

    this._addGroup('volumeBars');
    this._initHighlightGroup();

    this._labelsOverlay = null;
    this._initOverlays();

    this._setupInteraction();

    this._unsubs = [
      bus.on('viewport:change', () => this.rebuild()),
      bus.on('interaction:crosshair', (data) => this._onCrosshair(data)),
    ];

  }

  _setupInteraction() {
    this.container.addEventListener('mousemove', (e) => {
      const rect = this.container.getBoundingClientRect();
      const my = e.clientY - rect.top;
      const price = this.yToPrice(this.height - my);
      bus.emit('interaction:crosshair', { price, source: 'volume' });
    });
    this.container.addEventListener('mouseleave', () => {
      bus.emit('interaction:crosshair', null);
    });
  }

  _initOverlays() {
    this._labelsOverlay = document.createElement('div');
    this._labelsOverlay.className = 'labels-overlay';
    this.container.appendChild(this._labelsOverlay);

    this._crosshairH = document.createElement('div');
    this._crosshairH.className = 'crosshair-h';
    this.container.appendChild(this._crosshairH);
  }

  rebuild() {
    this._clearAllGroups();
    this._highlightedStrike = null;
    this._clearHighlightGroup();
    this._buildVolumeBars();
    this._buildSeparator();
    this._updateLabels();
    this.render();
  }

  _computeMaxVol() {
    let maxVol = 1;
    for (const l of this.viewport.gexLevels) {
      if (l.totalVolume > maxVol) maxVol = l.totalVolume;
    }
    return maxVol;
  }

  _buildVolumeBars() {
    const vp = this.viewport;
    if (!vp.gexLevels.length) return;

    const maxVol = this._computeMaxVol();
    const strikes = vp.gexLevels.map(l => l.strike).sort((a, b) => a - b);
    const strikeIndex = new Map();
    for (let i = 0; i < strikes.length; i++) strikeIndex.set(strikes[i], i);

    for (const level of vp.gexLevels) {
      if (!level.totalVolume) continue;
      const py = this.priceToY(level.strike);
      if (py < this._marginBottom() || py > this.height - this._marginTop()) continue;
      const idx = strikeIndex.get(level.strike);
      const { y: barY, h: barH } = this._gexBarBounds(level.strike, strikes, idx);

      const w = (level.totalVolume / maxVol) * this.width * 0.9;
      this.groups.volumeBars.add(
        this.makePlane(2, barY, w, barH, COLORS.volume, 0.85)
      );

      if (level.totalVolume > 0 && level.totalOI > 0 && level.totalVolume > level.totalOI) {
        const r = Math.max(2, Math.min(barH * 0.3, 4));
        const geo = new THREE.CircleGeometry(r, 16);
        const mat = new THREE.MeshBasicMaterial({ color: COLORS.volumeAlert });
        const dot = new THREE.Mesh(geo, mat);
        dot.position.set(2 + w + r + 2, barY + barH / 2, 0);
        this.groups.volumeBars.add(dot);
      }
    }
  }

  _buildSeparator() {
    this.groups.volumeBars.add(
      this.makeLine([[0, 0], [0, this.height]], COLORS.separator, 0.6)
    );
  }

  _onCrosshair(data) {
    if (!data) {
      this._clearHighlightIfNeeded();
      this._crosshairH.style.display = 'none';
      return;
    }

    const myY = this.height - this.priceToY(data.price);
    this._crosshairH.style.display = 'block';
    this._crosshairH.style.top = myY + 'px';

    const vp = this.viewport;
    const nearest = vp.nearestGexLevel(data.price);
    if (nearest) {
      this._highlightVolume(nearest);
    } else {
      this._clearHighlightIfNeeded();
    }
  }

  _highlightVolume(level) {
    if (!level || this._highlightedStrike === level.strike) return;
    this._highlightedStrike = level.strike;
    this._clearHighlightGroup();

    const vp = this.viewport;
    if (!level.totalVolume) return;

    const strikes = vp.gexLevels.map(l => l.strike).sort((a, b) => a - b);
    const idx = strikes.indexOf(level.strike);
    const { y: barY, h: barH } = this._gexBarBounds(level.strike, strikes, idx);
    const glowPad = Math.max(2, barH * 0.3);
    const glowY = barY - glowPad / 2;
    const glowH = barH + glowPad;

    const maxVol = this._computeMaxVol();
    const w = (level.totalVolume / maxVol) * this.width * 0.9 + glowPad;
    this._highlightGroup.add(
      this.makePlane(2 - glowPad / 2, glowY, w, glowH, COLORS.volume, 0.25)
    );
    this.render();
  }

  _clearHighlightIfNeeded() {
    if (this._highlightedStrike === null) return;
    this._highlightedStrike = null;
    this._clearHighlightGroup();
    this.render();
  }

  _updateLabels() {
    const vp = this.viewport;
    const overlay = this._labelsOverlay;
    const frag = document.createDocumentFragment();

    const volLabel = document.createElement('div');
    volLabel.className = 'section-label';
    volLabel.style.left = '4px';
    volLabel.textContent = 'VOLUME';
    frag.appendChild(volLabel);

    if (vp.gexLevels.length > 0) {
      this._addVolumeScale(frag);
    }

    overlay.innerHTML = '';
    overlay.appendChild(frag);
  }

  _addVolumeScale(frag) {
    const vp = this.viewport;
    const maxVol = this._computeMaxVol();
    const ticks = 2;
    const scaleStep = vp.niceStep(maxVol, ticks);
    const usableW = this.width * 0.9;

    const zLbl = document.createElement('div');
    zLbl.className = 'gex-scale-label';
    zLbl.style.left = '2px';
    zLbl.style.transform = 'none';
    zLbl.textContent = '0';
    frag.appendChild(zLbl);

    for (let v = scaleStep; v <= maxVol * 1.05; v += scaleStep) {
      const frac = v / maxVol;
      if (frac > 1.05) break;
      const x = 2 + frac * usableW;
      if (x < this.width - 10) {
        const lbl = document.createElement('div');
        lbl.className = 'gex-scale-label';
        lbl.style.left = x + 'px';
        lbl.textContent = vp.fmtVol(v);
        frag.appendChild(lbl);
      }
    }
  }

  dispose() {
    for (const unsub of this._unsubs) unsub();
    super.dispose();
  }
}
