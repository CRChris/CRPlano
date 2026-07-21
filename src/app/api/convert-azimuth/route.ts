import { NextRequest, NextResponse } from 'next/server';
import { convertAzimuthToWGS84 } from '@/utils/coordinates';
import { AzimuthPoint, WGS84Point } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const points: AzimuthPoint[] = body.points;
    const reference: WGS84Point = body.reference;

    if (!points || !Array.isArray(points)) {
      return NextResponse.json({ error: 'Invalid input for points' }, { status: 400 });
    }

    if (points.length > 1000) {
      return NextResponse.json({ error: 'Too many points. Maximum allowed is 1000.' }, { status: 413 });
    }

    for (const pt of points) {
      if (typeof pt.bearing !== 'number' || !Number.isFinite(pt.bearing) || typeof pt.distance !== 'number' || !Number.isFinite(pt.distance)) {
        return NextResponse.json({ error: 'Invalid point value. Bearing and distance must be finite numbers.' }, { status: 400 });
      }
    }

    if (!reference || typeof reference.lat !== 'number' || !Number.isFinite(reference.lat) || typeof reference.lng !== 'number' || !Number.isFinite(reference.lng)) {
      return NextResponse.json({ error: 'Azimuth plano requires a valid reference point — please provide finite lat/lng' }, { status: 400 });
    }

    const wgs84Points = convertAzimuthToWGS84(points, reference);

    return NextResponse.json({ success: true, data: wgs84Points });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
