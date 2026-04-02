import type { ShaderMode } from './types';

const FILTER_MAP: Record<ShaderMode, string> = {
  normal: 'none',
  nightvision: 'brightness(1.3) contrast(1.4) saturate(0) sepia(1) hue-rotate(75deg) brightness(0.7)',
  thermal: 'contrast(1.6) saturate(2.2) hue-rotate(180deg) brightness(0.9)',
  crt: 'contrast(1.1) brightness(0.92) saturate(0.9)',
  anime: 'contrast(1.2) saturate(1.6) brightness(1.1)',
  noir: 'saturate(0) contrast(1.4) brightness(0.85)',
  blueprint: 'brightness(0.75) contrast(1.3) saturate(0) sepia(1) hue-rotate(180deg)',
};

let currentMode: ShaderMode = 'normal';

export function applyShaderMode(container: HTMLElement, mode: ShaderMode): void {
  currentMode = mode;
  const mapEl = container.querySelector('.wv-map-container') as HTMLElement | null;
  if (mapEl) {
    mapEl.style.filter = FILTER_MAP[mode] ?? 'none';
  }
  container.dataset.shader = mode;
}

export function getCurrentShaderMode(): ShaderMode {
  return currentMode;
}
