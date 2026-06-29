const RECOVERY_KEY = 'ow_dom_recovery_once';

function isTranslatorDomError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes('removechild') || lower.includes('insertbefore') || lower.includes('node to be removed');
}

export function lockPageTranslation() {
  document.documentElement.lang = 'zh-CN';
  document.documentElement.classList.add('notranslate');
  document.documentElement.setAttribute('translate', 'no');
  document.body?.classList.add('notranslate');
  document.body?.setAttribute('translate', 'no');
  document.getElementById('root')?.setAttribute('translate', 'no');
}

export function installDomRecovery() {
  lockPageTranslation();

  window.addEventListener('error', event => {
    const message = String(event.message || event.error?.message || '');
    if (!isTranslatorDomError(message)) return;

    event.preventDefault();
    if (sessionStorage.getItem(RECOVERY_KEY) === '1') return;
    sessionStorage.setItem(RECOVERY_KEY, '1');
    window.location.reload();
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    const message = String(reason?.message || reason || '');
    if (!isTranslatorDomError(message)) return;

    event.preventDefault();
    if (sessionStorage.getItem(RECOVERY_KEY) === '1') return;
    sessionStorage.setItem(RECOVERY_KEY, '1');
    window.location.reload();
  });

  window.addEventListener('load', () => {
    setTimeout(() => sessionStorage.removeItem(RECOVERY_KEY), 1500);
  });
}
