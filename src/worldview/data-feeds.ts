import { fetchSatelliteTLEs, initSatRecs, propagatePositions } from '@/services/satellites';
import type { SatRecEntry, SatellitePosition } from '@/services/satellites';
import type { AircraftPosition, VesselPosition, WebcamMarker, CCTVCamera, FeedStatus } from './types';

// ── Aircraft (OpenSky Network) ──────────────────────────────────────────────
const OPENSKY_URL = 'https://opensky-network.org/api/states/all';
let lastOpenSkyFetch = 0;
const OPENSKY_MIN_INTERVAL = 12_000;

export async function fetchAircraft(): Promise<{ positions: AircraftPosition[]; status: FeedStatus }> {
  const now = Date.now();
  if (now - lastOpenSkyFetch < OPENSKY_MIN_INTERVAL) {
    return { positions: [], status: 'stale' };
  }
  try {
    const resp = await fetch(OPENSKY_URL, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return { positions: [], status: 'offline' };
    const json = await resp.json();
    lastOpenSkyFetch = Date.now();
    const states: unknown[][] = json.states ?? [];
    const positions: AircraftPosition[] = [];
    for (const s of states) {
      const lng = s[5] as number | null;
      const lat = s[6] as number | null;
      if (lng == null || lat == null || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      positions.push({
        icao24: String(s[0] ?? ''),
        callsign: String(s[1] ?? '').trim(),
        country: String(s[2] ?? ''),
        lat,
        lng,
        altitude: (s[7] as number) ?? 0,
        velocity: (s[9] as number) ?? 0,
        heading: (s[10] as number) ?? 0,
        onGround: Boolean(s[8]),
      });
    }
    return { positions, status: 'live' };
  } catch {
    return { positions: [], status: 'offline' };
  }
}

// ── Satellites (CelesTrak via WorldMonitor API) ─────────────────────────────
let satRecs: SatRecEntry[] | null = null;
let satInitPromise: Promise<void> | null = null;

async function ensureSatRecs(): Promise<SatRecEntry[]> {
  if (satRecs) return satRecs;
  if (!satInitPromise) {
    satInitPromise = (async () => {
      const tles = await fetchSatelliteTLEs();
      if (tles && tles.length > 0) {
        satRecs = initSatRecs(tles);
      } else {
        satRecs = [];
      }
    })();
  }
  await satInitPromise;
  return satRecs ?? [];
}

export async function fetchSatellitePositions(): Promise<{ positions: SatellitePosition[]; status: FeedStatus }> {
  try {
    const recs = await ensureSatRecs();
    if (recs.length === 0) return { positions: [], status: 'offline' };
    const positions = propagatePositions(recs);
    return { positions, status: 'live' };
  } catch {
    return { positions: [], status: 'offline' };
  }
}

export function propagateSatellitesSync(): SatellitePosition[] {
  if (!satRecs || satRecs.length === 0) return [];
  return propagatePositions(satRecs);
}

// ── Vessels (AIS via WorldMonitor) ──────────────────────────────────────────
export async function fetchVessels(): Promise<{ positions: VesselPosition[]; status: FeedStatus }> {
  try {
    const resp = await fetch('/api/ais-snapshot', { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return { positions: [], status: 'offline' };
    const json = await resp.json();
    const vessels: VesselPosition[] = (json.vessels ?? []).map((v: Record<string, unknown>) => ({
      mmsi: String(v.mmsi ?? ''),
      name: String(v.name ?? 'Unknown'),
      lat: Number(v.lat ?? 0),
      lng: Number(v.lon ?? v.lng ?? 0),
      speed: Number(v.speed ?? 0),
      heading: Number(v.heading ?? 0),
      type: String(v.type ?? 'cargo'),
    }));
    return { positions: vessels, status: vessels.length > 0 ? 'live' : 'offline' };
  } catch {
    return { positions: [], status: 'offline' };
  }
}

// ── Webcams (WorldMonitor API, fallback to static list) ─────────────────────
const FALLBACK_WEBCAMS: WebcamMarker[] = [
  { id: 'shibuya', title: 'Shibuya Crossing, Tokyo', lat: 35.6595, lng: 139.7004, previewUrl: '', category: 'traffic' },
  { id: 'timessq', title: 'Times Square, NYC', lat: 40.758, lng: -73.9855, previewUrl: '', category: 'traffic' },
  { id: 'eiffel', title: 'Eiffel Tower, Paris', lat: 48.8584, lng: 2.2945, previewUrl: '', category: 'landmark' },
  { id: 'dubai', title: 'Burj Khalifa, Dubai', lat: 25.1972, lng: 55.2744, previewUrl: '', category: 'landmark' },
  { id: 'abbey', title: 'Abbey Road, London', lat: 51.5320, lng: -0.1778, previewUrl: '', category: 'traffic' },
  { id: 'venice', title: 'Rialto Bridge, Venice', lat: 45.438, lng: 12.336, previewUrl: '', category: 'landmark' },
  { id: 'singapore', title: 'Marina Bay, Singapore', lat: 1.2814, lng: 103.8636, previewUrl: '', category: 'landmark' },
  { id: 'hongkong', title: 'Victoria Harbour, HK', lat: 22.2930, lng: 114.1694, previewUrl: '', category: 'landmark' },
];

export async function fetchWebcams(): Promise<{ markers: WebcamMarker[]; status: FeedStatus }> {
  try {
    const resp = await fetch('/api/webcam/v1/list-webcams', { signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) return { markers: FALLBACK_WEBCAMS, status: 'stale' };
    const json = await resp.json();
    const webcams: WebcamMarker[] = (json.webcams ?? []).map((w: Record<string, unknown>) => ({
      id: String(w.id ?? ''),
      title: String(w.title ?? ''),
      lat: Number(w.lat ?? w.latitude ?? 0),
      lng: Number(w.lon ?? w.lng ?? w.longitude ?? 0),
      previewUrl: String(w.preview_url ?? w.previewUrl ?? ''),
      category: String(w.category ?? 'other'),
    }));
    return { markers: webcams.length > 0 ? webcams : FALLBACK_WEBCAMS, status: webcams.length > 0 ? 'live' : 'stale' };
  } catch {
    return { markers: FALLBACK_WEBCAMS, status: 'stale' };
  }
}

// ── CCTV Traffic Cameras (Austin TX DOT + NYC DOT) ──────────────────────────
let cctvCache: CCTVCamera[] = [];
let cctvLastFetch = 0;
const CCTV_MIN_INTERVAL = 60_000;

async function fetchAustinCCTV(): Promise<CCTVCamera[]> {
  try {
    const resp = await fetch('https://its.txdot.gov/data/cctv_json/cctv_austin.json', { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    const cameras: CCTVCamera[] = [];
    const items = Array.isArray(data) ? data : data.cameras ?? data.cctv ?? [];
    for (const c of items) {
      const lat = Number(c.latitude ?? c.lat ?? 0);
      const lng = Number(c.longitude ?? c.lon ?? c.lng ?? 0);
      if (!lat || !lng) continue;
      cameras.push({
        id: `atx-${String(c.camera_id ?? c.id ?? cameras.length)}`,
        name: String(c.camera_name ?? c.name ?? c.location ?? 'Austin Camera'),
        lat,
        lng,
        imageUrl: String(c.image_url ?? c.snapshot_url ?? c.url ?? ''),
        city: 'Austin, TX',
        active: true,
      });
    }
    return cameras;
  } catch {
    return [];
  }
}

// NYC static known camera locations (NYCTMC cameras are numerous)
const NYC_STATIC_CAMS: CCTVCamera[] = [
  { id: 'nyc-1', name: 'FDR Drive @ 23rd St', lat: 40.7357, lng: -73.9750, imageUrl: '', city: 'NYC', active: true },
  { id: 'nyc-2', name: 'Times Square', lat: 40.7580, lng: -73.9855, imageUrl: '', city: 'NYC', active: true },
  { id: 'nyc-3', name: 'Brooklyn Bridge', lat: 40.7061, lng: -73.9969, imageUrl: '', city: 'NYC', active: true },
  { id: 'nyc-4', name: 'Holland Tunnel', lat: 40.7270, lng: -74.0117, imageUrl: '', city: 'NYC', active: true },
  { id: 'nyc-5', name: 'Lincoln Tunnel', lat: 40.7603, lng: -74.0023, imageUrl: '', city: 'NYC', active: true },
  { id: 'nyc-6', name: 'George Washington Bridge', lat: 40.8517, lng: -73.9527, imageUrl: '', city: 'NYC', active: true },
  { id: 'nyc-7', name: 'BQE @ Atlantic Ave', lat: 40.6840, lng: -73.9773, imageUrl: '', city: 'NYC', active: true },
  { id: 'nyc-8', name: 'FDR Drive @ 42nd St', lat: 40.7488, lng: -73.9690, imageUrl: '', city: 'NYC', active: true },
  { id: 'nyc-9', name: 'West Side Highway @ 57th', lat: 40.7694, lng: -73.9916, imageUrl: '', city: 'NYC', active: true },
  { id: 'nyc-10', name: 'Queens Midtown Tunnel', lat: 40.7439, lng: -73.9712, imageUrl: '', city: 'NYC', active: true },
  { id: 'nyc-11', name: 'Verrazano Bridge', lat: 40.6066, lng: -74.0447, imageUrl: '', city: 'NYC', active: true },
  { id: 'nyc-12', name: 'Cross Bronx Expwy @ Webster', lat: 40.8536, lng: -73.8906, imageUrl: '', city: 'NYC', active: true },
];

export async function fetchCCTVCameras(): Promise<{ cameras: CCTVCamera[]; status: FeedStatus }> {
  const now = Date.now();
  if (now - cctvLastFetch < CCTV_MIN_INTERVAL && cctvCache.length > 0) {
    return { cameras: cctvCache, status: 'live' };
  }
  try {
    const austinCams = await fetchAustinCCTV();
    cctvCache = [...austinCams, ...NYC_STATIC_CAMS];
    cctvLastFetch = Date.now();
    return { cameras: cctvCache, status: cctvCache.length > 0 ? 'live' : 'offline' };
  } catch {
    return { cameras: cctvCache.length > 0 ? cctvCache : NYC_STATIC_CAMS, status: 'stale' };
  }
}

/** Sort cameras by distance from a point, return nearest N */
export function nearestCameras(cameras: CCTVCamera[], lat: number, lng: number, limit = 20): CCTVCamera[] {
  return [...cameras]
    .map((c) => ({ cam: c, dist: Math.sqrt((c.lat - lat) ** 2 + (c.lng - lng) ** 2) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit)
    .map((x) => x.cam);
}
