import type { ShaderMode, LayerVisibility, LayerCounts, FeedStates, MarkerClickPayload } from './types';

// ── Utilities ───────────────────────────────────────────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function utcStamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
}

// ── Top Bar (WORLDVIEW branding + telemetry + REC) ──────────────────────────
export function createTopBar(container: HTMLElement): { updateClock: () => void } {
  // Telemetry strip (very top)
  const telStrip = el('div', 'wv-telemetry-strip');
  telStrip.textContent = 'PANOPTIC VIS:1 SRC:36 DENS:0.48 0.1ms';
  container.appendChild(telStrip);

  // Brand block
  const topbar = el('div', 'wv-topbar');
  const brand = el('div', 'wv-topbar-brand');
  brand.innerHTML = `
    <div class="wv-brand-row">
      <span class="wv-brand-dot"></span>
      <span class="wv-brand-text">WORLDVIEW</span>
    </div>
    <span class="wv-brand-tagline">NO PLACE LEFT BEHIND</span>
  `;
  topbar.appendChild(brand);
  container.appendChild(topbar);

  // Classification banner
  const classif = el('div', 'wv-classification');
  classif.textContent = 'TOP SECRET // SI-TK // NOFORN';
  container.appendChild(classif);

  // REC indicator (top-right)
  const rec = el('div', 'wv-rec-block');
  const recLine = el('div', 'wv-rec-line');
  recLine.innerHTML = `<span class="wv-rec-dot"></span>REC ${utcStamp()}`;
  rec.appendChild(recLine);
  const recSub = el('div', 'wv-rec-sub');
  recSub.textContent = 'ORB: 47676 PASS: DESC-284';
  rec.appendChild(recSub);
  container.appendChild(rec);

  // Active style indicator
  const activeStyle = el('div', 'wv-active-style');
  activeStyle.innerHTML = `
    <div class="wv-active-style-label">ACTIVE STYLE</div>
    <div class="wv-active-style-value" id="wv-current-style">NORMAL</div>
  `;
  container.appendChild(activeStyle);

  // Nav back
  const nav = el('a', 'wv-topbar-nav');
  nav.href = '/';
  nav.textContent = '← MONITOR';
  container.appendChild(nav);

  // Edge labels
  const edgeL = el('div', 'wv-edge-left');
  edgeL.textContent = `ROLL: ${utcStamp().slice(11, 19)}`;
  container.appendChild(edgeL);

  const edgeR = el('div', 'wv-edge-right');
  edgeR.textContent = 'HAMD GAIN: 1.0x';
  container.appendChild(edgeR);

  return {
    updateClock: () => {
      const ts = utcStamp();
      recLine.innerHTML = `<span class="wv-rec-dot"></span>REC ${ts}`;
      edgeL.textContent = `ROLL: ${ts.slice(11, 19)}`;
    },
  };
}

// ── Left Panel (Layers + CCTV) ──────────────────────────────────────────────
interface LayerDef { key: keyof LayerVisibility; icon: string; label: string; }

const LAYERS: LayerDef[] = [
  { key: 'aircraft', icon: '✈', label: 'AIRCRAFT' },
  { key: 'satellites', icon: '🛰', label: 'SATELLITES' },
  { key: 'vessels', icon: '🚢', label: 'VESSELS' },
  { key: 'webcams', icon: '📷', label: 'WEBCAMS' },
];

export function createLeftPanel(
  container: HTMLElement,
  initialVisibility: LayerVisibility,
  onToggle: (layer: keyof LayerVisibility, enabled: boolean) => void,
): { updateCounts: (counts: LayerCounts) => void } {
  const panel = el('div', 'wv-left-panel');

  // Header buttons
  const header = el('div', 'wv-left-panel-header');
  const cctvBtn = el('button', 'wv-panel-btn wv-panel-btn--cyan', 'CCTV ON');
  const nearBtn = el('button', 'wv-panel-btn wv-panel-btn--default', 'NEAREST');
  header.appendChild(cctvBtn);
  header.appendChild(nearBtn);
  panel.appendChild(header);

  // Layers
  const layerSection = el('div', 'wv-layer-section');
  const countEls: Record<string, HTMLElement> = {};
  const vis = { ...initialVisibility };

  for (const layer of LAYERS) {
    const row = el('div', 'wv-layer-row');
    row.appendChild(el('span', 'wv-layer-icon', layer.icon));
    row.appendChild(el('span', 'wv-layer-label', layer.label));
    const count = el('span', 'wv-layer-count', '0');
    countEls[layer.key] = count;
    row.appendChild(count);

    const toggle = el('button', 'wv-toggle');
    toggle.classList.toggle('wv-toggle--on', vis[layer.key]);
    toggle.innerHTML = '<span class="wv-toggle-knob"></span>';
    toggle.addEventListener('click', () => {
      vis[layer.key] = !vis[layer.key];
      toggle.classList.toggle('wv-toggle--on', vis[layer.key]);
      onToggle(layer.key, vis[layer.key]);
    });
    row.appendChild(toggle);
    layerSection.appendChild(row);
  }
  panel.appendChild(layerSection);

  // CCTV preview
  const preview = el('div', 'wv-cctv-preview');
  const placeholder = el('span', 'wv-cctv-placeholder', 'NO FEED ACTIVE');
  preview.appendChild(placeholder);
  panel.appendChild(preview);

  const cctvStatus = el('div', 'wv-cctv-status', 'SNAPSHOT — OK');
  panel.appendChild(cctvStatus);

  // Feed info
  const feedInfo = el('div', 'wv-feed-info');
  feedInfo.textContent = 'OPENSKY NETWORK — LIVE ADS-B TRACKING\nCELESTRAK — ORBITAL SURVEILLANCE ACTIVE\nAIS STREAM — MARITIME FEED STANDBY';
  panel.appendChild(feedInfo);

  container.appendChild(panel);

  return {
    updateCounts: (counts: LayerCounts) => {
      for (const key of Object.keys(counts) as Array<keyof LayerCounts>) {
        if (countEls[key]) countEls[key].textContent = formatNum(counts[key]);
      }
    },
  };
}

