import type { ShaderMode, LayerVisibility, LayerCounts, FeedStates, MarkerClickPayload } from './types';

// ── Utilities ───────────────────────────────────────────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function utcString(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
}

// ── Top Bar ─────────────────────────────────────────────────────────────────
export function createTopBar(container: HTMLElement): { updateClock: () => void } {
  const bar = el('div', 'wv-topbar');

  // Left: branding
  const brand = el('div', 'wv-topbar-brand');
  brand.innerHTML = `
    <svg class="wv-eye-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
    <span class="wv-brand-text">WORLDVIEW <span class="wv-brand-sep">//</span> GOD EYE</span>
  `;
  bar.appendChild(brand);

  // Center: UTC clock
  const clock = el('div', 'wv-topbar-clock');
  clock.textContent = `UTC ${utcString()}`;
  bar.appendChild(clock);

  // Right: nav back
  const nav = el('a', 'wv-topbar-nav');
  nav.href = '/';
  nav.textContent = '← MONITOR';
  bar.appendChild(nav);

  container.appendChild(bar);

  return {
    updateClock: () => { clock.textContent = `UTC ${utcString()}`; },
  };
}

// ── Layer Controls ──────────────────────────────────────────────────────────
interface LayerDef {
  key: keyof LayerVisibility;
  icon: string;
  label: string;
}

const LAYERS: LayerDef[] = [
  { key: 'aircraft', icon: '✈', label: 'AIRCRAFT' },
  { key: 'satellites', icon: '🛰', label: 'SATELLITES' },
  { key: 'vessels', icon: '🚢', label: 'VESSELS' },
  { key: 'webcams', icon: '📷', label: 'WEBCAMS' },
];

export function createLayerControls(
  container: HTMLElement,
  initialVisibility: LayerVisibility,
  onToggle: (layer: keyof LayerVisibility, enabled: boolean) => void,
): { updateCounts: (counts: LayerCounts) => void } {
  const panel = el('div', 'wv-layer-panel');
  const title = el('div', 'wv-panel-title', 'LAYERS');
  panel.appendChild(title);

  const countEls: Record<string, HTMLElement> = {};
  const vis = { ...initialVisibility };

  for (const layer of LAYERS) {
    const row = el('div', 'wv-layer-row');

    const icon = el('span', 'wv-layer-icon', layer.icon);
    row.appendChild(icon);

    const label = el('span', 'wv-layer-label', layer.label);
    row.appendChild(label);

    const count = el('span', 'wv-layer-count', '0');
    countEls[layer.key] = count;
    row.appendChild(count);

    const toggle = el('button', 'wv-toggle');
    toggle.classList.toggle('wv-toggle--on', vis[layer.key]);
    toggle.setAttribute('aria-label', `Toggle ${layer.label}`);
    toggle.innerHTML = '<span class="wv-toggle-knob"></span>';
    toggle.addEventListener('click', () => {
      vis[layer.key] = !vis[layer.key];
      toggle.classList.toggle('wv-toggle--on', vis[layer.key]);
      onToggle(layer.key, vis[layer.key]);
    });
    row.appendChild(toggle);

    panel.appendChild(row);
  }

  container.appendChild(panel);

  return {
    updateCounts: (counts: LayerCounts) => {
      for (const key of Object.keys(counts) as Array<keyof LayerCounts>) {
        if (countEls[key]) countEls[key].textContent = formatNum(counts[key]);
      }
    },
  };
}

// ── Shader Selector ─────────────────────────────────────────────────────────
interface ShaderDef {
  mode: ShaderMode;
  label: string;
}

const SHADERS: ShaderDef[] = [
  { mode: 'normal', label: 'NRM' },
  { mode: 'nightvision', label: 'NV' },
  { mode: 'thermal', label: 'THM' },
  { mode: 'crt', label: 'CRT' },
  { mode: 'blueprint', label: 'BLP' },
];

export function createShaderSelector(
  container: HTMLElement,
  onChange: (mode: ShaderMode) => void,
): void {
  const panel = el('div', 'wv-shader-panel');
  const title = el('div', 'wv-panel-title', 'SHADER');
  panel.appendChild(title);

  const row = el('div', 'wv-shader-row');
  let activeBtn: HTMLButtonElement | null = null;

  for (const shader of SHADERS) {
    const btn = el('button', 'wv-shader-btn');
    btn.textContent = shader.label;
    btn.dataset.mode = shader.mode;
    if (shader.mode === 'normal') {
      btn.classList.add('wv-shader-btn--active');
      activeBtn = btn;
    }
    btn.addEventListener('click', () => {
      if (activeBtn) activeBtn.classList.remove('wv-shader-btn--active');
      btn.classList.add('wv-shader-btn--active');
      activeBtn = btn;
      onChange(shader.mode);
    });
    row.appendChild(btn);
  }

  panel.appendChild(row);
  container.appendChild(panel);
}

