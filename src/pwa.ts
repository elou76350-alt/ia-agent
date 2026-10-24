type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
type PwaState = {
  installAvailable: boolean;
  updateAvailable: boolean;
  registrationFailed: boolean;
  unavailable: 'standalone-file' | 'development' | 'insecure' | 'unsupported' | null;
};

let state: PwaState = { installAvailable: false, updateAvailable: false, registrationFailed: false, unavailable: null };
let installPrompt: InstallPrompt | null = null;
let waitingRegistration: ServiceWorkerRegistration | null = null;
let started = false;
let reloadOnControllerChange = false;
const listeners = new Set<() => void>();
const updateState = (next: Partial<PwaState>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };

export const getPwaState = () => state;
export const subscribePwa = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export async function registerServiceWorker() {
  if (started) return;
  started = true;
  const standaloneFile = location.protocol === 'file:' || Boolean((window as Window & { __CAP_STANDALONE__?: boolean }).__CAP_STANDALONE__);
  if (standaloneFile) { updateState({ unavailable: 'standalone-file' }); return; }
  if (import.meta.env.DEV) { updateState({ unavailable: 'development' }); return; }
  if (!window.isSecureContext) { updateState({ unavailable: 'insecure' }); return; }
  if (!('serviceWorker' in navigator)) { updateState({ unavailable: 'unsupported' }); return; }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event as InstallPrompt;
    updateState({ installAvailable: true });
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; updateState({ installAvailable: false }); });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnControllerChange) window.location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    const waiting = () => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        waitingRegistration = registration;
        updateState({ updateAvailable: true });
      }
    };
    waiting();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') waiting(); });
    });
  } catch { updateState({ registrationFailed: true }); }
}

export async function requestAppInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = installPrompt;
  if (!prompt) return 'unavailable';
  try {
    await prompt.prompt();
    const result = await prompt.userChoice;
    installPrompt = null;
    updateState({ installAvailable: false });
    return result.outcome;
  } catch { return 'unavailable'; }
}

export function applyAppUpdate() {
  if (!waitingRegistration?.waiting) return;
  reloadOnControllerChange = true;
  waitingRegistration.waiting.postMessage({ type: 'CAP_ACTIVATE_UPDATE' });
}