// ── Right Panel (Parameters) ────────────────────────────────────────────────
export function createRightPanel(container: HTMLElement): void {
  const panel = el('div', 'wv-right-panel');

  const title = el('div', 'wv-panel-title');
  title.innerHTML = '<span>PARAMETERS</span>';
  const collapse = el('button', 'wv-panel-collapse', '▾');
  title.appendChild(collapse);
  panel.appendChild(title);

  const sliders = [
    { label: 'Pixelation', value: 0 },
    { label: 'Distortion', value: 35 },
    { label: 'Instability', value: 20 },
  ];

  for (const s of sliders) {
    const row = el('div', 'wv-slider-row');
    row.appendChild(el('span', 'wv-slider-label', s.label));
    const input = el('input', 'wv-slider') as HTMLInputElement;
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.value = String(s.value);
    const valEl = el('span', 'wv-slider-value', String(s.value));
    input.addEventListener('input', () => { valEl.textContent = input.value; });
    row.appendChild(input);
    row.appendChild(valEl);
    panel.appendChild(row);
  }

  container.appendChild(panel);
}

// ── Telemetry Block (bottom-right) ──────────────────────────────────────────
export function createTelemetryBlock(container: HTMLElement): { update: (alt: number, zoom: number) => void } {
  const block = el('div', 'wv-telemetry-br');
  const line1 = el('div', 'wv-telemetry-line', 'GSD: 0.08M NIIRS: 8.6');
  const line2 = el('div', 'wv-telemetry-line', 'ALT: 216M SUN: -24.7° EL');
  block.appendChild(line1);
  block.appendChild(line2);
  container.appendChild(block);

  return {
    update: (alt: number, zoom: number) => {
      const gsd = Math.max(0.01, 5000 / Math.pow(2, zoom)).toFixed(2);
      const niirs = Math.min(9, Math.max(1, zoom - 1)).toFixed(1);
      line1.textContent = `GSD: ${gsd}M NIIRS: ${niirs}`;
      line2.textContent = `ALT: ${Math.round(alt)}M SUN: -24.7° EL`;
    },
  };
}

// ── Bottom Bar (City Tabs + Style Presets) ───────────────────────────────────
interface ShaderDef { mode: ShaderMode; icon: string; label: string; }

const SHADER_PRESETS: ShaderDef[] = [
  { mode: 'normal', icon: '◯', label: 'Normal' },
  { mode: 'crt', icon: '▦', label: 'CRT' },
  { mode: 'nightvision', icon: '◑', label: 'NVG' },
  { mode: 'thermal', icon: '◐', label: 'FLIR' },
  { mode: 'anime', icon: '✦', label: 'Anime' },
  { mode: 'noir', icon: '◆', label: 'Noir' },
  { mode: 'blueprint', icon: '▤', label: 'BLP' },
];

const CITIES = [
  { name: 'Austin', lat: 30.267, lng: -97.743, zoom: 14 },
  { name: 'San Francisco', lat: 37.774, lng: -122.419, zoom: 14 },
  { name: 'New York', lat: 40.713, lng: -74.006, zoom: 13 },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503, zoom: 13 },
  { name: 'London', lat: 51.507, lng: -0.1278, zoom: 13 },
  { name: 'Paris', lat: 48.856, lng: 2.352, zoom: 13 },
  { name: 'Dubai', lat: 25.204, lng: 55.270, zoom: 13 },
  { name: 'Washington DC', lat: 38.907, lng: -77.036, zoom: 14 },
];

