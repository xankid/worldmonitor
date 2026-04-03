import type { ViewMode, LayerVisibility, LayerCounts, FeedStates, MarkerClickPayload, CCTVCamera } from './types';

// ── Utilities ───────────────────────────────────────────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function zuluTime(): string {
  const now = new Date();
  const hh = now.getUTCHours().toString().padStart(2, '0');
  const mm = now.getUTCMinutes().toString().padStart(2, '0');
  const ss = now.getUTCSeconds().toString().padStart(2, '0');
  const YYYY = now.getUTCFullYear();
  const MM = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const DD = now.getUTCDate().toString().padStart(2, '0');
  return `BSC ${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}

function toDMS(deg: number, isLat: boolean): string {
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mf = (abs - d) * 60;
  const m = Math.floor(mf);
  const s = ((mf - m) * 60).toFixed(1);
  return `${d}°${m}'${s}"${dir}`;
}

function toGridRef(lat: number, lon: number): string {
  const lonZone = Math.floor((lon + 180) / 6) + 1;
  const latBand = 'CDEFGHJKLMNPQRSTUVWX'[Math.floor((lat + 80) / 8)] ?? 'N';
  return `${lonZone}${latBand} ${Math.floor(Math.abs(lon) * 100) % 10000} ${Math.floor(Math.abs(lat) * 100) % 10000}`;
}

function formatAlt(alt?: number): string {
  if (alt == null) return 'N/A';
  return `${(alt / 1000).toFixed(1)}KM`;
}

// ── Layer definitions matching reference ────────────────────────────────────
interface LayerDef {
  key: keyof LayerVisibility;
  icon: string;
  label: string;
  expandable?: boolean;
}

const LAYERS_DEF: LayerDef[] = [
  { key: 'aircraft', icon: '✈', label: 'Flights', expandable: true },
  { key: 'satellites', icon: '◎', label: 'Space Traffic' },
  { key: 'vessels', icon: '⚓', label: 'Vessels' },
  { key: 'webcams', icon: '📹', label: 'CCTV Mesh' },
  { key: 'cctv', icon: '📷', label: 'Traffic Cams' },
];

const LANDMARKS = [
  { label: 'DC', lon: -77.0369, lat: 38.9072 },
  { label: 'NYC', lon: -74.006, lat: 40.7128 },
  { label: 'LONDON', lon: -0.1276, lat: 51.5074 },
  { label: 'MOSCOW', lon: 37.6173, lat: 55.7558 },
  { label: 'BEIJING', lon: 116.4074, lat: 39.9042 },
  { label: 'TOKYO', lon: 139.6917, lat: 35.6895 },
  { label: 'SYDNEY', lon: 151.2093, lat: -33.8688 },
  { label: 'CAIRO', lon: 31.2357, lat: 30.0444 },
  { label: 'RIYADH', lon: 46.6753, lat: 24.7136 },
  { label: 'PYONGYANG', lon: 125.7625, lat: 39.0392 },
];

const VIEW_MODES: { key: ViewMode; label: string }[] = [
  { key: 'eo', label: 'EO' },
  { key: 'flir', label: 'FLIR' },
  { key: 'crt', label: 'CRT' },
  { key: 'nightvision', label: 'NV' },
];

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  eo: 'ELECTRO-OPTICAL',
  flir: 'FLIR THERMAL',
  nightvision: 'NIGHT VISION',
  crt: 'CRT DISPLAY',
};

