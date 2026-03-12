export function registerSW() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  const enableSwInDev = String(import.meta.env.VITE_ENABLE_SW_IN_DEV || '').trim().toLowerCase() === 'true';

  if (import.meta.env.DEV && !enableSwInDev) {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister();
      });
    });
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // ignore
    });
  });
}
