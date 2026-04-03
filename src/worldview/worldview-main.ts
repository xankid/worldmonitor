import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/main.css';
import './worldview.css';

import { GlobeRenderer } from './globe-renderer';
import { fetchAircraft, fetchSatellitePositions, propagateSatellitesSync, fetchVessels, fetchWebcams, fetchCCTVCameras } from './data-feeds';
import { applyViewMode } from './shader-effects';
import {
  createLeftPanel,
  createRightPanel,
  createScopeOverlay,
  createClassificationBanner,
  createTimelineBar,
  createCCTVPanel,
} from './hud-panels';
import type { CCTVCamera } from './types';
import type { LayerVisibility, LayerCounts, FeedStates, ViewMode } from './types';

// ── State ───────────────────────────────────────────────────────────────────
const layerCounts: LayerCounts = { aircraft: 0, satellites: 0, vessels: 0, webcams: 0, cctv: 0 };
const feedStates: FeedStates = { opensky: 'offline', celestrak: 'offline', ais: 'offline', webcam: 'offline', cctv: 'offline' };
let cctvCameras: CCTVCamera[] = [];
let globe: GlobeRenderer | null = null;
let currentViewMode: ViewMode = 'eo';

// ── Bootstrap ───────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  const app = document.getElementById('worldview-app');
  if (!app) return;

  // ── Top classification banner ──────────────────────────────────────────
  const topBanner = createClassificationBanner('top');
  app.appendChild(topBanner);

  // ── 3-column layout ────────────────────────────────────────────────────
  const layout = document.createElement('div');
  layout.className = 'wv-layout';
  app.appendChild(layout);

  // ── Bottom classification banner ───────────────────────────────────────
  const bottomBanner = createClassificationBanner('bottom');
  app.appendChild(bottomBanner);

  // ── LEFT PANEL ─────────────────────────────────────────────────────────
  const leftControls = createLeftPanel(
    layout,
    { aircraft: true, satellites: true, vessels: true, webcams: true },
    (layer: keyof LayerVisibility, enabled: boolean) => {
      globe?.setLayerVisibility({ [layer]: enabled });
    },
    (mode: ViewMode) => {
      currentViewMode = mode;
      if (scopeViewport && mapContainer) {
        applyViewMode(scopeViewport, mapContainer, mode);
      }
      rightControls.setViewMode(mode);
    },
    (lat: number, lon: number) => {
      globe?.flyTo(lat, lon, 2000000);
    },
  );

  // ── CENTER column ──────────────────────────────────────────────────────
  const center = document.createElement('div');
  center.className = 'wv-center';
  layout.appendChild(center);

  // Scope container (circular viewport)
  const scopeContainer = document.createElement('div');
  scopeContainer.className = 'wv-scope-container';
  center.appendChild(scopeContainer);

  const scopeViewport = document.createElement('div');
  scopeViewport.className = 'wv-scope-viewport';
  scopeContainer.appendChild(scopeViewport);

  // Map container inside the circular clip
  const mapContainer = document.createElement('div');
  mapContainer.className = 'wv-map-container';
  scopeViewport.appendChild(mapContainer);

  // Scope SVG overlay (crosshairs, range rings, compass, vignette)
  const scopeOverlaySvg = createScopeOverlay();
  scopeContainer.appendChild(scopeOverlaySvg);

  // Timeline bar below the scope
  const timelineBar = createTimelineBar();
  center.appendChild(timelineBar);

  // Nav back link
  const navBack = document.createElement('a');
  navBack.className = 'wv-nav-back';
  navBack.href = '/';
  navBack.textContent = '← MONITOR';
  app.appendChild(navBack);

  // ── CCTV Panel (in left panel, after layers) ─────────────────────────────
  const leftInner = layout.querySelector('.wv-panel-left-inner') as HTMLElement;
  const cctvPanel = createCCTVPanel(
    leftInner,
    (cam: CCTVCamera) => {
      globe?.flyTo(cam.lat, cam.lng, 14);
    },
  );

  // ── RIGHT PANEL ────────────────────────────────────────────────────────
  const rightControls = createRightPanel(layout);

  // ── Globe renderer ─────────────────────────────────────────────────────
  globe = new GlobeRenderer(mapContainer);

  // ── Globe events ───────────────────────────────────────────────────────
  globe.onMove(({ lat, lng }) => {
    rightControls.updatePosition(lat, lng);
  });

  globe.onClick((payload) => {
    rightControls.showEntity(payload);
  });

  // ── Clock ──────────────────────────────────────────────────────────────
  setInterval(() => {
    rightControls.updateClock();
  }, 1000);

  // ── Data Feeds ─────────────────────────────────────────────────────────
  async function refreshAircraft(): Promise<void> {
    const { positions, status } = await fetchAircraft();
    feedStates.opensky = status;
    if (positions.length > 0) {
      layerCounts.aircraft = positions.length;
      globe?.updateAircraft(positions);
    }
    syncHud();
  }

  async function initSatellites(): Promise<void> {
    const { positions, status } = await fetchSatellitePositions();
    feedStates.celestrak = status;
    if (positions.length > 0) {
      layerCounts.satellites = positions.length;
      globe?.updateSatellites(positions);
    }
    syncHud();
    // Propagation loop
    setInterval(() => {
      const propagated = propagateSatellitesSync();
      if (propagated.length > 0) {
        layerCounts.satellites = propagated.length;
        globe?.updateSatellites(propagated);
        leftControls.updateCounts(layerCounts);
      }
    }, 3000);
  }

  async function refreshVessels(): Promise<void> {
    const { positions, status } = await fetchVessels();
    feedStates.ais = status;
    if (positions.length > 0) {
      layerCounts.vessels = positions.length;
      globe?.updateVessels(positions);
    }
    syncHud();
  }

  async function refreshWebcams(): Promise<void> {
    const { markers, status } = await fetchWebcams();
    feedStates.webcam = status;
    layerCounts.webcams = markers.length;
    globe?.updateWebcams(markers);
    syncHud();
  }

  async function refreshCCTV(): Promise<void> {
    const { cameras, status } = await fetchCCTVCameras();
    feedStates.cctv = status;
    layerCounts.cctv = cameras.length;
    cctvCameras = cameras;
    globe?.updateCCTV(cameras);
    const center = globe?.getCenter() ?? { lat: 30, lng: -97 };
    cctvPanel.updateCameras(cameras, center.lat, center.lng);
    syncHud();
  }

  function syncHud(): void {
    leftControls.updateCounts(layerCounts);
  }

  // ── Kick off ───────────────────────────────────────────────────────────
  void refreshAircraft();
  void initSatellites();
  void refreshVessels();
  void refreshWebcams();
  void refreshCCTV();

  setInterval(() => void refreshAircraft(), 15_000);
  setInterval(() => void refreshVessels(), 30_000);
  setInterval(() => void refreshWebcams(), 300_000);
  setInterval(() => void refreshCCTV(), 120_000);

  // Update CCTV list on map move (sorted by distance from center)
  let cctvUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  globe?.onMove(({ lat, lng }) => {
    if (cctvUpdateTimer) clearTimeout(cctvUpdateTimer);
    cctvUpdateTimer = setTimeout(() => {
      if (cctvCameras.length > 0) {
        cctvPanel.updateCameras(cctvCameras, lat, lng);
      }
    }, 500);
  });

  syncHud();
}

void init().catch(console.error);