// ── Left Panel ──────────────────────────────────────────────────────────────
export function createLeftPanel(
  container: HTMLElement,
  initialVisibility: LayerVisibility,
  onToggle: (layer: keyof LayerVisibility, enabled: boolean) => void,
  onViewMode: (mode: ViewMode) => void,
  onFlyTo: (lat: number, lon: number) => void,
): {
  updateCounts: (counts: LayerCounts) => void;
  setActiveViewMode: (mode: ViewMode) => void;
} {
  const panel = el('div', 'wv-panel-left');
  const inner = el('div', 'wv-panel-left-inner');
  panel.appendChild(inner);

  // ── Header ──────────────────────────────────────────────
  const header = el('div', 'panel-section');
  header.innerHTML = `
    <h1 class="wv-header-title hud-glow">WORLDVIEW</h1>
    <span class="wv-header-subtitle">TOP SECRET // SI-TK // NOFORN</span>
    <div class="wv-header-meta">
      <span class="wv-header-meta-line">ANTI-SIAM EPS-0117</span>
      <span class="wv-header-meta-nv">NV0</span>
    </div>
    <div class="wv-rec-indicator" id="wv-rec">
      <span class="wv-rec-dot"></span>
      <span class="wv-rec-text">REC</span>
      <span class="wv-rec-time" id="wv-rec-time"></span>
    </div>
  `;
  inner.appendChild(header);

  // ── Search bar ───────────────────────────────────────────
  const searchSection = el('div', 'panel-section');
  const searchWrap = el('div', 'wv-search-wrap');
  const searchInput = el('input', 'wv-search-input') as HTMLInputElement;
  searchInput.placeholder = 'SEARCH LOCATION...';
  searchInput.type = 'text';
  const searchSuffix = el('span', 'wv-search-suffix', 'SRCH');
  searchInput.addEventListener('input', () => {
    searchSuffix.textContent = searchInput.value.length > 0 ? 'ESC' : 'SRCH';
    if (searchInput.value === '') searchInput.blur();
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchInput.value = ''; searchSuffix.textContent = 'SRCH'; }
  });
  searchWrap.appendChild(searchInput);
  searchWrap.appendChild(searchSuffix);
  searchSection.appendChild(searchWrap);
  inner.appendChild(searchSection);

  // ── Map Style selector ───────────────────────────────────
  const mapStyleSection = el('div', 'panel-section');
  const mapStyleLabel = el('div', 'panel-label', 'MAP STYLE');
  mapStyleSection.appendChild(mapStyleLabel);
  const mapStyleGrid = el('div', 'wv-mapstyle-grid');
  const MAP_STYLES = [
    { key: 'dark', label: 'Dark', icon: '◐' },
    { key: 'terrain', label: 'Terrain 3D', icon: '▲' },
    { key: 'satellite', label: 'Satellite', icon: '⌂' },
  ];
  let activeMapStyle = 'dark';
  for (const ms of MAP_STYLES) {
    const msBtn = el('button', `wv-mapstyle-btn wv-mapstyle-btn--${ms.key === activeMapStyle ? 'active' : 'inactive'}`);
    msBtn.innerHTML = `<span class="wv-mapstyle-icon">${ms.icon}</span>${ms.label}`;
    msBtn.addEventListener('click', () => {
      mapStyleGrid.querySelectorAll('.wv-mapstyle-btn').forEach((b) => {
        b.className = 'wv-mapstyle-btn wv-mapstyle-btn--inactive';
      });
      msBtn.className = 'wv-mapstyle-btn wv-mapstyle-btn--active';
      activeMapStyle = ms.key;
    });
    mapStyleGrid.appendChild(msBtn);
  }
  mapStyleSection.appendChild(mapStyleGrid);
  inner.appendChild(mapStyleSection);

  // ── Layers section ───────────────────────────────────────
  const layersSection = el('div', 'panel-section');
  const layersLabel = el('div', 'panel-label', 'LAYERS');
  layersSection.appendChild(layersLabel);

  const vis = { ...initialVisibility };
  const layerBtns: Record<string, HTMLElement> = {};
  const layerDots: Record<string, HTMLElement> = {};

  for (const layer of LAYERS_DEF) {
    const wrap = el('div');

    const btn = el('div', `wv-layer-btn wv-layer-btn--${vis[layer.key] ? 'active' : 'inactive'}`);
    layerBtns[layer.key] = btn;

    const icon = el('span', 'wv-layer-icon', layer.icon);
    const name = el('span', 'wv-layer-name', layer.label);
    btn.appendChild(icon);
    btn.appendChild(name);

    // Add count badge for all layers
    const countBadge = el('span', 'wv-layer-count');
    countBadge.id = `wv-count-${layer.key}`;

    if (layer.expandable) {
      // Expandable layers get [+] toggle, no dot
      const expandBtn = el('button', 'wv-layer-expand', '[+]');
      let expanded = false;
      let subfilterEl: HTMLElement | null = null;

      btn.style.cursor = 'pointer';
      const toggleLayer = () => {
        vis[layer.key] = !vis[layer.key];
        btn.className = `wv-layer-btn wv-layer-btn--${vis[layer.key] ? 'active' : 'inactive'}`;
        onToggle(layer.key, vis[layer.key]);
        if (!vis[layer.key]) {
          expanded = false;
          expandBtn.textContent = '[+]';
          if (subfilterEl) { subfilterEl.style.display = 'none'; }
        }
      };

      // Click on name/icon toggles the layer
      const clickArea = el('div');
      clickArea.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;cursor:pointer;';
      clickArea.appendChild(icon);
      clickArea.appendChild(name);
      clickArea.addEventListener('click', toggleLayer);

      // Replace icon/name from btn
      btn.innerHTML = '';
      btn.appendChild(clickArea);
      btn.appendChild(countBadge);
      btn.appendChild(expandBtn);

      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!vis[layer.key]) return;
        expanded = !expanded;
        expandBtn.textContent = expanded ? '[-]' : '[+]';
        if (subfilterEl) subfilterEl.style.display = expanded ? 'flex' : 'none';
      });

      wrap.appendChild(btn);

      // Sub-filter items
      if (layer.key === 'aircraft') {
        subfilterEl = createSubfilter([
          { key: 'regular', label: 'Regular', active: true },
          { key: 'iss', label: 'ISS', active: true },
        ]);
        subfilterEl.style.display = 'none';
        wrap.appendChild(subfilterEl);
      }
    } else {
      // Non-expandable: count + dot indicator
      btn.appendChild(countBadge);
      const dot = el('span', `wv-layer-dot wv-layer-dot--${vis[layer.key] ? 'active' : 'inactive'}`);
      layerDots[layer.key] = dot;
      btn.appendChild(dot);
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', () => {
        vis[layer.key] = !vis[layer.key];
        btn.className = `wv-layer-btn wv-layer-btn--${vis[layer.key] ? 'active' : 'inactive'}`;
        dot.className = `wv-layer-dot wv-layer-dot--${vis[layer.key] ? 'active' : 'inactive'}`;
        onToggle(layer.key, vis[layer.key]);
      });
      wrap.appendChild(btn);
    }

    layersSection.appendChild(wrap);
  }
  inner.appendChild(layersSection);

  // ── Quick Nav ────────────────────────────────────────────
  const navSection = el('div', 'panel-section');
  const navLabel = el('div', 'panel-label', 'QUICK NAV');
  navSection.appendChild(navLabel);
  const navGrid = el('div', 'wv-quicknav-grid');
  for (const lm of LANDMARKS) {
    const btn = el('button', 'wv-quicknav-btn', lm.label);
    btn.addEventListener('click', () => onFlyTo(lm.lat, lm.lon));
    navGrid.appendChild(btn);
  }
  navSection.appendChild(navGrid);
  inner.appendChild(navSection);

  // ── Render Mode + Status ─────────────────────────────────
  const renderSection = el('div', 'panel-section');
  renderSection.style.borderTop = '1px solid rgba(0,100,0,0.2)';
  const renderLabel = el('div', 'panel-label', 'RENDER MODE');
  renderSection.appendChild(renderLabel);

  const renderGrid = el('div', 'wv-render-grid');
  const renderBtns: Record<ViewMode, HTMLButtonElement> = {} as Record<ViewMode, HTMLButtonElement>;
  let currentViewMode: ViewMode = 'eo';

  for (const vm of VIEW_MODES) {
    const btn = el('button', `wv-render-btn ${vm.key === 'eo' ? 'wv-render-btn--active' : 'wv-render-btn--inactive'}`, vm.label);
    renderBtns[vm.key] = btn;
    btn.addEventListener('click', () => {
      renderBtns[currentViewMode].className = 'wv-render-btn wv-render-btn--inactive';
      currentViewMode = vm.key;
      btn.className = 'wv-render-btn wv-render-btn--active';
      onViewMode(vm.key);
    });
    renderGrid.appendChild(btn);
  }
  renderSection.appendChild(renderGrid);

  // Status row
  const statusRow = el('div', 'wv-status-row');
  statusRow.innerHTML = `
    <span class="wv-status-dot"></span>
    <span class="wv-status-text">ONLINE</span>
    <span class="wv-status-sep">|</span>
    <span class="wv-status-layers" id="wv-active-layers">0 LAYERS</span>
  `;
  renderSection.appendChild(statusRow);
  inner.appendChild(renderSection);

  container.appendChild(panel);

  return {
    updateCounts(counts: LayerCounts) {
      const layersEl = document.getElementById('wv-active-layers');
      if (layersEl) {
        const active = Object.values(vis).filter(Boolean).length;
        layersEl.textContent = `${active} LAYER${active !== 1 ? 'S' : ''}`;
      }
      // Update per-layer count badges
      for (const key of Object.keys(counts) as Array<keyof LayerCounts>) {
        const badge = document.getElementById(`wv-count-${key}`);
        if (badge) badge.textContent = counts[key] > 0 ? String(counts[key]) : '';
      }
      // Update REC timestamp
      const recTime = document.getElementById('wv-rec-time');
      if (recTime) recTime.textContent = zuluTime().slice(4);
    },
    setActiveViewMode(mode: ViewMode) {
      if (renderBtns[currentViewMode]) {
        renderBtns[currentViewMode].className = 'wv-render-btn wv-render-btn--inactive';
      }
      currentViewMode = mode;
      if (renderBtns[mode]) {
        renderBtns[mode].className = 'wv-render-btn wv-render-btn--active';
      }
    },
  };
}

