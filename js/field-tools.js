/**
 * field-tools.js
 * Survey & Field Navigation Utilities:
 * - Waypoint creation, storage, rendering, and GeoJSON/CSV export
 * - Distance & Azimuth Bearing measurement tool
 * - Coordinate inspection and clipboard copying
 */

class FieldTools {
  constructor(app) {
    this.app = app;
    this.waypoints = this.loadWaypoints();
    this.isMeasuring = false;
    this.measurePoints = []; // [{lat, lon, x, y}]
  }

  loadWaypoints() {
    try {
      const saved = localStorage.getItem('terania_geopdf_waypoints');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  }

  saveWaypoints() {
    try {
      localStorage.setItem('terania_geopdf_waypoints', JSON.stringify(this.waypoints));
    } catch (e) {
      console.warn('Could not save waypoints to localStorage', e);
    }
  }

  /**
   * Add a new waypoint
   */
  addWaypoint(data) {
    const wp = Object.assign({
      id: 'wp_' + Date.now(),
      name: `Waypoint ${this.waypoints.length + 1}`,
      category: 'General',
      note: '',
      lat: 0,
      lon: 0,
      easting: null,
      northing: null,
      altitude: null,
      timestamp: new Date().toISOString()
    }, data);

    this.waypoints.push(wp);
    this.saveWaypoints();
    return wp;
  }

  /**
   * Remove a waypoint
   */
  removeWaypoint(id) {
    this.waypoints = this.waypoints.filter(w => w.id !== id);
    this.saveWaypoints();
  }

  /**
   * Clear all waypoints
   */
  clearWaypoints() {
    this.waypoints = [];
    this.saveWaypoints();
  }

  /**
   * Export waypoints to GeoJSON
   */
  exportGeoJSON() {
    const featureCollection = {
      type: 'FeatureCollection',
      name: 'Terania_Field_Waypoints',
      features: this.waypoints.map(w => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [w.lon, w.lat, w.altitude || 0]
        },
        properties: {
          id: w.id,
          name: w.name,
          category: w.category,
          note: w.note,
          easting: w.easting,
          northing: w.northing,
          timestamp: w.timestamp
        }
      }))
    };

    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], { type: 'application/geo+json' });
    this._downloadBlob(blob, `Terania_Waypoints_${Date.now()}.geojson`);
  }

  /**
   * Export waypoints to CSV
   */
  exportCSV() {
    let csv = 'ID,Name,Category,Latitude,Longitude,Easting,Northing,Altitude,Timestamp,Notes\n';
    this.waypoints.forEach(w => {
      const cleanNote = (w.note || '').replace(/"/g, '""');
      csv += `"${w.id}","${w.name}","${w.category}",${w.lat.toFixed(8)},${w.lon.toFixed(8)},${w.easting ? w.easting.toFixed(3) : ''},${w.northing ? w.northing.toFixed(3) : ''},${w.altitude ? w.altitude.toFixed(2) : ''},"${w.timestamp}","${cleanNote}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    this._downloadBlob(blob, `Terania_Waypoints_${Date.now()}.csv`);
  }

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Measurement tool operations
   */
  startMeasurement() {
    this.isMeasuring = true;
    this.measurePoints = [];
  }

  stopMeasurement() {
    this.isMeasuring = false;
    this.measurePoints = [];
  }

  addMeasurePoint(point) {
    this.measurePoints.push(point);
    return this.getMeasurementSummary();
  }

  getMeasurementSummary() {
    if (this.measurePoints.length < 2) {
      return { totalDistance: 0, segments: [] };
    }

    let totalDist = 0;
    const segments = [];

    for (let i = 1; i < this.measurePoints.length; i++) {
      const p1 = this.measurePoints[i - 1];
      const p2 = this.measurePoints[i];

      let dist = 0;
      let bearing = 0;

      if (this.app.geoTransform) {
        dist = this.app.geoTransform.calculateDistance(p1.lat, p1.lon, p2.lat, p2.lon);
        bearing = this.app.geoTransform.calculateBearing(p1.lat, p1.lon, p2.lat, p2.lon);
      }

      totalDist += dist;
      segments.push({
        distance: dist,
        bearing: Math.round(bearing),
        bearingText: this.app.geoTransform ? this.app.geoTransform.bearingToCompass(bearing) : ''
      });
    }

    return {
      totalDistance: totalDist,
      segments
    };
  }
}

// Make globally available
window.FieldTools = FieldTools;
