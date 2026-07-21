export type CoordinateType = 'CRTM05' | 'Azimuth';

export interface CRTM05Point {
  id: string;
  x: number;
  y: number;
}

export interface AzimuthPoint {
  id: string;
  bearing: number; // in degrees
  distance: number; // in meters
}

export interface WGS84Point {
  lat: number;
  lng: number;
}

export interface PlanoData {
  type: CoordinateType;
  crtm05?: CRTM05Point[];
  azimuth?: AzimuthPoint[];
  referencePoint?: WGS84Point;
}

export interface ProcessingResult {
  success: boolean;
  message?: string;
  data?: PlanoData;
  wgs84Points?: WGS84Point[];
}
