'use client';

import { MapContainer, TileLayer, Polygon, Marker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { WGS84Point } from '@/types';
import { useEffect } from 'react';
import L from 'leaflet';

interface MapPreviewProps {
  points: WGS84Point[];
  onPointClick?: (index: number) => void;
}

export default function MapPreview({ points, onPointClick }: MapPreviewProps) {
  useEffect(() => {
    // Fix leafet marker icon issue globally just in case
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: '/images/marker-icon-2x.png',
      iconUrl: '/images/marker-icon.png',
      shadowUrl: '/images/marker-shadow.png',
    });
  }, []);

  // Make markers 60% smaller (40% of original size)
  const smallIcon = new L.Icon({
    iconUrl: '/images/marker-icon.png',
    iconRetinaUrl: '/images/marker-icon-2x.png',
    shadowUrl: '/images/marker-shadow.png',
    iconSize: [10, 16.4],
    iconAnchor: [5, 16.4],
    popupAnchor: [0, -16.4],
    shadowSize: [16.4, 16.4]
  });

  if (!points || points.length === 0) return null;

  const positions: [number, number][] = points.map(p => [p.lat, p.lng]);
  
  // Calculate bounds
  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)]
  ];

  return (
    <MapContainer bounds={bounds} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Polygon positions={positions} color="blue" />
      {positions.map((pos, index) => (
        <Marker 
          key={index} 
          position={pos}
          icon={smallIcon}
          eventHandlers={{
            click: () => onPointClick && onPointClick(index),
          }}
        />
      ))}
    </MapContainer>
  );
}
