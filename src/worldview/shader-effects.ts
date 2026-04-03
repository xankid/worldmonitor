import type { ViewMode } from './types';

/** IDs we stamp on overlay divs so we can remove them cleanly */
const OVERLAY_ID = 'wv-mode-overlay';
const SCANLINES_ID = 'wv-crt-scanlines';
const GRAIN_ID = 'wv-nv-grain';
const VIGNETTE_ID = 'wv-vignette';

let currentMode: ViewMode = 'eo';

/**
 * Apply one of the 4 reference render modes to the scope viewport.
 * scopeViewport  — the .wv-scope-viewport element (circular clip)
 * mapContainer   — the .wv-map-container element (receives filter:)
 */
export function applyViewMode(scopeViewport: HTMLElement, mapContainer: HTMLElement, mode: ViewMode): void {
  currentMode = mode;

  // 1. Remove previous overlay divs
  scopeViewport.querySelectorAll(`[data-wv-overlay]`).forEach((el) => el.remove());

  // 2. Remove any direct CSS filter on the map
  mapContainer.style.filter = 'none';

  if (mode === 'eo') {
    // EO — no overlays, no filter
    return;
  }

  function makeOverlay(zIndex: number, extra?: string): HTMLElement {
    const div = document.createElement('div');
    div.setAttribute('data-wv-overlay', '');
    div.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: ${zIndex};
    `;
    if (extra) div.style.cssText += extra;
    return div;
  }

  if (mode === 'nightvision') {
    // Main NV overlay (green tint via CSS class)
    const nvMain = makeOverlay(1);
    nvMain.className = 'view-nightvision wv-overlay-layer';
    scopeViewport.appendChild(nvMain);

    // Grain noise layer
    const grain = makeOverlay(2);
    grain.className = 'nv-grain wv-overlay-layer';
    grain.setAttribute('data-wv-overlay', '');
    scopeViewport.appendChild(grain);

    // Vignette
    const vig = makeOverlay(3);
    vig.className = 'vignette wv-overlay-layer';
    scopeViewport.appendChild(vig);
  }

  if (mode === 'flir') {
    // Apply SVG filter to the map container
    mapContainer.style.filter = 'url(#flir-filter)';

    // Warm gradient overlay
    const flirMain = makeOverlay(1);
    flirMain.className = 'view-flir wv-overlay-layer';
    // Remove the filter from the overlay itself (it's on mapContainer)
    flirMain.style.filter = 'none';
    // Add the warm gradient only (the ::before pseudo won't work on dynamic divs — inline it)
    flirMain.style.background = `linear-gradient(
      180deg,
      rgba(255, 100, 0, 0.02) 0%,
      rgba(255, 0, 0, 0.03) 50%,
      rgba(100, 0, 255, 0.02) 100%
    )`;
    scopeViewport.appendChild(flirMain);

    // Vignette
    const vig = makeOverlay(2);
    vig.className = 'vignette wv-overlay-layer';
    scopeViewport.appendChild(vig);
  }

  if (mode === 'crt') {
    // CRT main overlay (vignette via ::before pseudo is in CSS class)
    const crtMain = makeOverlay(1);
    crtMain.className = 'view-crt wv-overlay-layer';
    scopeViewport.appendChild(crtMain);

    // Scanlines
    const scanlines = makeOverlay(2);
    scanlines.className = 'crt-scanlines wv-overlay-layer';
    scopeViewport.appendChild(scanlines);

    // Vignette
    const vig = makeOverlay(3);
    vig.className = 'vignette wv-overlay-layer';
    scopeViewport.appendChild(vig);
  }
}

export function getCurrentViewMode(): ViewMode {
  return currentMode;
}