export function createBottomBar(
  container: HTMLElement,
  onShaderChange: (mode: ShaderMode) => void,
  onCityChange: (lat: number, lng: number, zoom: number) => void,
): void {
  const bar = el('div', 'wv-bottom-bar');

  // Location chip
  const locChip = el('div', 'wv-location-chip');
  locChip.innerHTML = `
    <span class="wv-location-dot"></span>
    <span class="wv-location-name">Global View</span>
    <span class="wv-location-sub">God Eye</span>
  `;
  bar.appendChild(locChip);

  // City tabs
  const cityRow = el('div', 'wv-city-tabs');
  let activeCity: HTMLButtonElement | null = null;
  for (const city of CITIES) {
    const btn = el('button', 'wv-city-tab', city.name);
    btn.addEventListener('click', () => {
      if (activeCity) activeCity.classList.remove('wv-city-tab--active');
      btn.classList.add('wv-city-tab--active');
      activeCity = btn;
      onCityChange(city.lat, city.lng, city.zoom);
      // Update location chip
      const nameEl = locChip.querySelector('.wv-location-name');
      if (nameEl) nameEl.textContent = city.name;
    });
    cityRow.appendChild(btn);
  }
  bar.appendChild(cityRow);

  // Style presets
  const presetsRow = el('div', 'wv-style-presets');
  let activePreset: HTMLButtonElement | null = null;

  for (const preset of SHADER_PRESETS) {
    const btn = el('button', 'wv-style-btn');
    btn.innerHTML = `<span class="wv-style-btn-icon">${preset.icon}</span>${preset.label}`;
    btn.dataset.mode = preset.mode;
    if (preset.mode === 'normal') {
      btn.classList.add('wv-style-btn--active');
      activePreset = btn;
    }
    btn.addEventListener('click', () => {
      if (activePreset) activePreset.classList.remove('wv-style-btn--active');
      btn.classList.add('wv-style-btn--active');
      activePreset = btn;
      onShaderChange(preset.mode);
      // Update active style display
      const styleVal = document.getElementById('wv-current-style');
      if (styleVal) styleVal.textContent = preset.label.toUpperCase();
    });
    presetsRow.appendChild(btn);
  }
  bar.appendChild(presetsRow);

  container.appendChild(bar);
}

// ── Info Panel (marker click) ───────────────────────────────────────────────
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
    row.appendChild(el('span', 'wv-info-label', label));
    row.appendChild(el('span', 'wv-info-value', value));
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
          break;
        case 'vessel':
          titleEl.textContent = `🚢 ${d.name || 'UNKNOWN'}`;
          addRow(body, 'MMSI', String(d.mmsi ?? ''));
          addRow(body, 'TYPE', String(d.type ?? ''));
          addRow(body, 'SPEED', `${Number(d.speed ?? 0).toFixed(1)} kn`);
          break;
        case 'webcam':
          titleEl.textContent = `📷 ${d.title || 'WEBCAM'}`;
          addRow(body, 'CATEGORY', String(d.category ?? ''));
          break;
      }
      panel.classList.remove('wv-info-panel--hidden');
    },
    hide() { panel.classList.add('wv-info-panel--hidden'); },
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

  const feedsEl = el('div', 'wv-statusbar-feeds');
  const feedDots: Record<string, HTMLElement> = {};
  for (const src of ['opensky', 'celestrak', 'ais', 'webcam'] as const) {
    const ind = el('span', 'wv-feed-indicator');
    const dot = el('span', 'wv-feed-dot wv-feed-dot--offline');
    feedDots[src] = dot;
    ind.appendChild(dot);
    ind.appendChild(el('span', 'wv-feed-label', src.toUpperCase()));
    feedsEl.appendChild(ind);
  }
  bar.appendChild(feedsEl);

  const centerEl = el('div', 'wv-statusbar-center');
  const countsEl = el('span', 'wv-statusbar-counts');
  const cursorEl = el('span', 'wv-statusbar-cursor', 'LAT 0.0000 LNG 0.0000 Z2.5');
  centerEl.appendChild(countsEl);
  centerEl.appendChild(cursorEl);
  bar.appendChild(centerEl);

  const timeEl = el('div', 'wv-statusbar-time', `UTC ${utcStamp()}`);
  bar.appendChild(timeEl);

  container.appendChild(bar);

  return {
    updateFeeds(states: FeedStates) {
      for (const src of ['opensky', 'celestrak', 'ais', 'webcam'] as const) {
        const dot = feedDots[src];
        dot.className = `wv-feed-dot wv-feed-dot--${states[src]}`;
      }
    },
    updateCursor(lat: number, lng: number, zoom: number) {
      cursorEl.textContent = `LAT ${lat.toFixed(4)} LNG ${lng.toFixed(4)} Z${zoom.toFixed(1)}`;
    },
    updateTime() { timeEl.textContent = `UTC ${utcStamp()}`; },
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
