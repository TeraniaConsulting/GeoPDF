/**
 * geopdf-parser.js
 * High-performance client-side parser for Geospatial PDFs (GeoPDF).
 * Compliant with:
 *   - Adobe ISO 32000-1 / ISO 32000-2 Geospatial Viewports (/VP, /Measure, /GPTS, /LPTS, /GCS)
 *   - OGC 08-139 / TerraGo GeoPDF standard (/LGIDict, /Registration, /CTM, /Projection)
 *   - Automatic extraction of Coordinate Reference Systems (WKT / EPSG / Datums)
 *   - Support for compressed Object Streams (/ObjStm) via Pako
 */

class GeoPDFParser {
  /**
   * Parse an ArrayBuffer representing a PDF file.
   * @param {ArrayBuffer} arrayBuffer 
   * @returns {Promise<Object>} Geospatial metadata object
   */
  static async parse(arrayBuffer) {
    const uint8 = new Uint8Array(arrayBuffer);
    
    // Decode as Latin-1 string to preserve binary byte integrity
    let pdfText = '';
    const chunkSize = 65536;
    const decoder = new TextDecoder('latin1');
    for (let i = 0; i < uint8.length; i += chunkSize) {
      pdfText += decoder.decode(uint8.subarray(i, Math.min(i + chunkSize, uint8.length)));
    }

    // 1. Extract MediaBox and Page Count
    const mediaBox = this._extractMediaBox(pdfText);
    const pageCount = this._countPages(pdfText);

    // 2. Attempt parsing Adobe ISO 32000 Geospatial Viewport
    let geoData = this._parseAdobeGeospatial(pdfText);

    // 3. Attempt parsing TerraGo / OGC LGIDict
    if (!geoData || !geoData.hasCoords) {
      const terraGoData = this._parseTerraGo(pdfText);
      if (terraGoData && terraGoData.hasCoords) {
        geoData = terraGoData;
      }
    }

    // 4. If not found in uncompressed objects, check Object Streams (/ObjStm)
    if ((!geoData || !geoData.hasCoords) && typeof pako !== 'undefined') {
      const streamGeoData = this._parseObjectStreams(uint8, pdfText);
      if (streamGeoData && streamGeoData.hasCoords) {
        geoData = streamGeoData;
      }
    }

    if (!geoData) {
      return {
        isGeoreferenced: false,
        pageCount,
        mediaBox: mediaBox || [0, 0, 595, 842],
        message: 'No embedded geospatial metadata found in this PDF.'
      };
    }

    // Attach document-level information
    geoData.pageCount = pageCount;
    geoData.mediaBox = mediaBox || [0, 0, geoData.bbox[2] || 595, geoData.bbox[3] || 842];
    geoData.isGeoreferenced = true;

    // Normalize Ground Control Points (GCPs)
    this._finalizeGCPs(geoData);

    return geoData;
  }

  /**
   * Extract default MediaBox [minX, minY, maxX, maxY]
   */
  static _extractMediaBox(text) {
    const m = text.match(/\/MediaBox\s*\[\s*([0-9\.\-\+\s]+)\s*\]/);
    if (m) {
      const nums = m[1].trim().split(/\s+/).map(Number);
      if (nums.length === 4 && nums.every(n => !isNaN(n))) {
        return nums;
      }
    }
    return [0, 0, 1191, 842]; // Default A3 landscape fallback
  }

  /**
   * Count pages from /Type /Page occurrences
   */
  static _countPages(text) {
    const matches = text.match(/\/Type\s*\/Page\b/g);
    return matches ? matches.length : 1;
  }

