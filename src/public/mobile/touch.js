const LONG_PRESS_MS = 500;

let editMode = false;
let onDeleteCb = null;
let onReorderCb = null;
let containerEl = null;

export function setupWatchlistReorder(container, { onReorder, onDelete }) {
  containerEl = container;
  onReorderCb = onReorder;
  onDeleteCb = onDelete;

  let pressTimer = null;
  let startY = 0;
  let dragRow = null;
  let placeholder = null;

  container.addEventListener('pointerdown', (e) => {
    const deleteBtn = e.target.closest('.wl-delete-btn');
    if (deleteBtn) return;

    const row = e.target.closest('.wl-row, .wl-section-header');
    if (!row) return;

    if (editMode && row.classList.contains('wl-row')) {
      startY = e.clientY;
      pressTimer = setTimeout(() => startDrag(row, e), 200);

      const onMoveCancel = (ev) => {
        if (Math.abs(ev.clientY - startY) > 10) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };
      container.addEventListener('pointermove', onMoveCancel, { once: false });
      container.addEventListener('pointerup', () => {
        clearTimeout(pressTimer);
        container.removeEventListener('pointermove', onMoveCancel);
      }, { once: true });
      return;
    }

    if (!editMode) {
      startY = e.clientY;
      pressTimer = setTimeout(() => {
        enterEditMode();
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
    }
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
    if (onReorderCb) onReorderCb(newOrder);

    dragRow = null;
    placeholder = null;
  }
}

function enterEditMode() {
  if (editMode) return;
  editMode = true;
  containerEl.classList.add('edit-mode');

  // Add delete buttons to all rows
  containerEl.querySelectorAll('.wl-row').forEach((row) => {
    addDeleteBtn(row, 'symbol');
  });

  // Add delete buttons to section headers
  containerEl.querySelectorAll('.wl-section-header').forEach((header) => {
    addDeleteBtn(header, 'section');
  });

  // Add Done button at top
  const doneBar = document.createElement('div');
  doneBar.className = 'wl-edit-done-bar';
  doneBar.innerHTML = '<button class="wl-done-btn">Done</button>';
  containerEl.insertBefore(doneBar, containerEl.firstChild);
  doneBar.querySelector('.wl-done-btn').addEventListener('click', exitEditMode);
}

function addDeleteBtn(el, type) {
  const btn = document.createElement('button');
  btn.className = 'wl-delete-btn';
  btn.textContent = '−';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (type === 'symbol') {
      const sym = el.dataset.symbol;
      if (onDeleteCb) onDeleteCb({ type: 'symbol', symbol: sym });
    } else {
      const name = el.textContent.replace('−', '').trim();
      if (onDeleteCb) onDeleteCb({ type: 'section', section: name });
    }
  });
  el.appendChild(btn);
}

export function exitEditMode() {
  if (!editMode) return;
  editMode = false;
  containerEl.classList.remove('edit-mode');

  // Remove all delete buttons
  containerEl.querySelectorAll('.wl-delete-btn').forEach((btn) => btn.remove());

  // Remove done bar
  const doneBar = containerEl.querySelector('.wl-edit-done-bar');
  if (doneBar) doneBar.remove();
}
