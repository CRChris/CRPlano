import proj4 from 'proj4';
import { WGS84Point, CRTM05Point, AzimuthPoint } from '../types';

// CRTM05 EPSG:5367 projection definition
const CRTM05_PROJ = '+proj=tmerc +lat_0=0 +lon_0=-84 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +units=m +no_defs';

export function convertCRTM05ToWGS84(points: CRTM05Point[]): WGS84Point[] {
  return points.map(p => {
    const [lng, lat] = proj4(CRTM05_PROJ, 'EPSG:4326', [p.x, p.y]);
    return { lat, lng };
  });
}

// Convert degrees to radians
const toRadians = (degrees: number) => degrees * Math.PI / 180;
// Convert radians to degrees
const toDegrees = (radians: number) => radians * 180 / Math.PI;

// Earth radius in meters
const R = 6371000;

export function convertAzimuthToWGS84(points: AzimuthPoint[], reference: WGS84Point): WGS84Point[] {
  const result: WGS84Point[] = [];
  let currentLat = reference.lat;
  let currentLng = reference.lng;

  // Add the starting point
  result.push({ lat: currentLat, lng: currentLng });

  for (const p of points) {
    const lat1 = toRadians(currentLat);
    const lng1 = toRadians(currentLng);
    const bearing = toRadians(p.bearing);
    const distance = p.distance;

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distance / R) +
      Math.cos(lat1) * Math.sin(distance / R) * Math.cos(bearing)
    );

    const lng2 = lng1 + Math.atan2(
      Math.sin(bearing) * Math.sin(distance / R) * Math.cos(lat1),
      Math.cos(distance / R) - Math.sin(lat1) * Math.sin(lat2)
    );

    currentLat = toDegrees(lat2);
    currentLng = toDegrees(lng2);
    
    result.push({ lat: currentLat, lng: currentLng });
  }

  return result;
}

export function isWithinCostaRica(points: WGS84Point[]): boolean {
  // Costa Rica rough bounds: lat 8-11°N, lng -86 to -82°W
  return points.every(p => p.lat >= 8 && p.lat <= 11 && p.lng >= -86 && p.lng <= -82);
}
