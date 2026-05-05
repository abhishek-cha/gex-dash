const LONG_PRESS_MS = 500;
const SWIPE_THRESHOLD = 60;

let _suppressClick = false;
export function shouldSuppressClick() {
  if (_suppressClick) {
    _suppressClick = false;
    return true;
  }
  return false;
}

export function setupWatchlistTouch(container, { onReorder, onDelete }) {
  let pressTimer = null;
  let startY = 0;
  let dragRow = null;
  let placeholder = null;
  let activeSwipeRow = null;

  // --- Swipe to delete ---
  container.addEventListener('touchstart', (e) => {
    const row = e.target.closest('.wl-row');
    if (!row || row === dragRow) return;
    row._swipeStartX = e.touches[0].clientX;
    row._swiping = false;
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    const row = e.target.closest('.wl-row');
    if (!row || !('_swipeStartX' in row)) return;

    const dx = e.touches[0].clientX - row._swipeStartX;
    const isOpen = row === activeSwipeRow;
    if (dx < -10 || (isOpen && dx > 10)) row._swiping = true;
    if (!row._swiping) return;

    const base = isOpen ? -48 : 0;
    const offset = Math.min(0, Math.max(-56, base + dx));
    row.style.transform = `translateX(${offset}px)`;
    row.style.transition = 'none';

    if (!isOpen) ensureDeleteBehind(row);
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    const row = e.target.closest('.wl-row');
    if (!row || !('_swipeStartX' in row)) return;

    if (!row._swiping) {
      delete row._swipeStartX;
      return;
    }

    const dx = e.changedTouches[0].clientX - row._swipeStartX;
    const isOpen = row === activeSwipeRow;
    row.style.transition = 'transform 0.2s ease';

    if (!isOpen && dx < -SWIPE_THRESHOLD) {
      row.style.transform = 'translateX(-48px)';
      if (activeSwipeRow && activeSwipeRow !== row) closeSwipeRow(activeSwipeRow);
      activeSwipeRow = row;
    } else if (isOpen && dx > 20) {
      closeSwipeRow(row);
    } else if (!isOpen) {
      closeSwipeRow(row);
    }

    delete row._swipeStartX;
    row._swiping = false;
  });

  function ensureDeleteBehind(row) {
    if (row.querySelector('.wl-swipe-delete')) return;
    const btn = document.createElement('button');
    btn.className = 'wl-swipe-delete';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sym = row.dataset.symbol;
      row.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      row.style.transform = 'translateX(-100%)';
      row.style.opacity = '0';
      setTimeout(() => {
        row.remove();
        onDelete({ type: 'symbol', symbol: sym });
      }, 300);
    });
    row.style.position = 'relative';
    row.appendChild(btn);
  }

  function closeSwipeRow(row) {
    row.style.transition = 'transform 0.2s ease';
    row.style.transform = '';
    if (activeSwipeRow === row) activeSwipeRow = null;
    setTimeout(() => {
      const btn = row.querySelector('.wl-swipe-delete');
      if (btn) btn.remove();
    }, 200);
  }

  // Close any open swipe when tapping elsewhere
  container.addEventListener('pointerdown', (e) => {
    if (activeSwipeRow && !activeSwipeRow.contains(e.target)) {
      closeSwipeRow(activeSwipeRow);
    }
  });

  // --- Long press to reorder ---
  let activePointerId = null;

  container.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.wl-row');
    if (!row) return;
    if (e.target.closest('.wl-swipe-delete')) return;
    if (activeSwipeRow) return;

    startY = e.clientY;
    activePointerId = e.pointerId;
    pressTimer = setTimeout(() => {
      startDrag(row);
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
      activePointerId = null;
      container.removeEventListener('pointermove', onMoveCancel);
    };
    container.addEventListener('pointerup', cleanup, { once: true });
    container.addEventListener('pointercancel', cleanup, { once: true });
  });

  function startDrag(row) {
    dragRow = row;
    dragRow.classList.add('dragging');
    container.style.overflow = 'hidden';
    container.style.touchAction = 'none';
    if (activePointerId != null) {
      try { dragRow.setPointerCapture(activePointerId); } catch {}
    }

    placeholder = document.createElement('div');
    placeholder.style.height = row.offsetHeight + 'px';
    placeholder.style.background = 'var(--bg-card)';
    placeholder.style.borderRadius = '4px';
    placeholder.style.margin = '2px 0';
    row.parentNode.insertBefore(placeholder, row);

    dragRow.style.position = 'fixed';
    dragRow.style.width = container.clientWidth + 'px';
    dragRow.style.left = '0';
    dragRow.style.top = startY - row.offsetHeight / 2 + 'px';
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
    container.style.overflow = '';
    container.style.touchAction = '';

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
    _suppressClick = true;
  }
}
