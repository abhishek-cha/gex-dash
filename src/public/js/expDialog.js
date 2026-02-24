/**
 * @param {object} state - { allExpirations, selectedExpirations }
 */
export function openExpDialog(state) {
  const list = document.getElementById('exp-dialog-list');
  list.innerHTML = '';
  for (const exp of state.allExpirations) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = exp;
    cb.checked = state.selectedExpirations.has(exp);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(exp));
    list.appendChild(label);
  }
  document.getElementById('exp-dialog-backdrop').classList.add('open');
}

export function closeExpDialog() {
  document.getElementById('exp-dialog-backdrop').classList.remove('open');
}

/**
 * Reads checked state from the dialog, updates state, and triggers reload.
 * @param {object} state - { selectedExpirations, updateFilterButton }
 * @param {() => void} onApply - callback to trigger GEX reload
 */
export function applyExpFilter(state, onApply) {
  const checkboxes = document.querySelectorAll('#exp-dialog-list input[type="checkbox"]');
  state.selectedExpirations = new Set();
  checkboxes.forEach(cb => { if (cb.checked) state.selectedExpirations.add(cb.value); });
  state.updateFilterButton();
  closeExpDialog();
  onApply();
}
