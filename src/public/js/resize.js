const COMPACT_THRESHOLD = 280;

export function setupWatchlistResize() {
  const handle = document.getElementById('wl-resize-handle');
  const panel = document.getElementById('watchlist-panel');
  const mainContent = document.getElementById('main-content');
  let dragging = false;

  new ResizeObserver(() => {
    const w = panel.offsetWidth;
    panel.classList.toggle('compact', w < COMPACT_THRESHOLD);
  }).observe(panel);

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = mainContent.getBoundingClientRect();
    const newWidth = rect.right - e.clientX;
    const clamped = Math.max(180, Math.min(newWidth, 340));
    panel.style.width = clamped + 'px';
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}
