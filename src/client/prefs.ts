// Player preferences saved in the browser.

export interface Prefs {
  name: string;
  sensitivity: number;
  fov: number;
  volume: number;
  crosshairColor: string;
  crosshairSize: number;
  crosshairGap: number;
  renderScale: number;
  /** 'auto' lowers render scale when frames drop. */
  quality: 'auto' | 'high' | 'low';
  showFps: boolean;
  viewBob: boolean;
}

const KEY = 'cubefire.prefs.v1';

export const DEFAULT_PREFS: Prefs = {
  name: '',
  sensitivity: 1,
  fov: 80,
  volume: 0.7,
  crosshairColor: '#7cff6b',
  crosshairSize: 7,
  crosshairGap: 4,
  renderScale: 1,
  quality: 'auto',
  showFps: false,
  viewBob: true,
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { /* storage blocked: use defaults */ }
  return { ...DEFAULT_PREFS };
}

export function savePrefs(p: Prefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}
