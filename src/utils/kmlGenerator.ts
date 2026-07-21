import { WGS84Point } from '../types';

function escapeXML(str: string): string {
  return str.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return char;
    }
  });
}

export function generateKML(points: WGS84Point[], name: string = 'Plano Polygon'): string {
  const safeName = escapeXML(name);
  
  // Ensure the polygon is closed
  const closedPoints = [...points];
  if (points.length > 0) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.lat !== last.lat || first.lng !== last.lng) {
      closedPoints.push({ ...first });
    }
  }

  const coordinatesStr = closedPoints.map(p => `${p.lng},${p.lat},0`).join(' ');

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${safeName}</name>
    <Placemark>
      <name>Plano Boundary</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              ${coordinatesStr}
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;

  return kml;
}
