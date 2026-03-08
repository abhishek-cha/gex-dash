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
  }

  init() {
    this.container.innerHTML = '';
    this.container.classList.add('chart-layout');

    for (const key of this._sectionOrder) {
      const wrap = document.createElement('div');
      wrap.className = `section-wrap section-${key}`;
      wrap.dataset.section = key;
      this.container.appendChild(wrap);

      if (key === 'price') {
        const loadPrice = document.createElement('div');
        loadPrice.id = 'loading-price';
        loadPrice.className = 'section-loading';
        loadPrice.textContent = 'Loading price...';
        wrap.appendChild(loadPrice);
      }

      if (key === 'gex') {
        const loadGex = document.createElement('div');
        loadGex.id = 'loading-gex';
        loadGex.className = 'section-loading';
        loadGex.textContent = 'Loading GEX...';
        wrap.appendChild(loadGex);
      }
    }

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
    for (const section of Object.values(this.sections)) {
      section.dispose();
    }
    this.sections = {};
  }
}
