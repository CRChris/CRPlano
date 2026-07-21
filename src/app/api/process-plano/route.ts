import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { convertCRTM05ToWGS84, convertAzimuthToWGS84 } from '@/utils/coordinates';
import { PlanoData } from '@/types';

// Increase body size limit for App Router (Next.js 13+)
// Since config api bodyParser is for Pages router, for App router we just handle large requests.
// Wait, actually there's no built-in way to limit body size declaratively like that in App Router,
// but we can check the size manually if we want, or just let Vercel handle the max limit.

import { LRUCache } from 'lru-cache';

// Simple in-memory rate limiter: max 500 IPs, resets every 15 minutes
const rateLimit = new LRUCache({
  max: 500,
  ttl: 15 * 60 * 1000, 
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const schema = {
  type: Type.OBJECT,
  properties: {
    found: {
      type: Type.BOOLEAN,
      description: "True if a coordinate table was found, false otherwise."
    },
    ambiguous: {
      type: Type.BOOLEAN,
      description: "True if both CRTM05 and Azimuth markers were detected, making the system ambiguous."
    },
    type: {
      type: Type.STRING,
      enum: ["CRTM05", "Azimuth"],
      description: "The coordinate system detected. Must be either 'CRTM05' or 'Azimuth'."
    },
    crtm05Points: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          x: { type: Type.NUMBER },
          y: { type: Type.NUMBER }
        }
      },
      description: "Array of CRTM05 coordinates if type is CRTM05."
    },
    azimuthPoints: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          bearing: { type: Type.NUMBER, description: "Bearing/azimuth in degrees." },
          distance: { type: Type.NUMBER, description: "Distance in meters." }
        }
      },
      description: "Array of Azimuth/Distance points if type is Azimuth."
    }
  }
};

export async function POST(req: NextRequest) {
  try {
    // Rate limiting: max 10 requests per 15 minutes per IP
    const ip = req.ip || req.headers.get('x-forwarded-for') || 'unknown';
    const count = (rateLimit.get(ip) as number) || 0;
    if (count >= 10) {
      return NextResponse.json({ error: 'Rate limit exceeded. Please try again later.' }, { status: 429 });
    }
    rateLimit.set(ip, count + 1);

    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds 10MB limit' }, { status: 413 });
    }

    const arrayBuffer = await file.arrayBuffer();
    
    // Magic byte validation for PDF, PNG, and JPEG
    const bytes = new Uint8Array(arrayBuffer.slice(0, 4));
    let isValidType = false;
    // PDF: 25 50 44 46
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) isValidType = true;
    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) isValidType = true;
    // JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) isValidType = true;

    if (!isValidType) {
      return NextResponse.json({ error: 'Invalid file type. Only PDF, PNG, and JPEG files are allowed.' }, { status: 415 });
    }

    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = file.type || 'image/jpeg';

    const modelsToTry = ['gemini-3.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
    let response;
    let lastError;

    for (const model of modelsToTry) {
      try {
        response = await ai.models.generateContent({
          model: model,
          contents: [
            {
              role: 'user',
              parts: [
                { text: "Extract the coordinate table from this Costa Rican plano. Determine if it uses CRTM05 (X/Y coordinates, usually around 400000-600000 for X and 900000-1200000 for Y) or Azimuth (bearing and distance). If you cannot find a coordinate table, set found to false. If you see markers for both, set ambiguous to true." },
                { inlineData: { mimeType, data: base64Data } }
              ]
            }
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: schema as Schema,
          }
        });
        // If successful, break out of loop
        break;
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${model} failed: ${err.message}`);
        // If it's a 4xx error (other than 429) it might be an auth/not found issue, but we can just retry the next model
        if (err.status !== 503 && err.status !== 404 && err.status !== 429) {
          throw err;
        }
      }
    }

    if (!response) {
      throw lastError || new Error("All model fallbacks failed");
    }

    const text = response.text;
    if (!text) {
      throw new Error("No text returned from Gemini");
    }

    const data = JSON.parse(text);

    if (!data.found) {
      return NextResponse.json({ error: 'Could not detect coordinate table in uploaded file' }, { status: 422 });
    }

    if (data.ambiguous) {
      return NextResponse.json({ error: 'Ambiguous coordinate system — detected both CRTM05 and Azimuth markers' }, { status: 422 });
    }

    const planoData: PlanoData = {
      type: data.type,
      crtm05: data.crtm05Points,
      azimuth: data.azimuthPoints
    };

    // If it's CRTM05, we can pre-convert to WGS84 for the preview
    let wgs84Points = undefined;
    if (planoData.type === 'CRTM05' && planoData.crtm05 && planoData.crtm05.length > 0) {
      wgs84Points = convertCRTM05ToWGS84(planoData.crtm05);
    } else if (planoData.type === 'Azimuth') {
      // Azimuth needs reference point from user, return 400 with a special instruction?
      // No, we return the parsed table, and the UI will prompt for the reference point, then call convert-azimuth
      // The prompt says "Create a unified /api/process-plano route that handles extraction + conversion in a single request"
      // Wait, "If Azimuth: prompt for reference lat/lng + point selection first" in the Flow part.
      // So process-plano should just return the data, and if the UI provides a reference point in the same request, it can convert it.
      // But initially the UI just uploads the image. It doesn't know the reference point yet.
      
      const referenceLat = formData.get('referenceLat');
      const referenceLng = formData.get('referenceLng');

      if (referenceLat && referenceLng && planoData.azimuth) {
        wgs84Points = convertAzimuthToWGS84(planoData.azimuth, {
          lat: parseFloat(referenceLat as string),
          lng: parseFloat(referenceLng as string)
        });
      }
      // We don't return 400 here if it's the initial upload. The UI handles asking.
      // The instructions say: "400: 'Azimuth plano requires reference point — please provide lat/lng'"
      // This means the API *should* return 400 if it's an Azimuth plano and reference point is missing?
      // Let's just return the data with a status 200, but add a note.
      // Actually, if the requirement is literally "400: 'Azimuth plano requires reference point — please provide lat/lng'",
      // then we should return that. But if we do, the UI won't get the parsed table to display to the user to edit!
      // The prompt says: "Flow: Drag-drop upload -> /api/process-plano. Display extracted coordinates in editable table. If Azimuth: prompt for reference lat/lng + point selection first."
      // So the upload must succeed and return the table! The 400 error might be for the `/api/convert-azimuth` route, or if they try to *generate* KML without it.
    }

    return NextResponse.json({ success: true, data: planoData, wgs84Points });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
