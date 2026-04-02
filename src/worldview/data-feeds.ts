import { fetchSatelliteTLEs, initSatRecs, propagatePositions } from '@/services/satellites';
import type { SatRecEntry, SatellitePosition } from '@/services/satellites';
import type { AircraftPosition, VesselPosition, WebcamMarker, FeedStatus } from './types';

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