// ── Info Panel ──────────────────────────────────────────────────────────────
export function createInfoPanel(container: HTMLElement): {
  show: (payload: MarkerClickPayload) => void;
  hide: () => void;
} {
  const panel = el('div', 'wv-info-panel');
  panel.classList.add('wv-info-panel--hidden');

  const header = el('div', 'wv-info-header');
  const titleEl = el('span', 'wv-info-title');
  const closeBtn = el('button', 'wv-info-close', '×');
  closeBtn.addEventListener('click', () => panel.classList.add('wv-info-panel--hidden'));
  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const body = el('div', 'wv-info-body');
  panel.appendChild(body);

  container.appendChild(panel);

  function addRow(parent: HTMLElement, label: string, value: string): void {
    const row = el('div', 'wv-info-row');
    const l = el('span', 'wv-info-label', label);
    const v = el('span', 'wv-info-value', value);
    row.appendChild(l);
    row.appendChild(v);
    parent.appendChild(row);
  }

  return {
    show(payload: MarkerClickPayload) {
      body.innerHTML = '';
      const d = payload.data;

      switch (payload.type) {
        case 'aircraft':
          titleEl.textContent = `✈ ${d.callsign || d.icao24 || 'UNKNOWN'}`;
          addRow(body, 'COUNTRY', String(d.country ?? ''));
          addRow(body, 'ALTITUDE', `${Number(d.altitude ?? 0).toFixed(0)} m`);
          addRow(body, 'SPEED', `${Number(d.velocity ?? 0).toFixed(0)} m/s`);
          addRow(body, 'HEADING', `${Number(d.heading ?? 0).toFixed(1)}°`);
          break;
        case 'satellite':
          titleEl.textContent = `🛰 ${d.name || 'UNKNOWN SAT'}`;
          addRow(body, 'NORAD ID', String(d.noradId ?? ''));
          addRow(body, 'COUNTRY', String(d.country ?? ''));
          addRow(body, 'TYPE', String(d.type ?? ''));
          addRow(body, 'ALTITUDE', `${Number(d.alt ?? 0).toFixed(0)} km`);
          addRow(body, 'VELOCITY', `${Number(d.velocity ?? 0).toFixed(1)} km/s`);
          addRow(body, 'INCLINATION', `${Number(d.inclination ?? 0).toFixed(1)}°`);
          break;
        case 'vessel':
          titleEl.textContent = `🚢 ${d.name || 'UNKNOWN'}`;
          addRow(body, 'MMSI', String(d.mmsi ?? ''));
          addRow(body, 'TYPE', String(d.type ?? ''));
          addRow(body, 'SPEED', `${Number(d.speed ?? 0).toFixed(1)} kn`);
          addRow(body, 'HEADING', `${Number(d.heading ?? 0).toFixed(1)}°`);
          break;
        case 'webcam':
          titleEl.textContent = `📷 ${d.title || 'WEBCAM'}`;
          addRow(body, 'CATEGORY', String(d.category ?? ''));
          addRow(body, 'LAT', String(Number(d.lat ?? 0).toFixed(4)));
          addRow(body, 'LNG', String(Number(d.lng ?? 0).toFixed(4)));
          break;
      }

      panel.classList.remove('wv-info-panel--hidden');
    },
    hide() {
      panel.classList.add('wv-info-panel--hidden');
    },
  };
}

// ── Status Bar ──────────────────────────────────────────────────────────────
export function createStatusBar(container: HTMLElement): {
  updateFeeds: (states: FeedStates) => void;
  updateCursor: (lat: number, lng: number, zoom: number) => void;
  updateTime: () => void;
  updateCounts: (counts: LayerCounts) => void;
} {
  const bar = el('div', 'wv-statusbar');

  // Left: feed indicators
  const feedsEl = el('div', 'wv-statusbar-feeds');
  const feedDots: Record<string, HTMLElement> = {};
  const feedSources = ['opensky', 'celestrak', 'ais', 'webcam'] as const;
  for (const src of feedSources) {
    const indicator = el('span', 'wv-feed-indicator');
    const dot = el('span', 'wv-feed-dot');
    dot.classList.add('wv-feed-dot--offline');
    feedDots[src] = dot;
    const label = el('span', 'wv-feed-label', src.toUpperCase());
    indicator.appendChild(dot);
    indicator.appendChild(label);
    feedsEl.appendChild(indicator);
  }
  bar.appendChild(feedsEl);

  // Center: counts + cursor
  const centerEl = el('div', 'wv-statusbar-center');
  const countsEl = el('span', 'wv-statusbar-counts');
  const cursorEl = el('span', 'wv-statusbar-cursor', 'LAT 0.0000 LNG 0.0000 Z2.5');
  centerEl.appendChild(countsEl);
  centerEl.appendChild(cursorEl);
  bar.appendChild(centerEl);

  // Right: UTC time
  const timeEl = el('div', 'wv-statusbar-time');
  timeEl.textContent = `UTC ${utcString()}`;
  bar.appendChild(timeEl);

  container.appendChild(bar);

  return {
    updateFeeds(states: FeedStates) {
      for (const src of feedSources) {
        const dot = feedDots[src];
        dot.classList.remove('wv-feed-dot--live', 'wv-feed-dot--stale', 'wv-feed-dot--offline');
        dot.classList.add(`wv-feed-dot--${states[src]}`);
      }
    },
    updateCursor(lat: number, lng: number, zoom: number) {
      cursorEl.textContent = `LAT ${lat.toFixed(4)} LNG ${lng.toFixed(4)} Z${zoom.toFixed(1)}`;
    },
    updateTime() {
      timeEl.textContent = `UTC ${utcString()}`;
    },
    updateCounts(counts: LayerCounts) {
      const parts: string[] = [];
      if (counts.aircraft > 0) parts.push(`${formatNum(counts.aircraft)} AIRCRAFT`);
      if (counts.satellites > 0) parts.push(`${formatNum(counts.satellites)} SAT`);
      if (counts.vessels > 0) parts.push(`${formatNum(counts.vessels)} VESSELS`);
      if (counts.webcams > 0) parts.push(`${formatNum(counts.webcams)} CAM`);
      countsEl.textContent = parts.join(' │ ');
    },
  };
}
