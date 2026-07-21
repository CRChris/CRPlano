'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import dynamic from 'next/dynamic';
import styles from './page.module.css';
import { PlanoData, WGS84Point } from '@/types';
import { generateKML } from '@/utils/kmlGenerator';
import { isWithinCostaRica } from '@/utils/coordinates';

// Dynamically import map to avoid SSR issues with Leaflet
const MapPreview = dynamic(() => import('@/components/MapPreview'), { ssr: false });

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planoData, setPlanoData] = useState<PlanoData | null>(null);
  const [wgs84Points, setWgs84Points] = useState<WGS84Point[] | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [refPointStr, setRefPointStr] = useState<string>('');
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructionLang, setInstructionLang] = useState<'en' | 'es'>('en');
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [showResolutionWarning, setShowResolutionWarning] = useState(false);
  const [showRateLimitModal, setShowRateLimitModal] = useState(false);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  // Silent auto-update map when coordinates change
  useEffect(() => {
    // Only auto-update if a map has already been generated once
    if (!wgs84Points || wgs84Points.length === 0 || !planoData) return;

    const timer = setTimeout(() => {
      if (planoData.type === 'CRTM05' && planoData.crtm05) {
        fetch('/api/convert-crtm05', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points: planoData.crtm05 }),
        })
        .then(res => res.json())
        .then(data => {
          if (data.data) setWgs84Points(data.data);
        }).catch(err => console.error(err));
      } else if (planoData.type === 'Azimuth' && planoData.azimuth) {
        if (!refPointStr || !refPointStr.includes(',')) return;
        const parts = refPointStr.split(',');
        const lat = parseFloat(parts[0].trim());
        const lng = parseFloat(parts[1].trim());
        if (isNaN(lat) || isNaN(lng)) return;

        fetch('/api/convert-azimuth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            points: planoData.azimuth,
            reference: { lat, lng }
          }),
        })
        .then(res => res.json())
        .then(data => {
          if (data.data) setWgs84Points(data.data);
        }).catch(err => console.error(err));
      }
    }, 600); // 600ms debounce

    return () => clearTimeout(timer);
  }, [planoData, refPointStr]);

  useEffect(() => {
    if (selectedPointIndex !== null && rowRefs.current[selectedPointIndex]) {
      rowRefs.current[selectedPointIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selectedPointIndex]);

  const processFile = async (file: File) => {
    setLoading(true);
    setError(null);
    setPlanoData(null);
    setWgs84Points(null);
    setSelectedPointIndex(null);
    rowRefs.current = [];

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/process-plano', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error && data.error.includes("Could not detect coordinate table")) {
          setShowResolutionWarning(true);
        }
        throw new Error(data.error || 'Failed to process plano');
      }

      setPlanoData(data.data);
      if (data.wgs84Points) {
        setWgs84Points(data.wgs84Points);
      }
    } catch (err: any) {
      if (err.message && err.message.includes('Rate limit exceeded')) {
        setShowRateLimitModal(true);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setUploadedFile(file);
    await processFile(file);
  }, []);

  const handleRedo = () => {
    if (uploadedFile) {
      processFile(uploadedFile);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png']
    },
    maxSize: 10 * 1024 * 1024, // 10MB
  });

  const handleConvertAzimuth = async () => {
    if (!planoData?.azimuth || planoData.azimuth.length === 0) {
      setError("No azimuth coordinate points were found to calculate.");
      return;
    }
    if (!refPointStr || !refPointStr.includes(',')) {
      setError("Please provide reference latitude and longitude separated by a comma (e.g., 9.9281, -84.0907).");
      return;
    }

    const parts = refPointStr.split(',');
    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());

    if (isNaN(lat) || isNaN(lng)) {
      setError("Invalid latitude or longitude provided.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/convert-azimuth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: planoData.azimuth,
          reference: { lat, lng }
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to convert azimuth');
      }

      setWgs84Points(data.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadKml = () => {
    if (!wgs84Points) return;

    // Validate bounds
    if (!isWithinCostaRica(wgs84Points)) {
      if (!window.confirm("Warning: The generated coordinates are outside of Costa Rica. Are you sure you want to download this KML?")) {
        return;
      }
    }

    try {
      const kmlStr = generateKML(wgs84Points, uploadedFile?.name || 'Plano');
      
      // Basic validation by checking if it parses
      const parser = new DOMParser();
      const doc = parser.parseFromString(kmlStr, "application/xml");
      if (doc.getElementsByTagName("parsererror").length > 0) {
        throw new Error("Generated KML is invalid.");
      }

      const blob = new Blob([kmlStr], { type: 'application/vnd.google-earth.kml+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${uploadedFile?.name || 'plano'}.kml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError("Failed to generate KML: " + err.message);
    }
  };

  const handlePointChange = (index: number, field: string, value: string) => {
    if (!planoData) return;
    
    const newData = { ...planoData };
    if (newData.type === 'CRTM05' && newData.crtm05) {
      newData.crtm05[index] = { ...newData.crtm05[index], [field]: value };
    } else if (newData.type === 'Azimuth' && newData.azimuth) {
      newData.azimuth[index] = { ...newData.azimuth[index], [field]: value };
    }
    setPlanoData(newData);
  };

  const recomputeCrtm05 = async () => {
    if (!planoData?.crtm05) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/convert-crtm05', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: planoData.crtm05 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWgs84Points(data.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>CR Plano KML Generator</h1>
        <p className={styles.subtitle}>Extract coordinate tables from Costa Rican survey plans</p>
        <button className={styles.buttonSecondary} onClick={() => setShowInstructions(true)} style={{ marginTop: '1rem' }}>
          Instructions & Info
        </button>
      </div>

      <div className={styles.disclaimer}>
        For visualization purposes only — not legal survey grade
      </div>

      {!loading && !planoData && (
        <div {...getRootProps()} className={`${styles.dropzone} ${isDragActive ? styles.dropzoneActive : ''}`}>
          <input {...getInputProps()} />
          <p className={styles.dropzoneText}>
            {isDragActive ? 'Drop the file here...' : 'Drag and drop a Plano (PDF/JPG/PNG) here, or click to select'}
          </p>
          <small>Max file size: 10MB</small>
        </div>
      )}

      {loading && <div className={styles.loading}>Processing...</div>}

      {error && <div className={styles.error}>{error}</div>}

      {planoData && (
        <div className={styles.resultsArea}>
          <h3>Extracted {planoData.type} Coordinates</h3>
          <p>File: {uploadedFile?.name}</p>

          {planoData.type === 'Azimuth' && (
            <div className={styles.referenceForm}>
              <h3>Reference Point Needed</h3>
              <p>Azimuth planos require a starting WGS84 coordinate to generate the polygon.</p>
              <div className={styles.formGroup}>
                <div className={styles.formField} style={{ width: '100%' }}>
                  <label>Latitude, Longitude (e.g. 9.9281, -84.0907)</label>
                  <input 
                    type="text" 
                    value={refPointStr} 
                    onChange={e => setRefPointStr(e.target.value)} 
                    className={styles.input} 
                    placeholder="Paste from Google Maps..."
                  />
                </div>
              </div>
              <button className={styles.button} onClick={handleConvertAzimuth}>Apply Reference & Generate Map</button>
            </div>
          )}

          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Point / ID</th>
                  {planoData.type === 'CRTM05' ? (
                    <>
                      <th>X (East)</th>
                      <th>Y (North)</th>
                    </>
                  ) : (
                    <>
                      <th>Bearing (Degrees)</th>
                      <th>Distance (m)</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {planoData.type === 'CRTM05' && planoData.crtm05?.map((point, index) => (
                  <tr 
                    key={index} 
                    ref={el => { rowRefs.current[index] = el; }}
                    className={selectedPointIndex === index ? styles.highlightRow : ''}
                  >
                    <td>
                      <input type="text" value={point.id} onChange={e => handlePointChange(index, 'id', e.target.value)} className={styles.input} />
                    </td>
                    <td>
                      <input type="number" step="any" value={point.x} onChange={e => handlePointChange(index, 'x', e.target.value)} className={styles.input} />
                    </td>
                    <td>
                      <input type="number" step="any" value={point.y} onChange={e => handlePointChange(index, 'y', e.target.value)} className={styles.input} />
                    </td>
                  </tr>
                ))}
                {planoData.type === 'Azimuth' && planoData.azimuth?.map((point, index) => (
                  <tr 
                    key={index}
                    ref={el => { rowRefs.current[index] = el; }}
                    className={selectedPointIndex === index ? styles.highlightRow : ''}
                  >
                    <td>
                      <input type="text" value={point.id} onChange={e => handlePointChange(index, 'id', e.target.value)} className={styles.input} />
                    </td>
                    <td>
                      <input type="number" step="any" value={point.bearing} onChange={e => handlePointChange(index, 'bearing', e.target.value)} className={styles.input} />
                    </td>
                    <td>
                      <input type="number" step="any" value={point.distance} onChange={e => handlePointChange(index, 'distance', e.target.value)} className={styles.input} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
          </div>

          {wgs84Points && wgs84Points.length > 0 && (
            <div>
              <h3>Map Preview</h3>
              <p>Click a marker on the map to highlight its row in the table above.</p>
              <div className={styles.mapContainer}>
                <MapPreview points={wgs84Points} onPointClick={setSelectedPointIndex} />
              </div>
              <button className={styles.button} onClick={handleDownloadKml}>Download KML</button>
            </div>
          )}
          
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
            <button className={styles.buttonSecondary} onClick={() => {
              setPlanoData(null);
              setWgs84Points(null);
              setUploadedFile(null);
              setSelectedPointIndex(null);
            }}>Upload Another File</button>
            <button className={styles.button} onClick={handleRedo}>Re-scan Document (Redo AI)</button>
          </div>
        </div>
      )}

      {showResolutionWarning && (
        <div className={styles.modal} onClick={() => setShowResolutionWarning(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <button className={styles.closeButton} onClick={() => setShowResolutionWarning(false)}>&times;</button>
            <h2 style={{ color: '#dc3545' }}>Clearer Document Needed</h2>
            <p>The AI could not confidently read the coordinates from the uploaded image.</p>
            <p>Please ensure that the image is high resolution, not blurry, and the coordinate table is fully visible.</p>
            <div style={{ marginTop: '2rem' }}>
              <button className={styles.button} onClick={() => setShowResolutionWarning(false)}>Okay, I'll try another file</button>
            </div>
          </div>
        </div>
      )}

      {showRateLimitModal && (
        <div className={styles.modal} onClick={() => setShowRateLimitModal(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <button className={styles.closeButton} onClick={() => setShowRateLimitModal(false)}>&times;</button>
            <h2 style={{ color: '#dc3545' }}>Rate Limit Reached</h2>
            <p>Your rate limit has been reached, please try again later.</p>
            <div style={{ marginTop: '2rem' }}>
              <button className={styles.button} onClick={() => setShowRateLimitModal(false)}>Okay</button>
            </div>
          </div>
        </div>
      )}

      {showInstructions && (
        <div className={styles.modal} onClick={() => setShowInstructions(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <button className={styles.closeButton} onClick={() => setShowInstructions(false)}>&times;</button>
            
            <div className={styles.tabContainer}>
              <button 
                className={`${styles.tab} ${instructionLang === 'en' ? styles.activeTab : ''}`}
                onClick={() => setInstructionLang('en')}
              >
                English
              </button>
              <button 
                className={`${styles.tab} ${instructionLang === 'es' ? styles.activeTab : ''}`}
                onClick={() => setInstructionLang('es')}
              >
                Español
              </button>
            </div>

            {instructionLang === 'en' ? (
              <>
                <h2>Instructions & Costa Rican Planos</h2>
                <p>This tool extracts coordinates from Costa Rican survey plans (planos) to generate a KML boundary for use in Google Maps or other online map that can import kml files.</p>
                
                <h3>CRTM05 Planos</h3>
                <p>Modern planos use the CRTM05 coordinate system (EPSG:5367). These have X and Y coordinates (e.g. X: 493000, Y: 1092000). The tool will automatically detect these and convert them to WGS84 for the map.</p>
                
                <h3>Azimuth / Distance Planos</h3>
                <p>Older planos often use Bearings (Azimuths) and Distances instead of absolute coordinates. The tool extracts these distances, but cannot know where in Costa Rica the property is located. You must provide a Reference Point (Lat/Lng) for the starting node (point 1) to generate the map.</p>
                
                <hr />
                <p><strong>Note on Uploading:</strong> The document does not need to be rotated into the correct position before uploading. The AI will read it in any orientation.</p>
                <p><strong>Note on Accuracy:</strong> The generated boundaries are for visualization purposes only. The Haversine formula is used for azimuth calculations, which assumes a spherical earth and is not survey-grade accurate. The AI may also make transcription errors from the image, so always review the extracted table before generating the KML.</p>
              </>
            ) : (
              <>
                <h2>Instrucciones y Planos de Costa Rica</h2>
                <p>Esta herramienta extrae coordenadas de planos topográficos de Costa Rica para generar un límite KML para su uso en Google Maps u otros mapas en línea que puedan importar archivos KML.</p>
                
                <h3>Planos CRTM05</h3>
                <p>Los planos modernos utilizan el sistema de coordenadas CRTM05 (EPSG:5367). Estos tienen coordenadas X e Y (ej. X: 493000, Y: 1092000). La herramienta los detectará automáticamente y los convertirá a WGS84 para el mapa.</p>
                
                <h3>Planos de Azimut / Distancia</h3>
                <p>Los planos más antiguos suelen utilizar Rumbos (Azimuts) y Distancias en lugar de coordenadas absolutas. La herramienta extrae estas distancias, pero no puede saber en qué parte de Costa Rica se encuentra la propiedad. Debe proporcionar un Punto de Referencia (Lat/Lng) para el nodo inicial (punto 1) para generar el mapa.</p>
                
                <hr />
                <p><strong>Nota sobre la carga:</strong> El documento no necesita ser rotado a la posición correcta antes de cargarlo. La IA lo leerá en cualquier orientación.</p>
                <p><strong>Nota sobre la Precisión:</strong> Los límites generados son solo para fines de visualización. La fórmula del semiverseno (Haversine) se utiliza para los cálculos de azimut, la cual asume una tierra esférica y no tiene una precisión de grado topográfico. La IA también puede cometer errores de transcripción de la imagen, así que siempre revise la tabla extraída antes de generar el KML.</p>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
