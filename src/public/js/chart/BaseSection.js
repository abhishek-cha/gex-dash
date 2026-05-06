import * as THREE from 'three';
import { COLORS, LAYOUT } from './constants.js';

export class BaseSection {
  constructor(container, viewport, layoutOverrides) {
    this.container = container;
    this.viewport = viewport;
    this.layout = { ...LAYOUT, ...layoutOverrides };
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

    this.groups = {};
    this._highlightGroup = null;
    this._highlightedStrike = null;
    this._renderScheduled = false;

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(this.container);
  }

  _addGroup(name) {
    const g = new THREE.Group();
    this.groups[name] = g;
    this.scene.add(g);
    return g;
  }

  _clearGroup(g) {
    while (g.children.length) {
      const c = g.children[0];
      g.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
  }

  _clearAllGroups() {
    for (const g of Object.values(this.groups)) this._clearGroup(g);
  }

  _initHighlightGroup() {
    this._highlightGroup = new THREE.Group();
    this.scene.add(this._highlightGroup);
  }

  _clearHighlightGroup() {
    if (!this._highlightGroup) return;
    while (this._highlightGroup.children.length) {
      const c = this._highlightGroup.children[0];
      this._highlightGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
  }

  makePlane(x, y, w, h, color, opacity = 1.0) {
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

  makeLine(points, color, opacity = 1.0) {
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

  batchPlanes(rects, color, opacity = 1.0) {
    if (rects.length === 0) return null;
    const positions = new Float32Array(rects.length * 6 * 3);
    let i = 0;
    for (const { x, y, w, h } of rects) {
      const cx = x + w / 2, cy = y + h / 2;
      const hw = w / 2, hh = h / 2;
      positions[i++] = cx - hw; positions[i++] = cy - hh; positions[i++] = 0;
      positions[i++] = cx + hw; positions[i++] = cy - hh; positions[i++] = 0;
      positions[i++] = cx + hw; positions[i++] = cy + hh; positions[i++] = 0;
      positions[i++] = cx - hw; positions[i++] = cy - hh; positions[i++] = 0;
      positions[i++] = cx + hw; positions[i++] = cy + hh; positions[i++] = 0;
      positions[i++] = cx - hw; positions[i++] = cy + hh; positions[i++] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
    return new THREE.Mesh(geo, mat);
  }

  _gexBarBounds(strike, sortedStrikes, idx) {
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

  priceToY(price) {
    const vp = this.viewport;
    const range = vp.viewPriceMax - vp.viewPriceMin;
    if (range === 0) return this._marginBottom();
    const t = (price - vp.viewPriceMin) / range;
    return this._marginBottom() + t * this._chartH();
  }

  yToPrice(y) {
    const vp = this.viewport;
    const t = (y - this._marginBottom()) / this._chartH();
    return vp.viewPriceMin + t * (vp.viewPriceMax - vp.viewPriceMin);
  }

  _marginTop() { return 30; }
  _marginBottom() { return 30; }

  _chartH() {
    return this.height - this._marginTop() - this._marginBottom();
  }

  render() {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderScheduled = false;
      this.renderer.render(this.scene, this.camera);
    });
  }

  _onResize() {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    if (this.width === 0 || this.height === 0) return;
    this.camera.right = this.width;
    this.camera.top = this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
    this.rebuild();
  }

  rebuild() {
    // Override in subclass
  }

  dispose() {
    this._resizeObserver.disconnect();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
