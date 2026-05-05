const LONG_PRESS_MS = 500;

export function setupWatchlistReorder(container, onReorder) {
  let pressTimer = null;
  let startY = 0;
  let dragRow = null;
  let placeholder = null;

  container.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.wl-row');
    if (!row) return;

    startY = e.clientY;
    pressTimer = setTimeout(() => {
      startDrag(row, e);
    }, LONG_PRESS_MS);

    const onMoveCancel = (ev) => {
      if (Math.abs(ev.clientY - startY) > 10) {
        clearTimeout(pressTimer);
        pressTimer = null;
        container.removeEventListener('pointermove', onMoveCancel);
      }
    };
    container.addEventListener('pointermove', onMoveCancel, { once: false });

    const cleanup = () => {
      clearTimeout(pressTimer);
      pressTimer = null;
      container.removeEventListener('pointermove', onMoveCancel);
    };
    container.addEventListener('pointerup', cleanup, { once: true });
    container.addEventListener('pointercancel', cleanup, { once: true });
  });

  function startDrag(row, e) {
    dragRow = row;
    dragRow.classList.add('dragging');
    dragRow.setPointerCapture(e.pointerId);

    placeholder = document.createElement('div');
    placeholder.style.height = row.offsetHeight + 'px';
    placeholder.style.background = 'var(--bg-card)';
    placeholder.style.borderRadius = '4px';
    placeholder.style.margin = '2px 0';
    row.parentNode.insertBefore(placeholder, row);

    dragRow.style.position = 'fixed';
    dragRow.style.width = container.clientWidth + 'px';
    dragRow.style.left = '0';
    dragRow.style.top = e.clientY - row.offsetHeight / 2 + 'px';
    dragRow.style.zIndex = '200';
    dragRow.style.pointerEvents = 'none';

    dragRow.addEventListener('pointermove', onDragMove);
    dragRow.addEventListener('pointerup', onDragEnd);
    dragRow.addEventListener('pointercancel', onDragEnd);
  }

  function onDragMove(e) {
    if (!dragRow) return;
    dragRow.style.top = e.clientY - dragRow.offsetHeight / 2 + 'px';

    const target = document.elementFromPoint(e.clientX, e.clientY);
    const targetRow = target?.closest('.wl-row');
    if (targetRow && targetRow !== dragRow && targetRow !== placeholder) {
      const rect = targetRow.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (e.clientY < mid) {
        targetRow.parentNode.insertBefore(placeholder, targetRow);
      } else {
        targetRow.parentNode.insertBefore(placeholder, targetRow.nextSibling);
      }
    }
  }

  function onDragEnd() {
    if (!dragRow) return;
    dragRow.classList.remove('dragging');
    dragRow.style.position = '';
    dragRow.style.width = '';
    dragRow.style.left = '';
    dragRow.style.top = '';
    dragRow.style.zIndex = '';
    dragRow.style.pointerEvents = '';

    dragRow.removeEventListener('pointermove', onDragMove);
    dragRow.removeEventListener('pointerup', onDragEnd);
    dragRow.removeEventListener('pointercancel', onDragEnd);

    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.insertBefore(dragRow, placeholder);
      placeholder.remove();
    }

    const newOrder = [...container.querySelectorAll('.wl-row')].map((r) => r.dataset.symbol);
    onReorder(newOrder);

    dragRow = null;
    placeholder = null;
  }
}
