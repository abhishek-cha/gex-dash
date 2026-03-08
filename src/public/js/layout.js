import { ViewportModel } from './chart/ViewportModel.js';
import { PriceChart } from './chart/PriceChart.js';
import { GEXSection } from './chart/GEXSection.js';
import { VolumeSection } from './chart/VolumeSection.js';

export class LayoutManager {
  constructor(containerEl) {
    this.container = containerEl;
    this.viewport = new ViewportModel();

    this.sections = {};
    this._sectionOrder = ['price', 'gex', 'volume'];
    this._visible = new Set(['price', 'gex', 'volume']);
    this._handles = [];
    this._drag = null;
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
  }

  init() {
    this.container.innerHTML = '';
    this.container.classList.add('chart-layout');

    for (let i = 0; i < this._sectionOrder.length; i++) {
      const key = this._sectionOrder[i];

      // Insert resize handle before each section except the first
      if (i > 0) {
        const handle = document.createElement('div');
        handle.className = 'section-resize-handle';
        handle.dataset.left = this._sectionOrder[i - 1];
        handle.dataset.right = key;
        this.container.appendChild(handle);
        this._handles.push(handle);
      }

      const wrap = document.createElement('div');
      wrap.className = `section-wrap section-${key}`;
      wrap.dataset.section = key;
      this.container.appendChild(wrap);

      if (key === 'price') {
        const loadPrice = document.createElement('div');
        loadPrice.id = 'loading-price';
        loadPrice.className = 'section-loading';
        wrap.appendChild(loadPrice);
      }

      if (key === 'gex') {
        const loadGex = document.createElement('div');
        loadGex.id = 'loading-gex';
        loadGex.className = 'section-loading';
        wrap.appendChild(loadGex);
      }

      if (key === 'volume') {
        const loadVol = document.createElement('div');
        loadVol.id = 'loading-volume';
        loadVol.className = 'section-loading';
        wrap.appendChild(loadVol);
      }
    }

    this._setupHandleDrag();
    this._createSections();
    this._applyVisibility();
  }

  _createSections() {
    const priceWrap = this.container.querySelector('.section-price');
    const gexWrap = this.container.querySelector('.section-gex');
    const volWrap = this.container.querySelector('.section-volume');

    this.sections.price = new PriceChart(priceWrap, this.viewport);
    this.sections.gex = new GEXSection(gexWrap, this.viewport);
    this.sections.volume = new VolumeSection(volWrap, this.viewport);
  }

  _applyVisibility() {
    for (const key of this._sectionOrder) {
      const wrap = this.container.querySelector(`.section-${key}`);
      wrap.style.display = this._visible.has(key) ? '' : 'none';
    }
    // Hide/show handles based on adjacent section visibility
    for (const handle of this._handles) {
      const leftVis = this._visible.has(handle.dataset.left);
      const rightVis = this._visible.has(handle.dataset.right);
      handle.style.display = (leftVis && rightVis) ? '' : 'none';
    }
  }

  _setupHandleDrag() {
    for (const handle of this._handles) {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const leftKey = handle.dataset.left;
        const rightKey = handle.dataset.right;
        const leftWrap = this.container.querySelector(`.section-${leftKey}`);
        const rightWrap = this.container.querySelector(`.section-${rightKey}`);
        const containerW = this.container.clientWidth;
        // Account for handle widths (5px each)
        const handleTotal = this._handles.filter(h => h.style.display !== 'none').length * 5;
        const usable = containerW - handleTotal;

        // Snapshot all visible sections as percentages of usable space
        const pcts = {};
        for (const key of this._sectionOrder) {
          if (!this._visible.has(key)) continue;
          pcts[key] = this.container.querySelector(`.section-${key}`).offsetWidth / usable;
        }

        this._drag = {
          handle,
          leftKey,
          rightKey,
          leftWrap,
          rightWrap,
          startX: e.clientX,
          usable,
          pcts,
          startLeftPct: pcts[leftKey],
          startRightPct: pcts[rightKey],
        };
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      });
    }

    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
  }

  _sectionMinPct(key, usable) {
    const minPx = key === 'price' ? 200 : key === 'gex' ? 120 : 80;
    return minPx / usable;
  }

  _onMouseMove(e) {
    if (!this._drag) return;
    const d = this._drag;
    const dxPct = (e.clientX - d.startX) / d.usable;

    const leftMin = this._sectionMinPct(d.leftKey, d.usable);
    const rightMin = this._sectionMinPct(d.rightKey, d.usable);

    let newLeftPct = d.startLeftPct + dxPct;
    let newRightPct = d.startRightPct - dxPct;

    if (newLeftPct < leftMin) { newLeftPct = leftMin; newRightPct = d.startLeftPct + d.startRightPct - leftMin; }
    if (newRightPct < rightMin) { newRightPct = rightMin; newLeftPct = d.startLeftPct + d.startRightPct - rightMin; }

    // Apply all sections as flex ratios — scales naturally with container
    d.pcts[d.leftKey] = newLeftPct;
    d.pcts[d.rightKey] = newRightPct;

    for (const key of this._sectionOrder) {
      if (!this._visible.has(key)) continue;
      const wrap = this.container.querySelector(`.section-${key}`);
      wrap.style.width = '';
      wrap.style.flex = `${d.pcts[key]} 0 0%`;
    }
  }

  _onMouseUp() {
    if (!this._drag) return;
    this._drag.handle.classList.remove('active');
    this._drag = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  toggleSection(key) {
    if (this._visible.has(key)) {
      this._visible.delete(key);
    } else {
      this._visible.add(key);
    }
    this._applyVisibility();
  }

  isSectionVisible(key) {
    return this._visible.has(key);
  }

  rebuildAll() {
    for (const section of Object.values(this.sections)) {
      section.rebuild();
    }
  }

  dispose() {
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    for (const section of Object.values(this.sections)) {
      section.dispose();
    }
    this.sections = {};
  }
}