function createSubfilter(items: { key: string; label: string; active: boolean }[]): HTMLElement {
  const wrap = el('div', 'wv-subfilter');
  for (const item of items) {
    const btn = el('button', `wv-subfilter-btn wv-subfilter-btn--${item.active ? 'active' : 'inactive'}`);
    const check = el('span', `wv-subfilter-check wv-subfilter-check--${item.active ? 'active' : 'inactive'}`, item.active ? '✓' : '');
    const label = el('span', '', item.label);
    btn.appendChild(check);
    btn.appendChild(label);
    btn.addEventListener('click', () => {
      item.active = !item.active;
      check.className = `wv-subfilter-check wv-subfilter-check--${item.active ? 'active' : 'inactive'}`;
      check.textContent = item.active ? '✓' : '';
      btn.className = `wv-subfilter-btn wv-subfilter-btn--${item.active ? 'active' : 'inactive'}`;
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

// ── Right Panel ─────────────────────────────────────────────────────────────
export function createRightPanel(container: HTMLElement): {
  updatePosition: (lat: number, lon: number, alt?: number) => void;
  showEntity: (payload: MarkerClickPayload) => void;
  clearEntity: () => void;
  updateClock: () => void;
  setViewMode: (mode: ViewMode) => void;
} {
  const panel = el('div', 'wv-panel-right');

  // ── View mode + Clock ───────────────────────────────────
  const topSection = el('div', 'panel-section');

  const viewModeSpan = el('span', 'wv-view-mode-label hud-glow', 'ELECTRO-OPTICAL');
  const clockEl = el('div', 'wv-clock');
  clockEl.textContent = zuluTime();
  const subEl = el('div', 'wv-clock-sub', 'Washington DC');

  topSection.appendChild(viewModeSpan);
  topSection.appendChild(clockEl);
  topSection.appendChild(subEl);
  panel.appendChild(topSection);

  // ── Position Data ────────────────────────────────────────
  const posSection = el('div', 'panel-section');
  const posLabel = el('div', 'panel-label', 'POSITION DATA');
  posSection.appendChild(posLabel);

  const posBody = el('div');
  const posEmpty = el('div', 'wv-pos-empty', 'AWAITING INPUT');
  posBody.appendChild(posEmpty);
  posSection.appendChild(posBody);
  panel.appendChild(posSection);

  // ── Selected Entity ──────────────────────────────────────
  const entitySection = el('div', 'panel-section');
  entitySection.style.display = 'none';
  panel.appendChild(entitySection);

  // ── Data feed sections will be appended below ────────────
  // (managed by data feed updates)
  const feedContainer = el('div');
  panel.appendChild(feedContainer);

  container.appendChild(panel);

  let curLat = 0;
  let curLon = 0;

  function renderPosRows(lat: number, lon: number, alt?: number): void {
    posBody.innerHTML = '';
    const rows: [string, string][] = [
      ['GRD', toGridRef(lat, lon)],
      ['LAT', toDMS(lat, true)],
      ['LON', toDMS(lon, false)],
      ['ALT', formatAlt(alt)],
      ['ESD', `${(lat * 111.32).toFixed(1)}KM W${Math.abs(lon * 111.32 * Math.cos(lat * Math.PI / 180)).toFixed(1)}`],
    ];
    for (const [key, val] of rows) {
      const row = el('div', 'wv-pos-row');
      row.appendChild(el('span', 'wv-pos-label', key));
      row.appendChild(el('span', 'wv-pos-value', val));
      posBody.appendChild(row);
    }
  }

  return {
    updatePosition(lat: number, lon: number, alt?: number) {
      curLat = lat;
      curLon = lon;
      renderPosRows(lat, lon, alt);
    },
    showEntity(payload: MarkerClickPayload) {
      entitySection.style.display = 'block';
      entitySection.innerHTML = '';

      // Close button
      const closeRow = el('div');
      closeRow.style.display = 'flex';
      closeRow.style.justifyContent = 'space-between';
      closeRow.style.alignItems = 'center';

      const typeLabel = el('div', 'wv-entity-type-label', `TARGET: ${payload.type.toUpperCase()}`);
      const closeBtn = el('button', 'wv-entity-close', '×');
      closeBtn.addEventListener('click', () => {
        entitySection.style.display = 'none';
        entitySection.innerHTML = '';
      });
      closeRow.appendChild(typeLabel);
      closeRow.appendChild(closeBtn);
      entitySection.appendChild(closeRow);

      const d = payload.data;

      // Name
      let name = '';
      if (payload.type === 'aircraft') name = String(d.callsign || d.icao24 || 'UNKNOWN');
      else if (payload.type === 'satellite') name = String(d.name || 'UNKNOWN SAT');
      else if (payload.type === 'vessel') name = String(d.name || 'UNKNOWN');
      else if (payload.type === 'webcam') name = String(d.title || 'WEBCAM');

      entitySection.appendChild(el('div', 'wv-entity-name', name));

      // Details
      function addEntityRow(label: string, value: string): void {
        const row = el('div', 'wv-entity-row');
        row.appendChild(el('span', 'wv-entity-key', label));
        row.appendChild(el('span', 'wv-entity-val', value));
        entitySection.appendChild(row);
      }

      switch (payload.type) {
        case 'aircraft':
          addEntityRow('COUNTRY', String(d.country ?? ''));
          addEntityRow('ALTITUDE', `${Number(d.altitude ?? 0).toFixed(0)} m`);
          addEntityRow('SPEED', `${Number(d.velocity ?? 0).toFixed(0)} m/s`);
          addEntityRow('HEADING', `${Number(d.heading ?? 0).toFixed(1)}°`);
          break;
        case 'satellite':
          addEntityRow('NORAD ID', String(d.noradId ?? ''));
          addEntityRow('COUNTRY', String(d.country ?? ''));
          addEntityRow('TYPE', String(d.type ?? ''));
          addEntityRow('ALTITUDE', `${Number(d.alt ?? 0).toFixed(0)} km`);
          addEntityRow('VELOCITY', `${Number(d.velocity ?? 0).toFixed(1)} km/s`);
          break;
        case 'vessel':
          addEntityRow('MMSI', String(d.mmsi ?? ''));
          addEntityRow('TYPE', String(d.type ?? ''));
          addEntityRow('SPEED', `${Number(d.speed ?? 0).toFixed(1)} kn`);
          break;
        case 'webcam':
          addEntityRow('CATEGORY', String(d.category ?? ''));
          break;
        case 'cctv':
          addEntityRow('CITY', String(d.city ?? ''));
          addEntityRow('STATUS', String(d.active ? 'ACTIVE' : 'OFFLINE'));
          if (d.imageUrl) {
            const imgLink = el('a', 'wv-entity-link') as HTMLAnchorElement;
            imgLink.href = String(d.imageUrl);
            imgLink.target = '_blank';
            imgLink.textContent = '[VIEW FEED]';
            entitySection.appendChild(imgLink);
          }
          break;
      }
    },
    clearEntity() {
      entitySection.style.display = 'none';
      entitySection.innerHTML = '';
    },
    updateClock() {
      clockEl.textContent = zuluTime();
    },
    setViewMode(mode: ViewMode) {
      viewModeSpan.textContent = VIEW_MODE_LABELS[mode];
    },
  };
}

// ── Scope Overlay SVG (crosshairs, compass, range rings, vignette) ───────────
export function createScopeOverlay(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'wv-scope-overlay');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  function line(x1: number, y1: number, x2: number, y2: number, stroke: string, sw: string): SVGLineElement {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', String(x1));
    l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(x2));
    l.setAttribute('y2', String(y2));
    l.setAttribute('stroke', stroke);
    l.setAttribute('stroke-width', sw);
    return l;
  }

  function circle(cx: number, cy: number, r: number, fill: string, stroke: string, sw: string, dash?: string): SVGCircleElement {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', String(cx));
    c.setAttribute('cy', String(cy));
    c.setAttribute('r', String(r));
    c.setAttribute('fill', fill);
    c.setAttribute('stroke', stroke);
    c.setAttribute('stroke-width', sw);
    if (dash) c.setAttribute('stroke-dasharray', dash);
    return c;
  }

  function text(x: number, y: number, content: string, anchor: string): SVGTextElement {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', String(x));
    t.setAttribute('y', String(y));
    t.setAttribute('text-anchor', anchor);
    t.setAttribute('fill', 'rgba(0,255,65,0.3)');
    t.setAttribute('font-size', '2.5');
    t.setAttribute('font-family', 'monospace');
    t.textContent = content;
    return t;
  }

  // Crosshair lines (split at center to leave gap)
  svg.appendChild(line(0, 50, 42, 50, 'rgba(0,255,65,0.2)', '0.15'));
  svg.appendChild(line(58, 50, 100, 50, 'rgba(0,255,65,0.2)', '0.15'));
  svg.appendChild(line(50, 0, 50, 42, 'rgba(0,255,65,0.2)', '0.15'));
  svg.appendChild(line(50, 58, 50, 100, 'rgba(0,255,65,0.2)', '0.15'));

  // Inner crosshair ticks
  svg.appendChild(line(47, 50, 49, 50, 'rgba(0,255,65,0.35)', '0.2'));
  svg.appendChild(line(51, 50, 53, 50, 'rgba(0,255,65,0.35)', '0.2'));
  svg.appendChild(line(50, 47, 50, 49, 'rgba(0,255,65,0.35)', '0.2'));
  svg.appendChild(line(50, 51, 50, 53, 'rgba(0,255,65,0.35)', '0.2'));

  // Center dot
  svg.appendChild(circle(50, 50, 0.5, 'rgba(0,255,65,0.4)', 'none', '0'));

  // Compass labels
  svg.appendChild(text(50, 7, 'N', 'middle'));
  svg.appendChild(text(50, 96, 'S', 'middle'));
  svg.appendChild(text(5, 50.8, 'W', 'middle'));
  svg.appendChild(text(95, 50.8, 'E', 'middle'));

  // Cardinal tick marks
  svg.appendChild(line(50, 4, 50, 6.5, 'rgba(0,255,65,0.25)', '0.2'));
  svg.appendChild(line(50, 93.5, 50, 96, 'rgba(0,255,65,0.25)', '0.2'));
  svg.appendChild(line(93.5, 50, 96, 50, 'rgba(0,255,65,0.25)', '0.2'));
  svg.appendChild(line(4, 50, 6.5, 50, 'rgba(0,255,65,0.25)', '0.2'));

  // Ordinal tick marks
  svg.appendChild(line(81.5, 18.5, 83, 17, 'rgba(0,255,65,0.15)', '0.15'));  // NE
  svg.appendChild(line(17, 17, 18.5, 18.5, 'rgba(0,255,65,0.15)', '0.15'));  // NW
  svg.appendChild(line(81.5, 81.5, 83, 83, 'rgba(0,255,65,0.15)', '0.15'));  // SE
  svg.appendChild(line(17, 83, 18.5, 81.5, 'rgba(0,255,65,0.15)', '0.15')); // SW

  // Range rings
  svg.appendChild(circle(50, 50, 15, 'none', 'rgba(0,255,65,0.06)', '0.15', '1 2'));
  svg.appendChild(circle(50, 50, 30, 'none', 'rgba(0,255,65,0.06)', '0.15', '1 2'));

  // Vignette gradient
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const radGrad = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
  radGrad.setAttribute('id', 'scope-vignette');

  const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop1.setAttribute('offset', '60%');
  stop1.setAttribute('stop-color', 'transparent');

  const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop2.setAttribute('offset', '85%');
  stop2.setAttribute('stop-color', 'rgba(0,0,0,0.15)');

  const stop3 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop3.setAttribute('offset', '100%');
  stop3.setAttribute('stop-color', 'rgba(0,0,0,0.5)');

  radGrad.appendChild(stop1);
  radGrad.appendChild(stop2);
  radGrad.appendChild(stop3);
  defs.appendChild(radGrad);
  svg.appendChild(defs);

  const vigCircle = circle(50, 50, 50, 'url(#scope-vignette)', 'none', '0');
  svg.appendChild(vigCircle);

  return svg;
}

// ── CCTV Camera List Panel ────────────────────────────────────────
export function createCCTVPanel(
  container: HTMLElement,
  onCameraSelect: (cam: CCTVCamera) => void,
): {
  updateCameras: (cameras: CCTVCamera[], centerLat: number, centerLng: number) => void;
} {
  const section = el('div', 'panel-section');
  const labelRow = el('div');
  labelRow.style.display = 'flex';
  labelRow.style.justifyContent = 'space-between';
  labelRow.style.alignItems = 'center';
  const label = el('div', 'panel-label');
  label.textContent = 'CCTV FEEDS';
  const countEl = el('span', 'panel-label');
  labelRow.appendChild(label);
  labelRow.appendChild(countEl);
  section.appendChild(labelRow);

  // Preview box
  const preview = el('div', 'wv-cctv-preview');
  const previewEmpty = el('div', 'wv-cctv-preview-empty', 'SELECT CAMERA FEED');
  preview.appendChild(previewEmpty);
  section.appendChild(preview);

  // Camera list
  const listEl = el('div', 'wv-cctv-section');
  section.appendChild(listEl);

  container.appendChild(section);

  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  return {
    updateCameras(cameras: CCTVCamera[], centerLat: number, centerLng: number) {
      countEl.textContent = `(${cameras.length})`;
      listEl.innerHTML = '';

      // Sort by distance from center
      const sorted = [...cameras]
        .map((c) => ({ cam: c, dist: Math.sqrt((c.lat - centerLat) ** 2 + (c.lng - centerLng) ** 2) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 30);

      for (const { cam } of sorted) {
        const item = el('button', 'wv-cctv-item');
        const dot = el('span', 'wv-cctv-dot');
        const name = el('span', 'wv-cctv-name', cam.name);
        const city = el('span', 'wv-cctv-city', cam.city);
        item.appendChild(dot);
        item.appendChild(name);
        item.appendChild(city);
        item.addEventListener('click', () => {
          onCameraSelect(cam);
          // Update preview
          preview.innerHTML = '';
          if (cam.imageUrl) {
            const img = el('img') as HTMLImageElement;
            img.src = cam.imageUrl;
            img.alt = cam.name;
            img.onerror = () => {
              preview.innerHTML = '';
              preview.appendChild(el('div', 'wv-cctv-preview-empty', 'FEED UNAVAILABLE'));
            };
            preview.appendChild(img);
            const lbl = el('div', 'wv-cctv-preview-label', cam.name);
            preview.appendChild(lbl);
            // Auto-refresh every 30s
            if (refreshInterval) clearInterval(refreshInterval);
            refreshInterval = setInterval(() => {
              img.src = cam.imageUrl + '?t=' + Date.now();
            }, 30_000);
          } else {
            preview.appendChild(el('div', 'wv-cctv-preview-empty', 'NO FEED URL'));
          }
        });
        listEl.appendChild(item);
      }
    },
  };
}

// ── Classification banners ───────────────────────────────────────────────────
export function createClassificationBanner(position: 'top' | 'bottom'): HTMLElement {
  const div = el('div', `wv-classification-banner wv-classification-banner--${position}`);
  div.textContent = 'TOP SECRET // SI // TK // NOFORN';
  return div;
}

// ── Timeline bar ─────────────────────────────────────────────────────────────
export function createTimelineBar(): HTMLElement {
  const bar = el('div', 'wv-timeline-bar');

  const label = el('span', 'wv-timeline-label', 'T–00:00:00');
  const slider = el('input', 'wv-timeline-slider') as HTMLInputElement;
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = '100';

  const liveBtn = el('button', 'wv-timeline-live-btn wv-timeline-live-btn--active', 'LIVE');

  slider.addEventListener('input', () => {
    const v = parseInt(slider.value);
    if (v >= 99) {
      liveBtn.className = 'wv-timeline-live-btn wv-timeline-live-btn--active';
    } else {
      liveBtn.className = 'wv-timeline-live-btn';
      // calculate offset from now
      const minutesAgo = Math.round((100 - v) * 60 / 100);
      label.textContent = `T–${minutesAgo.toString().padStart(2, '0')}:00:00`;
    }
  });

  liveBtn.addEventListener('click', () => {
    slider.value = '100';
    label.textContent = 'T–00:00:00';
    liveBtn.className = 'wv-timeline-live-btn wv-timeline-live-btn--active';
  });

  bar.appendChild(label);
  bar.appendChild(slider);
  bar.appendChild(liveBtn);

  return bar;
}
