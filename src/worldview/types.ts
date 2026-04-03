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

/** CCTV camera from DOT traffic feeds */
export interface CCTVCamera {
  id: string;
  name: string;
  lat: number;
  lng: number;
  imageUrl: string;
  city: string;
  active: boolean;
}

/** Four render modes matching the reference design */
export type ViewMode = 'eo' | 'flir' | 'crt' | 'nightvision';

export type MapStyleKey = 'dark' | 'terrain' | 'satellite';

export interface LayerVisibility {
  aircraft: boolean;
  satellites: boolean;
  vessels: boolean;
  webcams: boolean;
  cctv: boolean;
}

export interface LayerCounts {
  aircraft: number;
  satellites: number;
  vessels: number;
  webcams: number;
  cctv: number;
}

export type FeedStatus = 'live' | 'stale' | 'offline';

export interface FeedStates {
  opensky: FeedStatus;
  celestrak: FeedStatus;
  ais: FeedStatus;
  webcam: FeedStatus;
  cctv: FeedStatus;
}

export interface MarkerClickPayload {
  type: 'aircraft' | 'satellite' | 'vessel' | 'webcam' | 'cctv';
  data: Record<string, unknown>;
}
