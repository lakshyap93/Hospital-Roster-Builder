(() => {
  const waiting = [];
  let active = false;

  function showAppDialog(message, options = {}) {
    return new Promise(resolve => {
      waiting.push({ message: String(message ?? ''), options, resolve });
      renderNext();
    });
  }

  function ensureDialog() {
    let backdrop = document.getElementById('appDialogBackdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'appDialogBackdrop';
    backdrop.className = 'app-dialog-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <section class="app-dialog" role="alertdialog" aria-modal="true" aria-labelledby="appDialogTitle" aria-describedby="appDialogMessage">
        <div class="app-dialog-mark" aria-hidden="true">!</div>
        <div class="app-dialog-copy"><h2 id="appDialogTitle">Notice</h2><p id="appDialogMessage"></p>
          <input id="appDialogInput" class="app-dialog-input" type="text" autocomplete="off" hidden>
        </div>
        <div class="app-dialog-actions">
          <button type="button" class="secondary" id="appDialogCancel" hidden>Cancel</button>
          <button type="button" class="primary" id="appDialogOk">OK</button>
        </div>
      </section>`;
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function renderNext() {
    if (active || !waiting.length || !document.body) return;
    active = true;
    const item = waiting.shift();
    const { options } = item;
    const kind = options.kind || 'alert';
    const backdrop = ensureDialog();
    const title = backdrop.querySelector('#appDialogTitle');
    const message = backdrop.querySelector('#appDialogMessage');
    const input = backdrop.querySelector('#appDialogInput');
    const ok = backdrop.querySelector('#appDialogOk');
    const cancel = backdrop.querySelector('#appDialogCancel');
    const finish = value => {
      backdrop.hidden = true;
      document.removeEventListener('keydown', onKeyDown, true);
      item.resolve(value);
      active = false;
      renderNext();
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(kind === 'prompt' ? null : kind === 'confirm' ? false : true);
      } else if (event.key === 'Enter' && event.target !== cancel) {
        event.preventDefault();
        finish(kind === 'prompt' ? input.value : true);
      }
    };

    title.textContent = options.title || (kind === 'confirm' ? 'Confirm action' : kind === 'prompt' ? 'Enter details' : 'Notice');
    message.textContent = item.message;
    input.hidden = kind !== 'prompt';
    input.value = options.defaultValue || '';
    input.placeholder = options.placeholder || '';
    cancel.hidden = kind === 'alert';
    ok.textContent = options.okText || 'OK';
    cancel.textContent = options.cancelText || 'Cancel';
    ok.onclick = () => finish(kind === 'prompt' ? input.value : true);
    cancel.onclick = () => finish(kind === 'prompt' ? null : false);
    backdrop.onclick = event => {
      if (event.target === backdrop) finish(kind === 'prompt' ? null : kind === 'confirm' ? false : true);
    };
    backdrop.hidden = false;
    document.addEventListener('keydown', onKeyDown, true);
    requestAnimationFrame(() => (kind === 'prompt' ? input : ok).focus());
  }

  window.showAppDialog = showAppDialog;
  window.alert = message => { showAppDialog(message); };
})();
