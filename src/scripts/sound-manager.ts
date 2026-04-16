// src/scripts/sound-manager.ts
// Lazy-loaded sound system. All sounds muted by default.
// User opts in via SoundToggle component.
// State persisted in sessionStorage.

type SoundName = 'ambient' | 'page-turn' | 'shutter';

const SOUND_PATHS: Record<SoundName, string> = {
  'ambient': '/sounds/ambient-drone.mp3',
  'page-turn': '/sounds/page-turn.mp3',
  'shutter': '/sounds/shutter.mp3',
};

const VOLUME: Record<SoundName, number> = {
  'ambient': 0.15,
  'page-turn': 0.08,
  'shutter': 0.1,
};

const audioCache: Partial<Record<SoundName, HTMLAudioElement>> = {};
let enabled = false;

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  sessionStorage.setItem('kk-sound-enabled', value ? 'true' : 'false');

  if (!value) {
    Object.values(audioCache).forEach((audio) => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
  }
}

export function initSoundState(): void {
  const stored = sessionStorage.getItem('kk-sound-enabled');
  enabled = stored === 'true';
}

function getAudio(name: SoundName): HTMLAudioElement {
  if (!audioCache[name]) {
    const audio = new Audio(SOUND_PATHS[name]);
    audio.volume = VOLUME[name];
    audio.preload = 'none';
    audioCache[name] = audio;
  }
  return audioCache[name]!;
}

export function playSound(name: SoundName): void {
  if (!enabled) return;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  const audio = getAudio(name);
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function playAmbientLoop(): void {
  if (!enabled) return;
  const audio = getAudio('ambient');
  audio.loop = true;
  audio.play().catch(() => {});
}

export function stopAmbient(): void {
  const audio = audioCache['ambient'];
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}
