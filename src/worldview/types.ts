export interface AircraftPosition {
  icao24: string;
  callsign: string;
  country: string;
  lat: number;
  lng: number;
  altitude: number;
  velocity: number;
  heading: number;
  onGround: boolean;
}

export interface VesselPosition {
  mmsi: string;
  name: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  type: string;
}

export interface WebcamMarker {
  id: string;
  title: string;
  lat: number;
  lng: number;
  previewUrl: string;
  category: string;
}

export type ShaderMode = 'normal' | 'nightvision' | 'thermal' | 'crt' | 'anime' | 'noir' | 'blueprint';

export interface LayerVisibility {
  aircraft: boolean;
  satellites: boolean;
  vessels: boolean;
  webcams: boolean;
}

export interface LayerCounts {
  aircraft: number;
  satellites: number;
  vessels: number;
  webcams: number;
}

export type FeedStatus = 'live' | 'stale' | 'offline';

export interface FeedStates {
  opensky: FeedStatus;
  celestrak: FeedStatus;
  ais: FeedStatus;
  webcam: FeedStatus;
}

export interface MarkerClickPayload {
  type: 'aircraft' | 'satellite' | 'vessel' | 'webcam';
  data: Record<string, unknown>;
}
