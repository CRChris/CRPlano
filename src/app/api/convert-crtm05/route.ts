import { NextRequest, NextResponse } from 'next/server';
import { convertCRTM05ToWGS84 } from '@/utils/coordinates';
import { CRTM05Point } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const points: CRTM05Point[] = body.points;

    if (!points || !Array.isArray(points)) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    if (points.length > 1000) {
      return NextResponse.json({ error: 'Too many points. Maximum allowed is 1000.' }, { status: 413 });
    }

    for (const pt of points) {
      if (typeof pt.x !== 'number' || !Number.isFinite(pt.x) || typeof pt.y !== 'number' || !Number.isFinite(pt.y)) {
        return NextResponse.json({ error: 'Invalid coordinate value. x and y must be finite numbers.' }, { status: 400 });
      }
    }

    const wgs84Points = convertCRTM05ToWGS84(points);

    return NextResponse.json({ success: true, data: wgs84Points });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
