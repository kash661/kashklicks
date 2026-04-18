// src/scripts/lazy-video.ts
// Starts <video data-autoplay> elements when they enter the viewport.
// Honors prefers-reduced-motion and Save-Data hints. Pauses again when
// the video scrolls out of view to save battery and bandwidth.

export function initLazyVideo(): void {
  const videos = document.querySelectorAll<HTMLVideoElement>(
    'video[data-autoplay]'
  );

  if (!videos.length) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = (navigator as any).connection?.saveData === true;
  if (reduced || saveData) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) {
          if (video.preload === 'none') video.preload = 'auto';
          video.play().catch(() => {
            // Autoplay can still be blocked (rare on muted videos).
            // Surface a one-shot click handler so a tap starts playback.
            const startOnTap = () => {
              video.play().catch(() => {});
              video.removeEventListener('click', startOnTap);
              document.removeEventListener('touchstart', startOnTap);
            };
            video.addEventListener('click', startOnTap, { once: true });
            document.addEventListener('touchstart', startOnTap, { once: true });
          });
        } else {
          video.pause();
        }
      });
    },
    { threshold: 0.1 }
  );

  videos.forEach((video) => observer.observe(video));
}
