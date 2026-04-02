import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/main.css';
import './worldview.css';

import { GlobeRenderer } from './globe-renderer';
import { fetchAircraft, fetchSatellitePositions, propagateSatellitesSync, fetchVessels, fetchWebcams } from './data-feeds';
import { applyShaderMode } from './shader-effects';
import {
  createTopBar,
  createLeftPanel,
  createRightPanel,
  createTelemetryBlock,
  createBottomBar,
  createInfoPanel,
  createStatusBar,
} from './hud-panels';
import type { LayerVisibility, LayerCounts, FeedStates, ShaderMode } from './types';

// ── State ───────────────────────────────────────────────────────────────────
const layerCounts: LayerCounts = { aircraft: 0, satellites: 0, vessels: 0, webcams: 0 };
const feedStates: FeedStates = { opensky: 'offline', celestrak: 'offline', ais: 'offline', webcam: 'offline' };
let globe: GlobeRenderer | null = null;

// ── Bootstrap ───────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  const app = document.getElementById('worldview-app');
  if (!app) return;

  // Map container
  const mapContainer = document.createElement('div');
  mapContainer.className = 'wv-map-container';
  app.appendChild(mapContainer);

  // HUD overlay
  const hud = document.createElement('div');
  hud.className = 'wv-hud';
  app.appendChild(hud);

  // Globe renderer
  globe = new GlobeRenderer(mapContainer);

  // ── HUD Panels ──────────────────────────────────────────────────────────
  const topBar = createTopBar(hud);

  const leftPanel = createLeftPanel(
    hud,
    { aircraft: true, satellites: true, vessels: true, webcams: true },
    (layer: keyof LayerVisibility, enabled: boolean) => {
      globe?.setLayerVisibility({ [layer]: enabled });
    },
  );

  createRightPanel(hud);

  const telemetry = createTelemetryBlock(hud);

  createBottomBar(
    hud,
    (mode: ShaderMode) => { applyShaderMode(app, mode); },
    (lat: number, lng: number, zoom: number) => { globe?.flyTo(lat, lng, zoom); },
  );

  const infoPanel = createInfoPanel(hud);
  const statusBar = createStatusBar(hud);

  // ── Globe events ────────────────────────────────────────────────────────
  globe.onMove(({ lat, lng, zoom }) => {
    statusBar.updateCursor(lat, lng, zoom);
    // Estimate altitude from zoom (rough: alt = 40000000 / 2^zoom meters)
    const altM = 40_000_000 / Math.pow(2, zoom);
    telemetry.update(altM, zoom);
  });

  globe.onClick((payload) => { infoPanel.show(payload); });

  // ── Clock ───────────────────────────────────────────────────────────────
  setInterval(() => {
    topBar.updateClock();
    statusBar.updateTime();
  }, 1000);

  // ── Data Feeds ──────────────────────────────────────────────────────────
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
    // Propagation loop (local math, no network)
    setInterval(() => {
      const propagated = propagateSatellitesSync();
      if (propagated.length > 0) {
        layerCounts.satellites = propagated.length;
        globe?.updateSatellites(propagated);
        leftPanel.updateCounts(layerCounts);
        statusBar.updateCounts(layerCounts);
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

  function syncHud(): void {
    statusBar.updateFeeds(feedStates);
    statusBar.updateCounts(layerCounts);
    leftPanel.updateCounts(layerCounts);
  }

  // ── Kick off ────────────────────────────────────────────────────────────
  void refreshAircraft();
  void initSatellites();
  void refreshVessels();
  void refreshWebcams();

  setInterval(() => void refreshAircraft(), 15_000);
  setInterval(() => void refreshVessels(), 30_000);
  setInterval(() => void refreshWebcams(), 300_000);

  syncHud();
  statusBar.updateCursor(20, 30, 2.5);
}

void init().catch(console.error);