  /**
   * Parse Adobe ISO 32000-1 / ISO 32000-2 Geospatial Viewport (/VP)
   */
  static _parseAdobeGeospatial(text) {
    // Check if /Measure with /Subtype /GEO exists
    if (!text.includes('/Subtype /GEO') && !text.includes('/Subtype/GEO') && !text.includes('/Measure')) {
      return null;
    }

    // Search for /BBox
    let bbox = null;
    const bboxMatch = text.match(/\/BBox\s*\[\s*([0-9\.\-\+\s]+)\s*\]/);
    if (bboxMatch) {
      bbox = bboxMatch[1].trim().split(/\s+/).map(Number);
    }

    // Search for /GPTS [lat1 lon1 lat2 lon2 ...]
    const gptsMatch = text.match(/\/GPTS\s*\[\s*([0-9\.\-\+\s]+)\s*\]/);
    if (!gptsMatch) return null;
    const gpts = gptsMatch[1].trim().split(/\s+/).map(Number);

    // Search for /LPTS [x1 y1 x2 y2 ...]
    let lpts = null;
    const lptsMatch = text.match(/\/LPTS\s*\[\s*([0-9\.\-\+\s]+)\s*\]/);
    if (lptsMatch) {
      lpts = lptsMatch[1].trim().split(/\s+/).map(Number);
    } else {
      // Default normalized unit quad
      lpts = [0, 0, 0, 1, 1, 1, 1, 0];
    }

    // Search for /Bounds polygon if any
    let bounds = null;
    const boundsMatch = text.match(/\/Bounds\s*\[\s*([0-9\.\-\+\s]+)\s*\]/);
    if (boundsMatch) {
      bounds = boundsMatch[1].trim().split(/\s+/).map(Number);
    }

    // Extract Coordinate Reference System / WKT
    let wkt = null;
    const wktMatch = text.match(/\/WKT\s*\(([^)]+)\)/);
    if (wktMatch) {
      wkt = wktMatch[1]
        .replace(/\\r|\\n/g, ' ')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, '\\')
        .trim();
    }

    // Extract Viewport Name
    let name = 'Geospatial Viewport';
    const nameMatch = text.match(/\/Name\s*\(([^)]+)\)/);
    if (nameMatch) {
      name = nameMatch[1];
    }

    // Extract EPSG if specified directly
    let epsg = null;
    const epsgMatch = text.match(/\/EPSG\s+([0-9]+)/);
    if (epsgMatch) {
      epsg = parseInt(epsgMatch[1], 10);
    }

    return {
      standard: 'ISO_32000_ADOBE',
      name,
      bbox: bbox || [0, 0, 1000, 1000],
      lpts,
      gpts,
      bounds,
      wkt,
      epsg,
      hasCoords: gpts.length >= 6
    };
  }

  /**
   * Parse TerraGo / OGC 08-139 GeoPDF standard (/LGIDict)
   */
  static _parseTerraGo(text) {
    if (!text.includes('/LGIDict')) return null;

    // Extract Registration pairs
    // e.g. << /Pixel [173.22 0.00] /Geographic [153.27084112 -28.81177556] >>
    const regRegex = /<<\s*\/Pixel\s*\[\s*([0-9\.\-\+]+)\s+([0-9\.\-\+]+)\s*\]\s*\/Geographic\s*\[\s*([0-9\.\-\+]+)\s+([0-9\.\-\+]+)\s*\]\s*>>/g;
    const regPairs = [];
    let match;
    while ((match = regRegex.exec(text)) !== null) {
      regPairs.push({
        pixelX: parseFloat(match[1]),
        pixelY: parseFloat(match[2]),
        // In TerraGo, Geographic is typically [lon, lat]
        lon: parseFloat(match[3]),
        lat: parseFloat(match[4])
      });
    }

    // Extract CTM (Coordinate Transformation Matrix) [a b c d e f]
    let ctm = null;
    const ctmMatch = text.match(/\/CTM\s*\[\s*([0-9\.\-\+\s]+)\s*\]/);
    if (ctmMatch) {
      ctm = ctmMatch[1].trim().split(/\s+/).map(Number);
    }

    // Extract Projection parameters
    const projMatch = text.match(/\/Projection\s*<<([^>]+)>>/);
    let projection = {};
    if (projMatch) {
      const pStr = projMatch[1];
      const getVal = key => {
        const m = pStr.match(new RegExp(`/${key}\\s*(?:\\(([^)]+)\\)|([0-9\\.\\-]+))`));
        return m ? (m[1] || m[2]) : null;
      };
      projection = {
        type: getVal('ProjectionType'),
        datum: getVal('Datum'),
        zone: getVal('Zone'),
        hemisphere: getVal('Hemisphere'),
        units: getVal('Units'),
        centralMeridian: getVal('CentralMeridian') ? parseFloat(getVal('CentralMeridian')) : null,
        falseEasting: getVal('FalseEasting') ? parseFloat(getVal('FalseEasting')) : null,
        falseNorthing: getVal('FalseNorthing') ? parseFloat(getVal('FalseNorthing')) : null
      };
    }

    return {
      standard: 'TERRAGO_OGC',
      name: 'TerraGo GeoPDF Map Frame',
      registration: regPairs,
      ctm,
      projection,
      hasCoords: regPairs.length >= 3 || (ctm && ctm.length === 6)
    };
  }

  /**
   * Search and decompress Flate-encoded Object Streams (/ObjStm)
   */
  static _parseObjectStreams(uint8, text) {
    if (typeof pako === 'undefined') return null;

    const streamRegex = /<<[^>]*\/Type\s*\/ObjStm[^>]*\/Length\s+([0-9]+)[^>]*>>\s*stream[\r\n]+/g;
    let match;
    while ((match = streamRegex.exec(text)) !== null) {
      const streamStart = match.index + match[0].length;
      const length = parseInt(match[1], 10);
      if (streamStart + length <= uint8.length) {
        try {
          const compressed = uint8.subarray(streamStart, streamStart + length);
          const decompressed = pako.inflate(compressed);
          const decStr = new TextDecoder('latin1').decode(decompressed);

          // Test if geospatial structures exist in this stream
          let res = this._parseAdobeGeospatial(decStr) || this._parseTerraGo(decStr);
          if (res && res.hasCoords) {
            return res;
          }
        } catch (e) {
          // Continue scanning next stream
        }
      }
    }
    return null;
  }

  /**
   * Finalize Ground Control Points (GCPs) mapping between PDF canvas pixels and Lat/Lon
   */
  static _finalizeGCPs(geo) {
    const H_page = geo.mediaBox[3];
    const gcps = [];

    if (geo.standard === 'ISO_32000_ADOBE') {
      const [minX, minY, maxX, maxY] = geo.bbox;
      const w = maxX - minX;
      const h = maxY - minY;

      const numPoints = Math.min(geo.lpts.length / 2, geo.gpts.length / 2);
      for (let i = 0; i < numPoints; i++) {
        const u = geo.lpts[i * 2];
        const v = geo.lpts[i * 2 + 1];

        // Determine if LPTS is normalized [0, 1] or raw PDF points
        const isNormalized = Math.abs(u) <= 1.05 && Math.abs(v) <= 1.05;
        const pdfX = isNormalized ? minX + u * w : u;
        const pdfY = isNormalized ? minY + v * h : v;

        // Canvas Y is inverted relative to PDF space (top-left origin)
        const canvasX = pdfX;
        const canvasY = H_page - pdfY;

        let lat = geo.gpts[i * 2];
        let lon = geo.gpts[i * 2 + 1];

        // Check if coordinates are in projected space (meters) rather than lat/lon degrees
        const isProjected = Math.abs(lat) > 90 || Math.abs(lon) > 180;

        gcps.push({
          index: i,
          pdfX,
          pdfY,
          canvasX,
          canvasY,
          lat,
          lon,
          isProjected
        });
      }
    } else if (geo.standard === 'TERRAGO_OGC' && geo.registration && geo.registration.length > 0) {
      geo.registration.forEach((reg, i) => {
        const pdfX = reg.pixelX;
        const pdfY = reg.pixelY;
        const canvasX = pdfX;
        const canvasY = H_page - pdfY;

        gcps.push({
          index: i,
          pdfX,
          pdfY,
          canvasX,
          canvasY,
          lat: reg.lat,
          lon: reg.lon,
          isProjected: Math.abs(reg.lat) > 90 || Math.abs(reg.lon) > 180
        });
      });
    }

    geo.gcps = gcps;

    // Calculate geographic bounding box [south, west, north, east]
    if (gcps.length > 0) {
      const lats = gcps.map(p => p.lat);
      const lons = gcps.map(p => p.lon);
      geo.boundsLatLng = {
        south: Math.min(...lats),
        north: Math.max(...lats),
        west: Math.min(...lons),
        east: Math.max(...lons),
        centerLat: (Math.min(...lats) + Math.max(...lats)) / 2,
        centerLon: (Math.min(...lons) + Math.max(...lons)) / 2
      };
    }
  }
}

// Make globally available
window.GeoPDFParser = GeoPDFParser;
