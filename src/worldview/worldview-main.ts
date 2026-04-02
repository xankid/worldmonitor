import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/main.css';
import './worldview.css';

import { GlobeRenderer } from './globe-renderer';
import { fetchAircraft, fetchSatellitePositions, propagateSatellitesSync, fetchVessels, fetchWebcams } from './data-feeds';
import { applyShaderMode } from './shader-effects';
import { createTopBar, createLayerControls, createShaderSelector, createInfoPanel, createStatusBar } from './hud-panels';
import type { LayerVisibility, LayerCounts, FeedStates, ShaderMode } from './types';

// ── State ───────────────────────────────────────────────────────────────────
const layerCounts: LayerCounts = { aircraft: 0, satellites: 0, vessels: 0, webcams: 0 };
const feedStates: FeedStates = { opensky: 'offline', celestrak: 'offline', ais: 'offline', webcam: 'offline' };
let globe: GlobeRenderer | null = null;

// ── Bootstrap ───────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  const app = document.getElementById('worldview-app');
  if (!app) return;

  // Create map container
  const mapContainer = document.createElement('div');
  mapContainer.className = 'wv-map-container';
  app.appendChild(mapContainer);

  // Create HUD container (pointer-events: none, children get pointer-events: auto)
  const hud = document.createElement('div');
  hud.className = 'wv-hud';
  app.appendChild(hud);

  // Initialize globe renderer
  globe = new GlobeRenderer(mapContainer);

  // ── HUD Panels ──────────────────────────────────────────────────────────
  const topBar = createTopBar(hud);

  const layerControls = createLayerControls(
    hud,
    { aircraft: true, satellites: true, vessels: true, webcams: true },
    (layer: keyof LayerVisibility, enabled: boolean) => {
      globe?.setLayerVisibility({ [layer]: enabled });
    },
  );

  createShaderSelector(hud, (mode: ShaderMode) => {
    applyShaderMode(app, mode);
  });

  const infoPanel = createInfoPanel(hud);

  const statusBar = createStatusBar(hud);

  // ── Globe event handlers ────────────────────────────────────────────────
  globe.onMove(({ lat, lng, zoom }) => {
    statusBar.updateCursor(lat, lng, zoom);
  });

  globe.onClick((payload) => {
    infoPanel.show(payload);
  });

  // ── Clock tick ──────────────────────────────────────────────────────────
  setInterval(() => {
    topBar.updateClock();
    statusBar.updateTime();
  }, 1000);

  // ── Data Feeds ──────────────────────────────────────────────────────────

  // Aircraft: fetch every 15 seconds (OpenSky rate limit: 10s for anon)
  async function refreshAircraft(): Promise<void> {
    const { positions, status } = await fetchAircraft();
    feedStates.opensky = status;
    if (positions.length > 0) {
      layerCounts.aircraft = positions.length;
      globe?.updateAircraft(positions);
    }
    statusBar.updateFeeds(feedStates);
    statusBar.updateCounts(layerCounts);
    layerControls.updateCounts(layerCounts);
  }

  // Satellites: init TLEs, then propagate every 3 seconds
  async function initSatellites(): Promise<void> {
    const { positions, status } = await fetchSatellitePositions();
    feedStates.celestrak = status;
    if (positions.length > 0) {
      layerCounts.satellites = positions.length;
      globe?.updateSatellites(positions);
    }
    statusBar.updateFeeds(feedStates);
    statusBar.updateCounts(layerCounts);
    layerControls.updateCounts(layerCounts);

    // Propagation loop (satellite.js, no network call)
    setInterval(() => {
      const propagated = propagateSatellitesSync();
      if (propagated.length > 0) {
        layerCounts.satellites = propagated.length;
        globe?.updateSatellites(propagated);
        layerControls.updateCounts(layerCounts);
        statusBar.updateCounts(layerCounts);
      }
    }, 3000);
  }

  // Vessels: fetch every 30 seconds
  async function refreshVessels(): Promise<void> {
    const { positions, status } = await fetchVessels();
    feedStates.ais = status;
    if (positions.length > 0) {
      layerCounts.vessels = positions.length;
      globe?.updateVessels(positions);
    }
    statusBar.updateFeeds(feedStates);
    statusBar.updateCounts(layerCounts);
    layerControls.updateCounts(layerCounts);
  }

  // Webcams: fetch once, refresh every 5 minutes
  async function refreshWebcams(): Promise<void> {
    const { markers, status } = await fetchWebcams();
    feedStates.webcam = status;
    layerCounts.webcams = markers.length;
    globe?.updateWebcams(markers);
    statusBar.updateFeeds(feedStates);
    statusBar.updateCounts(layerCounts);
    layerControls.updateCounts(layerCounts);
  }

  // ── Kick off all feeds ────────────────────────────────────────────────
  void refreshAircraft();
  void initSatellites();
  void refreshVessels();
  void refreshWebcams();

  setInterval(() => void refreshAircraft(), 15_000);
  setInterval(() => void refreshVessels(), 30_000);
  setInterval(() => void refreshWebcams(), 300_000);

  // Initial status bar state
  statusBar.updateFeeds(feedStates);
  statusBar.updateCounts(layerCounts);
  statusBar.updateCursor(20, 30, 2.5);
}

void init().catch(console.error);
