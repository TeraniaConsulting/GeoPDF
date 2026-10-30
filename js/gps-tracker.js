/**
 * gps-tracker.js
 * Real-time Device Geolocation and Compass Orientation Engine.
 * - Manages high-accuracy GPS watchPosition
 * - Manages device orientation / magnetic compass heading
 * - Computes signal quality, accuracy, speed, altitude
 * - Supports simulated walk mode for indoor/office testing
 */

class GPSTracker {
  constructor(options = {}) {
    this.options = Object.assign({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000
    }, options);

    this.watchId = null;
    this.currentPosition = null;
    this.currentHeading = null;
    this.isWatching = false;
    this.isSimulating = false;
    this.simInterval = null;
    this.followUser = true;

    // Listeners: (pos) => void
    this.onLocationCallbacks = [];
    this.onHeadingCallbacks = [];
    this.onErrorCallbacks = [];
    this.onStatusCallbacks = [];

    this._setupOrientation();
  }

  /**
   * Register location update callback
   */
  onLocation(cb) {
    this.onLocationCallbacks.push(cb);
  }

  /**
   * Register heading/compass update callback
   */
  onHeading(cb) {
    this.onHeadingCallbacks.push(cb);
  }

  /**
   * Register error callback
   */
  onError(cb) {
    this.onErrorCallbacks.push(cb);
  }

  /**
   * Register status change callback
   */
  onStatusChange(cb) {
    this.onStatusCallbacks.push(cb);
  }

  /**
   * Start tracking device position
   */
  start() {
    if (this.isWatching) return;

    if (!('geolocation' in navigator)) {
      this._emitError('Geolocation is not supported by your browser or device.');
      return;
    }

    this._emitStatus('acquiring', 'Acquiring GPS satellite fix...');

    this.watchId = navigator.geolocation.watchPosition(
      pos => this._handlePosition(pos),
      err => this._handleError(err),
      this.options
    );

    this.isWatching = true;
  }

  /**
   * Stop tracking
   */
  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.stopSimulation();
    this.isWatching = false;
    this._emitStatus('stopped', 'GPS tracking stopped');
  }

  /**
   * Handle incoming browser geolocation position
   */
  _handlePosition(pos) {
    const coords = pos.coords;
    const accuracy = coords.accuracy || 10;

    let quality = 'good';
    if (accuracy <= 5) quality = 'excellent';
    else if (accuracy <= 15) quality = 'good';
    else if (accuracy <= 30) quality = 'fair';
    else quality = 'poor';

    const cleanPos = {
      lat: coords.latitude,
      lon: coords.longitude,
      accuracy: accuracy,
      altitude: coords.altitude !== null ? coords.altitude : null,
      altitudeAccuracy: coords.altitudeAccuracy || null,
      heading: coords.heading !== null && !isNaN(coords.heading) ? coords.heading : this.currentHeading,
      speed: coords.speed !== null && !isNaN(coords.speed) ? (coords.speed * 3.6) : 0, // km/h
      timestamp: pos.timestamp || Date.now(),
      quality,
      isSimulated: false
    };

    this.currentPosition = cleanPos;
    this._emitStatus('active', `GPS Locked (±${Math.round(accuracy)}m)`);
    this.onLocationCallbacks.forEach(cb => cb(cleanPos));
  }

  /**
   * Handle geolocation error
   */
  _handleError(err) {
    let msg = 'Unable to retrieve location';
    switch (err.code) {
      case err.PERMISSION_DENIED:
        msg = 'Location permission was denied. Please allow location access in your device settings.';
        break;
      case err.POSITION_UNAVAILABLE:
        msg = 'GPS signal unavailable. Ensure location services are enabled on your device.';
        break;
      case err.TIMEOUT:
        msg = 'Location request timed out. Retrying GPS lock...';
        break;
    }
    this._emitStatus('error', msg);
    this.onErrorCallbacks.forEach(cb => cb(msg, err));
  }

  /**
   * Listen to device orientation (magnetic compass)
   */
  _setupOrientation() {
    const handleOrientation = e => {
      let compassHeading = null;
      if (typeof e.webkitCompassHeading !== 'undefined') {
        // iOS Safari compass heading (degrees clockwise from True North)
        compassHeading = e.webkitCompassHeading;
      } else if (e.alpha !== null) {
        // Android / standard device orientation
        compassHeading = (360 - e.alpha) % 360;
      }

      if (compassHeading !== null) {
        this.currentHeading = compassHeading;
        this.onHeadingCallbacks.forEach(cb => cb(compassHeading));
      }
    };

    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
      window.addEventListener('deviceorientation', handleOrientation, true);
    }
  }

  /**
   * Request iOS orientation permission if required
   */
  async requestOrientationPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        return response === 'granted';
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  /**
   * Simulate a walk across a GeoPDF for testing purposes
   * @param {Object} boundsLatLng - { south, west, north, east }
   */
  startSimulation(boundsLatLng) {
    this.stopSimulation();
    this.isSimulating = true;

    const south = boundsLatLng.south;
    const north = boundsLatLng.north;
    const west = boundsLatLng.west;
    const east = boundsLatLng.east;

    let t = 0;
    const step = 0.03;

    this.simInterval = setInterval(() => {
      t += step;
      // Figure-8 pattern across the bounding box
      const lat = (north + south) / 2 + (north - south) * 0.35 * Math.sin(t);
      const lon = (east + west) / 2 + (east - west) * 0.35 * Math.sin(t * 2);

      // Compute heading
      const nextLat = (north + south) / 2 + (north - south) * 0.35 * Math.sin(t + step);
      const nextLon = (east + west) / 2 + (east - west) * 0.35 * Math.sin((t + step) * 2);
      const y = Math.sin((nextLon - lon) * Math.PI / 180) * Math.cos(nextLat * Math.PI / 180);
      const x = Math.cos(lat * Math.PI / 180) * Math.sin(nextLat * Math.PI / 180) -
                Math.sin(lat * Math.PI / 180) * Math.cos(nextLat * Math.PI / 180) * Math.cos((nextLon - lon) * Math.PI / 180);
      const heading = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

      const simPos = {
        lat,
        lon,
        accuracy: 2.1 + Math.sin(t) * 0.5,
        altitude: 15.4 + Math.cos(t) * 1.2,
        altitudeAccuracy: 1.0,
        heading: Math.round(heading),
        speed: 4.8, // 4.8 km/h walking speed
        timestamp: Date.now(),
        quality: 'excellent',
        isSimulated: true
      };

      this.currentPosition = simPos;
      this.currentHeading = heading;

      this._emitStatus('simulated', 'Simulated Walk Active');
      this.onLocationCallbacks.forEach(cb => cb(simPos));
      this.onHeadingCallbacks.forEach(cb => cb(heading));
    }, 1000);
  }

  stopSimulation() {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
    this.isSimulating = false;
  }

  _emitStatus(status, message) {
    this.onStatusCallbacks.forEach(cb => cb(status, message));
  }

  _emitError(msg) {
    this.onErrorCallbacks.forEach(cb => cb(msg));
  }
}

// Make globally available
window.GPSTracker = GPSTracker;
