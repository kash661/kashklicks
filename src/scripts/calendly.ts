// Lazy-loaded Calendly popup. Loads widget.js and widget.css only on first click,
// so the Calendly bundle never hits the critical path.

const CSS_URL = 'https://assets.calendly.com/assets/external/widget.css';
const JS_URL = 'https://assets.calendly.com/assets/external/widget.js';
const DEFAULT_URL =
  'https://calendly.com/kashklicks-ca/30min?hide_gdpr_banner=1&primary_color=5f5e5e&background_color=faf9f6&text_color=1a1a18';

declare global {
  interface Window {
    Calendly?: {
      initPopupWidget: (opts: { url: string }) => void;
    };
  }
}

let loader: Promise<void> | null = null;

function loadCalendly(): Promise<void> {
  if (window.Calendly) return Promise.resolve();
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_URL;
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = JS_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loader = null;
      reject(new Error('Failed to load Calendly widget'));
    };
    document.head.appendChild(script);
  });

  return loader;
}

export function initCalendly(): void {
  const links = document.querySelectorAll<HTMLAnchorElement>('[data-calendly-popup]');
  links.forEach((link) => {
    if (link.dataset.calendlyBound === 'true') return;
    link.dataset.calendlyBound = 'true';

    link.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        await loadCalendly();
        window.Calendly?.initPopupWidget({
          url: link.dataset.calendlyUrl || link.href || DEFAULT_URL,
        });
      } catch {
        // If the script failed to load, let the browser follow the fallback href.
        if (link.href) window.location.href = link.href;
      }
    });
  });
}
