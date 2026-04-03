import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import type { SatellitePosition } from '@/services/satellites';
import type { AircraftPosition, VesselPosition, WebcamMarker, CCTVCamera, MarkerClickPayload } from './types';

const SAT_COLORS: Record<string, [number, number, number]> = {
  CN: [255, 32, 32],
  RU: [255, 136, 0],
  US: [68, 136, 255],
  EU: [68, 204, 68],
  KR: [170, 102, 255],
  IN: [255, 102, 170],
  OTHER: [204, 204, 255],
};

function satColor(country: string): [number, number, number] {
  return SAT_COLORS[country] ?? SAT_COLORS.OTHER;
}

export class GlobeRenderer {
  private map: maplibregl.Map;
  private overlay: MapboxOverlay;
  private aircraft: AircraftPosition[] = [];
  private satellites: SatellitePosition[] = [];
  private vessels: VesselPosition[] = [];
  private webcams: WebcamMarker[] = [];
  private cctv: CCTVCamera[] = [];
  private visibleLayers = { aircraft: true, satellites: true, vessels: true, webcams: true, cctv: true };
  private clickCallback: ((payload: MarkerClickPayload) => void) | null = null;
  private moveCallback: ((data: { lat: number; lng: number; zoom: number }) => void) | null = null;

  constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [30, 20],
      zoom: 2.5,
      projection: 'globe' as unknown as maplibregl.ProjectionSpecification,
      antialias: true,
      attributionControl: false,
    });

    this.overlay = new MapboxOverlay({
      interleaved: false,
      onClick: (info: PickingInfo) => this.handleClick(info),
    });

    this.map.addControl(this.overlay as unknown as maplibregl.IControl);
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: false }), 'bottom-right');

    this.map.on('move', () => {
      if (this.moveCallback) {
        const center = this.map.getCenter();
        this.moveCallback({ lat: center.lat, lng: center.lng, zoom: this.map.getZoom() });
      }
    });

    // Set atmosphere/sky on style load
    this.map.on('style.load', () => {
      try {
        this.map.setSky({ 'sky-color': '#0a0f0a', 'sky-horizon-blend': 0.5 });
      } catch { /* older style may not support sky */ }
    });
  }

  private handleClick(info: PickingInfo): void {
    if (!info.object || !this.clickCallback) return;
    const obj = info.object as Record<string, unknown>;
    if (obj._wvType === 'aircraft') {
      this.clickCallback({ type: 'aircraft', data: obj });
    } else if (obj._wvType === 'satellite') {
      this.clickCallback({ type: 'satellite', data: obj });
    } else if (obj._wvType === 'vessel') {
      this.clickCallback({ type: 'vessel', data: obj });
    } else if (obj._wvType === 'webcam') {
      this.clickCallback({ type: 'webcam', data: obj });
    } else if (obj._wvType === 'cctv') {
      this.clickCallback({ type: 'cctv', data: obj });
    }
  }

  setLayerVisibility(layers: Record<string, boolean>): void {
    this.visibleLayers = { ...this.visibleLayers, ...layers };
    this.rebuildLayers();
  }

  updateAircraft(positions: AircraftPosition[]): void {
    this.aircraft = positions;
    this.rebuildLayers();
  }

  updateSatellites(positions: SatellitePosition[]): void {
    this.satellites = positions;
    this.rebuildLayers();
  }

  updateVessels(positions: VesselPosition[]): void {
    this.vessels = positions;
    this.rebuildLayers();
  }

  updateWebcams(markers: WebcamMarker[]): void {
    this.webcams = markers;
    this.rebuildLayers();
  }

  updateCCTV(cameras: CCTVCamera[]): void {
    this.cctv = cameras;
    this.rebuildLayers();
  }

  private rebuildLayers(): void {
    const layers = [];

    if (this.visibleLayers.satellites && this.satellites.length > 0) {
      // Orbital trails
      const trailData = this.satellites
        .filter((s) => s.trail && s.trail.length > 1)
        .map((s) => ({
          path: [[s.lng, s.lat, s.alt * 1000], ...s.trail.map((t) => [t[0], t[1], (t[2] ?? s.alt) * 1000])],
          country: s.country,
        }));
      layers.push(
        new PathLayer({
          id: 'wv-sat-trails',
          data: trailData,
          getPath: (d: (typeof trailData)[0]) => d.path as [number, number, number][],
          getColor: (d: (typeof trailData)[0]) => [...satColor(d.country), 80],
          getWidth: 1,
          widthMinPixels: 1,
          widthMaxPixels: 2,
          pickable: false,
        }),
      );
      // Satellite dots
      layers.push(
        new ScatterplotLayer({
          id: 'wv-satellites',
          data: this.satellites.map((s) => ({ ...s, _wvType: 'satellite' })),
          getPosition: (d: SatellitePosition) => [d.lng, d.lat],
          getFillColor: (d: SatellitePosition) => [...satColor(d.country), 220],
          getRadius: 40000,
          radiusMinPixels: 3,
          radiusMaxPixels: 8,
          pickable: true,
        }),
      );
    }

    if (this.visibleLayers.aircraft && this.aircraft.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: 'wv-aircraft',
          data: this.aircraft.filter((a) => !a.onGround).map((a) => ({ ...a, _wvType: 'aircraft' })),
          getPosition: (d: AircraftPosition) => [d.lng, d.lat, d.altitude],
          getFillColor: [255, 140, 0, 200],
          getRadius: 20000,
          radiusMinPixels: 2,
          radiusMaxPixels: 5,
          pickable: true,
        }),
      );
    }

    if (this.visibleLayers.vessels && this.vessels.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: 'wv-vessels',
          data: this.vessels.map((v) => ({ ...v, _wvType: 'vessel' })),
          getPosition: (d: VesselPosition) => [d.lng, d.lat],
          getFillColor: [0, 204, 204, 200],
          getRadius: 30000,
          radiusMinPixels: 2,
          radiusMaxPixels: 6,
          pickable: true,
        }),
      );
    }

    if (this.visibleLayers.webcams && this.webcams.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: 'wv-webcams',
          data: this.webcams.map((w) => ({ ...w, _wvType: 'webcam' })),
          getPosition: (d: WebcamMarker) => [d.lng, d.lat],
          getFillColor: [255, 204, 0, 200],
          getRadius: 25000,
          radiusMinPixels: 3,
          radiusMaxPixels: 7,
          pickable: true,
        }),
      );
    }

    if (this.visibleLayers.cctv && this.cctv.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: 'wv-cctv',
          data: this.cctv.map((c) => ({ ...c, _wvType: 'cctv' })),
          getPosition: (d: CCTVCamera) => [d.lng, d.lat],
          getFillColor: [255, 100, 0, 200],
          getRadius: 15000,
          radiusMinPixels: 3,
          radiusMaxPixels: 8,
          pickable: true,
        }),
      );
    }

    this.overlay.setProps({ layers });
  }

  flyTo(lat: number, lng: number, zoom: number): void {
    this.map.flyTo({ center: [lng, lat], zoom, duration: 2000 });
  }

  getCenter(): { lat: number; lng: number } {
    const c = this.map.getCenter();
    return { lat: c.lat, lng: c.lng };
  }

  getZoom(): number {
    return this.map.getZoom();
  }

  onMove(callback: (data: { lat: number; lng: number; zoom: number }) => void): void {
    this.moveCallback = callback;
  }

  onClick(callback: (payload: MarkerClickPayload) => void): void {
    this.clickCallback = callback;
  }

  destroy(): void {
    this.overlay.finalize();
    this.map.remove();
  }
}
