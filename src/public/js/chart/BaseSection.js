import * as THREE from 'three';
import { COLORS } from './constants.js';

export class BaseSection {
  constructor(container, viewport) {
    this.container = container;
    this.viewport = viewport;
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
    this._animating = false;

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
    this.renderer.render(this.scene, this.camera);
  }

  startAnimation() {
    if (this._animating) return;
    this._animating = true;
    const loop = () => {
      if (!this._animating) return;
      requestAnimationFrame(loop);
      this.render();
    };
    loop();
  }

  stopAnimation() {
    this._animating = false;
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
    this.stopAnimation();
    this._resizeObserver.disconnect();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
