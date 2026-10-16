import { translate } from '../i18n/runtime';
export const PWA_RESTART_CONFIRM_MESSAGE = 'Quieres reiniciar la app?';

interface RestartPwaOptions {
  confirmMessage?: string;
  win?: Window;
  nav?: Navigator;
  timeoutMs?: number;
}

const waitForControllerChange = (
  nav: Navigator,
  timeoutMs: number,
) => new Promise<void>((resolve) => {
  if (!('serviceWorker' in nav)) {
    resolve();
    return;
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timeoutId);
    nav.serviceWorker.removeEventListener('controllerchange', finish);
    resolve();
  };

  const timeoutId: ReturnType<typeof setTimeout> = setTimeout(finish, timeoutMs);
  nav.serviceWorker.addEventListener('controllerchange', finish);
});

export const registerScopedServiceWorker = async (
  scope: '/audience' | '/control',
  nav: Navigator = navigator,
) => {
  if (!('serviceWorker' in nav)) return null;

  try {
    const registration = await nav.serviceWorker.register('/audience-sw.js', { scope });
    if (registration.waiting) {
      return registration;
    }
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && nav.serviceWorker.controller) {
          // The restart button will activate the waiting worker before reload.
        }
      });
    });
    return registration;
  } catch (err) {
    console.error(`PWA service worker registration failed for ${scope}`, err);
    return null;
  }
};

export const restartPwaApp = async ({
  confirmMessage = translate('common:pwaRestartConfirm', PWA_RESTART_CONFIRM_MESSAGE),
  win = window,
  nav = navigator,
  timeoutMs = 1500,
}: RestartPwaOptions = {}) => {
  if (!win.confirm(confirmMessage)) return false;

  if ('serviceWorker' in nav) {
    const registration = await nav.serviceWorker.getRegistration();
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      await waitForControllerChange(nav, timeoutMs);
    }
  }

  win.location.reload();
  return true;
};
