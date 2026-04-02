import type { ShaderMode } from './types';

const FILTER_MAP: Record<ShaderMode, string> = {
  normal: 'none',
  nightvision: 'brightness(1.2) contrast(1.3) saturate(0) sepia(1) hue-rotate(75deg) brightness(0.8)',
  thermal: 'contrast(1.5) saturate(2) hue-rotate(180deg)',
  crt: 'contrast(1.1) brightness(0.95)',
  blueprint: 'brightness(0.8) contrast(1.2) saturate(0) sepia(1) hue-rotate(180deg)',
};

let currentMode: ShaderMode = 'normal';

export function applyShaderMode(container: HTMLElement, mode: ShaderMode): void {
  currentMode = mode;
  // Apply CSS filter to map container
  const mapEl = container.querySelector('.wv-map-container') as HTMLElement | null;
  if (mapEl) {
    mapEl.style.filter = FILTER_MAP[mode];
  }
  // Set data attribute for CSS overlay effects
  container.dataset.shader = mode;
}

export function getCurrentShaderMode(): ShaderMode {
  return currentMode;
}
