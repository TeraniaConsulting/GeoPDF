/**
 * geo-transform.js
 * High-precision coordinate transformation engine for Terania GeoPDF.
 * - Solves normalized affine transformation between GPS (Lat, Lon) and Canvas (X, Y)
 * - Supports Australian Coordinate Reference Systems (GDA2020 MGA Zone 54-56, GDA94)
 * - Supports Proj4 WKT projections and global UTM zones
 * - Calculates ground distances, azimuth bearings, and boundary testing
 */

class GeoTransform {
  constructor(geoData) {
    this.geoData = geoData;
    this.gcps = geoData.gcps || [];
    this.isReady = false;

    // Transformation parameters
    this.lon0 = 0;
    this.lat0 = 0;
    this.cx0 = 0;
    this.cy0 = 0;
    this.scaleGeo = 1;
    this.scaleCanvas = 1;
    this.affine = null; // [a, b, c, d] in normalized space
    this.affineInv = null;

    this.crsName = 'GDA2020 / MGA zone 56';
    this.crsCode = 'EPSG:7856';

    this._initializeProjections();
    this._computeTransformation();
  }

  /**
   * Register common survey Coordinate Reference Systems
   */
  _initializeProjections() {
    if (typeof proj4 === 'undefined') return;

    // GDA2020 / MGA Zones 54, 55, 56 (Eastern Australia)
    proj4.defs('EPSG:7856', '+proj=utm +zone=56 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs');
    proj4.defs('EPSG:7855', '+proj=utm +zone=55 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs');
    proj4.defs('EPSG:7854', '+proj=utm +zone=54 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs');

    // GDA94 / MGA Zones 54, 55, 56
    proj4.defs('EPSG:28356', '+proj=utm +zone=56 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs');
    proj4.defs('EPSG:28355', '+proj=utm +zone=55 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs');
    proj4.defs('EPSG:28354', '+proj=utm +zone=54 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs');

    // If GeoPDF provides WKT, parse and register it
    if (this.geoData.wkt) {
      try {
        const cleanWkt = this.geoData.wkt
          .replace(/\\"/g, '"')
          .replace(/\\'/g, "'")
          .replace(/\\\\/g, '')
          .trim();

        proj4.defs('CUSTOM_GEOPDF', cleanWkt);
        this.crsCode = 'CUSTOM_GEOPDF';
        
        // Extract readable name
        const nameMatch = cleanWkt.match(/PROJCS\["([^"]+)"/i) || cleanWkt.match(/GEOGCS\["([^"]+)"/i);
        if (nameMatch) {
          this.crsName = nameMatch[1];
        }

        // If WKT specifies EPSG authority, e.g. AUTHORITY["EPSG","7856"]
        const epsgMatch = cleanWkt.match(/AUTHORITY\["EPSG","(\d+)"\]\s*\]\s*$/i) || cleanWkt.match(/AUTHORITY\["EPSG","(\d+)"\]/i);
        if (epsgMatch) {
          const matchedEpsg = 'EPSG:' + epsgMatch[1];
          if (proj4.defs(matchedEpsg)) {
            this.crsCode = matchedEpsg;
          }
        }
      } catch (e) {
        console.warn('Could not register custom WKT with proj4:', e);
      }
    } else if (this.geoData.projection?.zone) {
      const z = parseInt(this.geoData.projection.zone, 10);
      if (z >= 1 && z <= 60) {
        this.crsName = `MGA / UTM Zone ${z} (South)`;
        this.crsCode = `EPSG:78${z < 10 ? '0' + z : z}`;
      }
    }
  }

  /**
   * Compute normalized affine transformation matrices
   */
  _computeTransformation() {
    if (this.gcps.length < 3) {
      console.warn('Need at least 3 Ground Control Points for transformation.');
      return;
    }

    const n = this.gcps.length;
    this.lon0 = this.gcps.reduce((acc, p) => acc + p.lon, 0) / n;
    this.lat0 = this.gcps.reduce((acc, p) => acc + p.lat, 0) / n;
    this.cx0 = this.gcps.reduce((acc, p) => acc + p.canvasX, 0) / n;
    this.cy0 = this.gcps.reduce((acc, p) => acc + p.canvasY, 0) / n;

    this.scaleGeo = Math.max(...this.gcps.map(p => Math.hypot(p.lon - this.lon0, p.lat - this.lat0))) || 1;
    this.scaleCanvas = Math.max(...this.gcps.map(p => Math.hypot(p.canvasX - this.cx0, p.canvasY - this.cy0))) || 1;

    const norm = this.gcps.map(p => ({
      nx: (p.lon - this.lon0) / this.scaleGeo,
      ny: (p.lat - this.lat0) / this.scaleGeo,
      nu: (p.canvasX - this.cx0) / this.scaleCanvas,
      nv: (p.canvasY - this.cy0) / this.scaleCanvas
    }));

    // Solve for nu = a*nx + b*ny and nv = c*nx + d*ny
    let s_xx = 0, s_yy = 0, s_xy = 0;
    let s_xu = 0, s_yu = 0, s_xv = 0, s_yv = 0;

    for (const p of norm) {
      s_xx += p.nx * p.nx;
      s_yy += p.ny * p.ny;
      s_xy += p.nx * p.ny;
      s_xu += p.nx * p.nu;
      s_yu += p.ny * p.nu;
      s_xv += p.nx * p.nv;
      s_yv += p.ny * p.nv;
    }

    const det = s_xx * s_yy - s_xy * s_xy;
    if (Math.abs(det) < 1e-12) {
      console.error('Singular matrix in GeoPDF transformation calculation');
      return;
    }

    const a = (s_yy * s_xu - s_xy * s_yu) / det;
    const b = (s_xx * s_yu - s_xy * s_xu) / det;
    const c = (s_yy * s_xv - s_xy * s_yv) / det;
    const d = (s_xx * s_yv - s_xy * s_xv) / det;

    this.affine = { a, b, c, d };

    // Inverse affine for (canvasX, canvasY) -> (lon, lat)
    const detNorm = a * d - b * c;
    this.affineInv = {
      a: d / detNorm,
      b: -b / detNorm,
      c: -c / detNorm,
      d: a / detNorm
    };

    this.isReady = true;
  }

  /**
   * Transform GPS (lat, lon) to Canvas pixel coordinates (canvasX, canvasY)
   * @param {number} lat 
   * @param {number} lon 
   * @returns {{x: number, y: number, inside: boolean}}
   */
  gpsToCanvas(lat, lon) {
    if (!this.isReady) return null;

    const nx = (lon - this.lon0) / this.scaleGeo;
    const ny = (lat - this.lat0) / this.scaleGeo;

    const nu = this.affine.a * nx + this.affine.b * ny;
    const nv = this.affine.c * nx + this.affine.d * ny;

    const canvasX = this.cx0 + nu * this.scaleCanvas;
    const canvasY = this.cy0 + nv * this.scaleCanvas;

    const inside = this.isPointInside(lat, lon);

    return { x: canvasX, y: canvasY, inside };
  }

  /**
   * Transform Canvas pixel coordinates (canvasX, canvasY) to GPS (lat, lon)
   * @param {number} canvasX 
   * @param {number} canvasY 
   * @returns {{lat: number, lon: number}}
   */
  canvasToGps(canvasX, canvasY) {
    if (!this.isReady) return null;

    const nu = (canvasX - this.cx0) / this.scaleCanvas;
    const nv = (canvasY - this.cy0) / this.scaleCanvas;

    const nx = this.affineInv.a * nu + this.affineInv.b * nv;
    const ny = this.affineInv.c * nu + this.affineInv.d * nv;

    const lon = this.lon0 + nx * this.scaleGeo;
    const lat = this.lat0 + ny * this.scaleGeo;

    return { lat, lon };
  }

  /**
   * Convert GPS (lat, lon) to projected grid coordinates (Easting, Northing)
   * @param {number} lat 
   * @param {number} lon 
   * @returns {{easting: number, northing: number, crs: string}}
   */
  toGrid(lat, lon) {
    if (typeof proj4 !== 'undefined') {
      try {
        const point = proj4('EPSG:4326', this.crsCode, [lon, lat]);
        return {
          easting: point[0],
          northing: point[1],
          crs: this.crsName
        };
      } catch (e) {
        // Fallback
      }
    }
    return {
      easting: lon,
      northing: lat,
      crs: 'WGS84 Lat/Lon'
    };
  }

  /**
   * Check if a geographic point (lat, lon) is inside the GeoPDF boundary polygon
   */
  isPointInside(lat, lon) {
    if (!this.gcps || this.gcps.length < 3) return false;

    // Ray casting algorithm
    let inside = false;
    for (let i = 0, j = this.gcps.length - 1; i < this.gcps.length; j = i++) {
      const xi = this.gcps[i].lon, yi = this.gcps[i].lat;
      const xj = this.gcps[j].lon, yj = this.gcps[j].lat;

      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Calculate distance (meters) and bearing (degrees) to the GeoPDF boundary center
   */
  getRelativePosition(lat, lon) {
    if (!this.geoData.boundsLatLng) return null;

    const cLat = this.geoData.boundsLatLng.centerLat;
    const cLon = this.geoData.boundsLatLng.centerLon;

    const distMeters = this.calculateDistance(lat, lon, cLat, cLon);
    const bearing = this.calculateBearing(lat, lon, cLat, cLon);
    const inside = this.isPointInside(lat, lon);

    return {
      distanceMeters: distMeters,
      bearingDeg: Math.round(bearing),
      bearingText: this.bearingToCompass(bearing),
      inside
    };
  }

  /**
   * Haversine great-circle distance in meters
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Calculate initial azimuth bearing from (lat1, lon1) to (lat2, lon2)
   */
  calculateBearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
    let brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
  }

  /**
   * Convert degrees azimuth to 16-point compass direction
   */
  bearingToCompass(deg) {
    const sectors = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const idx = Math.round(deg / 22.5) % 16;
    return sectors[idx];
  }

  /**
   * Format decimal degrees to DMS (Degrees, Minutes, Seconds)
   */
  static formatDMS(dec, isLat) {
    const abs = Math.abs(dec);
    const deg = Math.floor(abs);
    const minDec = (abs - deg) * 60;
    const min = Math.floor(minDec);
    const sec = ((minDec - min) * 60).toFixed(2);
    const dir = isLat ? (dec >= 0 ? 'N' : 'S') : (dec >= 0 ? 'E' : 'W');
    return `${deg}°${min}'${sec}"${dir}`;
  }
}

// Make globally available
window.GeoTransform = GeoTransform;
