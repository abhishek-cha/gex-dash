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

  container.addEventListener('pointerdown', (e) => {
    if (activeSwipeRow && !activeSwipeRow.contains(e.target)) {
      closeSwipeRow(activeSwipeRow);
    }
  });

  // --- Long press to reorder (transform-based) ---
  let activePointerId = null;
  let rowHeight = 0;
  let siblings = [];
  let dragStartY = 0;
  let currentOffset = 0;
  let currentIndex = 0;
  let originalIndex = 0;
  let rafId = null;

  container.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.wl-row');
    if (!row) return;
    if (e.target.closest('.wl-swipe-delete')) return;
    if (activeSwipeRow) return;

    startY = e.clientY;
    activePointerId = e.pointerId;
    pressTimer = setTimeout(() => {
      startDrag(row, e.clientY);
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

  function startDrag(row, clientY) {
    dragRow = row;
    siblings = [...container.querySelectorAll('.wl-row')].filter(r => r !== dragRow);
    rowHeight = dragRow.offsetHeight;
    originalIndex = [...container.querySelectorAll('.wl-row')].indexOf(dragRow);
    currentIndex = originalIndex;
    dragStartY = clientY;
    currentOffset = 0;

    dragRow.classList.add('dragging');
    dragRow.style.position = 'relative';
    dragRow.style.zIndex = '200';
    dragRow.style.transition = 'none';

    for (const sib of siblings) {
      sib.style.transition = 'transform 0.15s ease';
    }

    container.style.overflow = 'hidden';
    container.style.touchAction = 'none';

    if (activePointerId != null) {
      try { dragRow.setPointerCapture(activePointerId); } catch {}
    }

    dragRow.addEventListener('pointermove', onDragMove);
    dragRow.addEventListener('pointerup', onDragEnd);
    dragRow.addEventListener('pointercancel', onDragEnd);
  }

  function onDragMove(e) {
    if (!dragRow) return;
    currentOffset = e.clientY - dragStartY;

    if (rafId == null) {
      rafId = requestAnimationFrame(applyDragFrame);
    }
  }

  function applyDragFrame() {
    rafId = null;
    if (!dragRow) return;

    dragRow.style.transform = `translateY(${currentOffset}px) scale(1.02)`;

    const targetIndex = Math.round(currentOffset / rowHeight) + originalIndex;
    const clampedIndex = Math.max(0, Math.min(siblings.length, targetIndex));

    if (clampedIndex !== currentIndex) {
      currentIndex = clampedIndex;
      updateSiblingOffsets();
    }
  }

  function updateSiblingOffsets() {
    const allRows = [...container.querySelectorAll('.wl-row')];
    for (const sib of siblings) {
      const sibIdx = allRows.indexOf(sib);
      let shift = 0;
      if (originalIndex < currentIndex) {
        if (sibIdx > originalIndex && sibIdx <= currentIndex) {
          shift = -rowHeight;
        }
      } else if (originalIndex > currentIndex) {
        if (sibIdx >= currentIndex && sibIdx < originalIndex) {
          shift = rowHeight;
        }
      }
      sib.style.transform = shift ? `translateY(${shift}px)` : '';
    }
  }

  function onDragEnd() {
    if (!dragRow) return;

    dragRow.removeEventListener('pointermove', onDragMove);
    dragRow.removeEventListener('pointerup', onDragEnd);
    dragRow.removeEventListener('pointercancel', onDragEnd);

    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    // Animate dragged row to final position
    const finalOffset = (currentIndex - originalIndex) * rowHeight;
    dragRow.style.transition = 'transform 0.15s ease';
    dragRow.style.transform = `translateY(${finalOffset}px)`;

    // After animation, commit DOM order
    setTimeout(() => {
      // Clear all transforms
      dragRow.style.transition = '';
      dragRow.style.transform = '';
      dragRow.style.position = '';
      dragRow.style.zIndex = '';
      dragRow.classList.remove('dragging');

      for (const sib of siblings) {
        sib.style.transition = '';
        sib.style.transform = '';
      }

      // Single DOM reorder commit
      if (currentIndex !== originalIndex) {
        const allRows = [...container.querySelectorAll('.wl-row')];
        const ref = allRows[currentIndex];
        if (ref) {
          if (currentIndex > originalIndex) {
            ref.after(dragRow);
          } else {
            ref.before(dragRow);
          }
        }

        onReorder();
      }

      container.style.overflow = '';
      container.style.touchAction = '';
      dragRow = null;
      siblings = [];
      _suppressClick = true;
    }, 160);
  }
}
