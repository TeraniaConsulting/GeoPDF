/**
 * app.js
 * Main Controller for Terania GeoPDF Field Navigator PWA.
 * Orchestrates GeoPDF parsing, real-time GPS tracking, Leaflet GIS mapping,
 * and high-resolution CAD plan sheet visualization.
 */

class TeraniaGeoApp {
  constructor() {
    // Core Engine Instances
    this.pdfRenderer = new PDFRenderer();
    this.gpsTracker = new GPSTracker();
    this.fieldTools = new FieldTools(this);
    this.geoData = null;
    this.geoTransform = null;

    // View States
    this.viewMode = 'map'; // 'map' or 'plan'
    this.currentPosition = null;
    this.followMe = true;
    this.pdfOpacity = 0.85;
    this.invertColors = false;

    // Leaflet Instances
    this.leafletMap = null;
    this.pdfOverlay = null;
    this.userMarker = null;
    this.accuracyCircle = null;
    this.headingCone = null;
    this.basemaps = {};
    this.activeBasemap = 'satellite';
    this._basemapFailures = {}; // providers that failed during this session
    this._autoFallbackActive = false;
    this._pendingMapFit = false;
    this.basemapAttribution = {
      satellite: 'Imagery © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics',
      street: 'Tiles © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> — HERE, Garmin, © OpenStreetMap contributors',
      osm: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      carto: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
      grid: 'Offline surveyor grid — no map data'
    };

    // Plan View (Canvas Pan & Zoom) States
    this.planScale = 1.0;
    this.planPanX = 0;
    this.planPanY = 0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.pinchDist = null;

    // High-resolution detail rendering (page rendered in scale-1 points)
    this._pageWidthPts = 0;
    this._pageHeightPts = 0;
    this._planDetailCanvas = null;
    this._planDetailTimer = null;
    this._planDetailToken = 0;
    this._planDetailKey = '';

    this.isMeasuring = false;
    this.measureLayer = null;

    // Site Code State
    this.currentSiteCode = null;
    this._loadQueue = Promise.resolve(); // serialises PDF loads across rapid code switches
    this._loadToken = 0;

    // Initialize UI and Event Handlers
    this._initElements();
    this._setupEventListeners();
    this._initGPS();
    this._checkUrlSiteCode();
  }

  /**
   * Cache DOM Elements
   */
  _initElements() {
    this.el = {
      // Header
      lblActivePlan: document.getElementById('lbl-active-plan'),
      gpsStatusIndicator: document.getElementById('gps-status-indicator'),
      lblGpsStatus: document.getElementById('lbl-gps-status'),
      modeToggleGroup: document.getElementById('mode-toggle-group'),
      btnModeMap: document.getElementById('btn-mode-map'),
      btnModePlan: document.getElementById('btn-mode-plan'),
      btnOpenSiteModal: document.getElementById('btn-open-site-modal'),
      inputPdfFile: document.getElementById('input-pdf-file'),
      btnOpenFile: document.getElementById('btn-open-file'),
      btnToggleDrawer: document.getElementById('btn-toggle-drawer'),
      
      // Viewports
      mapContainer: document.getElementById('map-container'),
      planContainer: document.getElementById('plan-container'),
      planCanvasWrapper: document.getElementById('plan-canvas-wrapper'),
      planCanvas: document.getElementById('plan-canvas'),
      planGpsMarker: document.getElementById('plan-gps-marker'),
      planHeadingCone: document.getElementById('plan-heading-cone'),

      // Welcome Screen, Site Code & Dropzone
      welcomeScreen: document.getElementById('welcome-screen'),
      welcomeDropzone: document.getElementById('welcome-dropzone'),
      formSiteCode: document.getElementById('form-site-code'),
      inputSiteCode: document.getElementById('input-site-code'),
      btnLoadSiteCode: document.getElementById('btn-load-site-code'),
      btnLoadDemo: document.getElementById('btn-load-demo'),

      // Floating Controls & HUD
      mapFloatingControls: document.getElementById('map-floating-controls'),
      btnLocateMe: document.getElementById('btn-locate-me'),
      btnFollowMe: document.getElementById('btn-follow-me'),
      btnFitExtent: document.getElementById('btn-fit-extent'),
      btnToggleLayers: document.getElementById('btn-toggle-layers'),
      btnMeasureTool: document.getElementById('btn-measure-tool'),
      layerCard: document.getElementById('layer-card'),
      sliderOpacity: document.getElementById('slider-opacity'),
      lblOpacityVal: document.getElementById('lbl-opacity-val'),
      selectBasemap: document.getElementById('select-basemap'),
      mapAttribution: document.getElementById('map-attribution'),
      chkInvertColors: document.getElementById('chk-invert-colors'),

      // Telemetry HUD
      telemetryHud: document.getElementById('telemetry-hud'),
      hudPlanName: document.getElementById('hud-plan-name'),
      hudCrsTag: document.getElementById('hud-crs-tag'),
      lblLatLon: document.getElementById('lbl-latlon'),
      lblGrid: document.getElementById('lbl-grid'),
      lblAccuracy: document.getElementById('lbl-accuracy'),
      lblSpeedBearing: document.getElementById('lbl-speed-bearing'),
      btnHudCopyCoords: document.getElementById('btn-hud-copy-coords'),
      btnHudAddWaypoint: document.getElementById('btn-hud-add-waypoint'),
      btnHudSimulate: document.getElementById('btn-hud-simulate'),
      btnHudInfo: document.getElementById('btn-hud-info'),

      // Proximity Banner
      proximityBanner: document.getElementById('proximity-banner'),
      proximityText: document.getElementById('proximity-text'),

      // Drawer & Modals
      drawerBackdrop: document.getElementById('drawer-backdrop'),
      sideDrawer: document.getElementById('side-drawer'),
      btnCloseDrawer: document.getElementById('btn-close-drawer'),
      waypointsContainer: document.getElementById('waypoints-list-container'),
      btnExportGeoJson: document.getElementById('btn-export-geojson'),
      btnExportCsv: document.getElementById('btn-export-csv'),

      modalWaypoint: document.getElementById('modal-waypoint'),
      formWaypoint: document.getElementById('form-waypoint'),
      inputWpName: document.getElementById('input-wp-name'),
      selectWpCategory: document.getElementById('select-wp-category'),
      inputWpNotes: document.getElementById('input-wp-notes'),
      btnCancelWaypoint: document.getElementById('btn-cancel-waypoint'),

      modalSiteCode: document.getElementById('modal-site-code'),
      formModalSiteCode: document.getElementById('form-modal-site-code'),
      inputModalSiteCode: document.getElementById('input-modal-site-code'),
      btnCancelSiteModal: document.getElementById('btn-cancel-site-modal'),

      modalInfo: document.getElementById('modal-info'),
      infoContent: document.getElementById('info-content'),
      btnCloseInfo: document.getElementById('btn-close-info'),
      toast: document.getElementById('toast')
    };
  }

  /**
   * Set up DOM Event Listeners
   */
  _setupEventListeners() {
    // File Selection
    this.el.btnOpenFile.addEventListener('click', () => this.el.inputPdfFile.click());
    this.el.inputPdfFile.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) this.loadFile(file);
    });

    // Welcome Screen Dropzone
    this.el.welcomeDropzone.addEventListener('click', () => this.el.inputPdfFile.click());

    // Site Code Submission (Welcome Screen)
    if (this.el.formSiteCode) {
      this.el.formSiteCode.addEventListener('submit', e => {
        e.preventDefault();
        const code = this.el.inputSiteCode.value;
        if (code) this.loadSiteCode(code);
      });
    }

    // Site Code Modal Dialog
    if (this.el.btnOpenSiteModal) {
      this.el.btnOpenSiteModal.addEventListener('click', () => {
        if (this.el.modalSiteCode) {
          this.el.inputModalSiteCode.value = this.currentSiteCode || '';
          this.el.modalSiteCode.classList.add('active');
          setTimeout(() => this.el.inputModalSiteCode.focus(), 60);
        }
      });
    }

    if (this.el.btnCancelSiteModal) {
      this.el.btnCancelSiteModal.addEventListener('click', () => {
        if (this.el.modalSiteCode) this.el.modalSiteCode.classList.remove('active');
      });
    }

    if (this.el.formModalSiteCode) {
      this.el.formModalSiteCode.addEventListener('submit', e => {
        e.preventDefault();
        const code = this.el.inputModalSiteCode.value;
        if (this.el.modalSiteCode) this.el.modalSiteCode.classList.remove('active');
        if (code) this.loadSiteCode(code);
      });
    }
    
    // Drag and drop handlers
    window.addEventListener('dragover', e => {
      e.preventDefault();
      this.el.welcomeDropzone.classList.add('dragover');
    });
    window.addEventListener('dragleave', () => this.el.welcomeDropzone.classList.remove('dragover'));
    window.addEventListener('drop', e => {
      e.preventDefault();
      this.el.welcomeDropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.toLowerCase().endsWith('.pdf')) {
          this.loadFile(file);
        } else {
          this.showToast('Please drop a valid .pdf file');
        }
      }
    });

    // Load Demo GeoPDF Button
    this.el.btnLoadDemo.addEventListener('click', () => this.loadDemoFile());

    // View Mode Switching (Map vs Plan)
    this.el.btnModeMap.addEventListener('click', () => this.switchMode('map'));
    this.el.btnModePlan.addEventListener('click', () => this.switchMode('plan'));

    // Floating Map Buttons
    this.el.btnLocateMe.addEventListener('click', () => this.centerOnUser());
    this.el.btnFollowMe.addEventListener('click', () => this.toggleFollowMe());
    this.el.btnFitExtent.addEventListener('click', () => this.fitToGeoPDFExtent());
    this.el.btnToggleLayers.addEventListener('click', () => {
      this.el.layerCard.classList.toggle('active');
    });

    // Opacity Slider & Basemap Switcher
    this.el.sliderOpacity.addEventListener('input', e => {
      this.pdfOpacity = e.target.value / 100;
      this.el.lblOpacityVal.textContent = `${e.target.value}%`;
      if (this.pdfOverlay) {
        this.pdfOverlay.setOpacity(this.pdfOpacity);
      }
    });

    this.el.selectBasemap.addEventListener('change', e => {
      this.setBasemap(e.target.value);
    });

    this.el.chkInvertColors.addEventListener('change', e => {
      this.invertColors = e.target.checked;
      this._applyPdfFilter();
    });

    // Measurement Tool
    this.el.btnMeasureTool.addEventListener('click', () => this.toggleMeasurement());

    // HUD Actions
    this.el.btnHudCopyCoords.addEventListener('click', () => this.copyCoordinates());
    this.el.btnHudAddWaypoint.addEventListener('click', () => this.openAddWaypointModal());
    this.el.btnHudSimulate.addEventListener('click', () => this.toggleSimulation());
    this.el.btnHudInfo.addEventListener('click', () => this.openInfoModal());

    // Drawer Controls
    this.el.btnToggleDrawer.addEventListener('click', () => this.openDrawer());
    this.el.btnCloseDrawer.addEventListener('click', () => this.closeDrawer());
    this.el.drawerBackdrop.addEventListener('click', () => this.closeDrawer());
    this.el.btnExportGeoJson.addEventListener('click', () => this.fieldTools.exportGeoJSON());
    this.el.btnExportCsv.addEventListener('click', () => this.fieldTools.exportCSV());

    // Waypoint Modal
    this.el.formWaypoint.addEventListener('submit', () => this.saveWaypoint());
    this.el.btnCancelWaypoint.addEventListener('click', () => this.closeWaypointModal());

    // Info Modal
    this.el.btnCloseInfo.addEventListener('click', () => this.el.modalInfo.classList.remove('active'));

    // Plan View Touch & Mouse Pan/Zoom
    this._setupPlanInteractions();

    // Keep the map and high-resolution PDF crops in sync on orientation
    // changes / window resizes.
    window.addEventListener('resize', () => {
      if (this.leafletMap) this.leafletMap.invalidateSize();
      this._schedulePlanDetailRender();
    });

    // Retry tile providers when connectivity returns.
    window.addEventListener('online', () => {
      this._basemapFailures = {};
      if (this._autoFallbackActive && this.activeBasemap === 'grid') {
        this._autoFallbackActive = false;
        this.setBasemap('street');
        this.showToast('Network restored — street map reloaded');
      }
    });
  }

  /**
   * Initialize GPS and Orientation Handlers
   */
  _initGPS() {
    this.gpsTracker.onStatusChange((status, msg) => {
      this.el.lblGpsStatus.textContent = msg;
      this.el.gpsStatusIndicator.className = `gps-indicator ${status}`;
    });

    this.gpsTracker.onLocation(pos => {
      this.currentPosition = pos;
      this.updateLocationDisplay(pos);
    });

    this.gpsTracker.onHeading(heading => {
      this.updateHeadingDisplay(heading);
    });

    this.gpsTracker.onError(msg => {
      this.showToast(msg);
    });

    // Start tracking
    this.gpsTracker.start();
  }

  /**
   * Build a set of plausible URLs for a site code. Handles case variants
   * and stray spaces so a case-sensitive host still resolves, without
   * ever listing the contents of the sites/ folder.
   */
  _siteCodeCandidates(cleanCode) {
    const cands = [];
    const seen = new Set();
    const add = c => {
      if (!c || seen.has(c)) return;
      seen.add(c);
      cands.push(`./sites/${encodeURIComponent(c)}.pdf`);
    };

    add(cleanCode);                              // lowercase base (as cleaned)
    add(cleanCode.replace(/\s+/g, ''));          // strip spaces
    add(cleanCode.replace(/[-\s_]+/g, ''));      // strip separators
    add(cleanCode.toUpperCase());
    add(cleanCode[0].toUpperCase() + cleanCode.slice(1)); // Capitalized
    return cands;
  }

  /**
   * Load GeoPDF by Site Code (e.g. "brownsck" -> "sites/brownsck.pdf").
   *
   * The code is never listed or guessed: only the exact code that was
   * entered resolves to a plan, so clients cannot discover plans that
   * weren't shared with them.
   * @param {string} rawCode
   */
  async loadSiteCode(rawCode) {
    if (!rawCode) return;
    const cleanCode = rawCode.trim().toLowerCase().replace(/\.pdf$/i, '');
    if (!cleanCode) {
      this.showToast('Please enter a valid site code.');
      return;
    }

    this.showToast(`Loading site plan "${cleanCode}"...`);

    let resp = null;
    let networkIssue = false;

    // Only the entered code is attempted (several case/spelling variants
    // of that single code, never a directory listing).
    for (const url of this._siteCodeCandidates(cleanCode)) {
      try {
        const testResp = await fetch(url, { cache: 'no-store' });
        if (testResp.ok) {
          resp = testResp;
          break;
        }
      } catch (e) {
        // fetch threw: connection error, CORS, or file:// (opened locally)
        networkIssue = true;
      }
    }

    if (!resp) {
      // Demo aliases are intentionally public sample content.
      if (cleanCode === 'demo' || cleanCode === 'lismore' || cleanCode === 'testdcdb') {
        return this.loadDemoFile();
      }

      if (networkIssue) {
        this.showToast('Cannot reach the plan server. If opened as a local file, serve this folder (e.g. python -m http.server) or use the hosted link, then try again.');
        return;
      }

      // Deliberately generic - never reveal which other site codes exist.
      this.showToast(`Site code "${cleanCode}" not found or not shared with you. Please check the code and try again.`);
      return;
    }

    try {
      const buffer = await resp.arrayBuffer();
      const filename = `${cleanCode}.pdf`;
      this.currentSiteCode = cleanCode;

      // Update input fields
      if (this.el.inputSiteCode) this.el.inputSiteCode.value = cleanCode;
      if (this.el.inputModalSiteCode) this.el.inputModalSiteCode.value = cleanCode;

      // Sync URL parameter so the link is shareable
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('site', cleanCode);
        window.history.replaceState({}, '', url.pathname + url.search);
      } catch (e) {
        // URL replaceState failure is non-fatal
      }

      await this.processPdfBuffer(buffer, filename);
    } catch (err) {
      console.error('Error loading site code:', err);
      this.showToast(`Failed to load site "${cleanCode}": ${err.message}`);
    }
  }

  /**
   * Check URL parameters or hash for automatic site code loading (?site=brownsck or #brownsck)
   */
  _checkUrlSiteCode() {
    try {
      const params = new URLSearchParams(window.location.search);
      const siteParam = params.get('site') || params.get('code') || params.get('plan');
      const hashParam = window.location.hash ? window.location.hash.replace(/^#/, '').trim() : '';
      const targetCode = siteParam || hashParam;

      if (targetCode) {
        // Run after initial browser microtasks
        setTimeout(() => this.loadSiteCode(targetCode), 100);
      }
    } catch (e) {
      console.warn('Could not parse URL site parameters:', e);
    }
  }

  /**
   * Load GeoPDF from File Object
   */
  async loadFile(file) {
    this.showToast(`Loading ${file.name}...`);
    try {
      const buffer = await file.arrayBuffer();
      await this.processPdfBuffer(buffer, file.name);
    } catch (err) {
      console.error('Error opening PDF:', err);
      this.showToast('Failed to load PDF file: ' + err.message);
    }
  }

  /**
   * Load Built-in Demo GeoPDF
   */
  async loadDemoFile() {
    this.showToast('Loading Lismore DCDB GeoPDF...');
    try {
      const resp = await fetch('./sample/testdcdb_MGA56.pdf');
      if (!resp.ok) throw new Error('Demo file not found');
      const buffer = await resp.arrayBuffer();
      await this.processPdfBuffer(buffer, 'Lismore_DCDB_MGA56.pdf');
    } catch (err) {
      console.error('Error loading demo PDF:', err);
      this.showToast('Failed to load demo file: ' + err.message);
    }
  }

  /**
   * Process PDF ArrayBuffer: Parse Geo, Render Page, Set Up Map & Plan
   *
   * Loads are serialised through a queue so rapid code switches or repeated
   * clicks can never fight over the shared PDF.js renderer (which would hang
   * the page). Stale loads are discarded via a generation token.
   */
  processPdfBuffer(buffer, filename) {
    const token = ++this._loadToken;
    const run = () => this._processPdfBufferNow(buffer, filename, token);
    const result = this._loadQueue.then(run, run);
    this._loadQueue = result.catch(() => {});
    return result;
  }

  async _processPdfBufferNow(buffer, filename, token) {
    // 1. Parse Geospatial Metadata
    const geoData = await GeoPDFParser.parse(buffer);

    // A newer load started while we were parsing - discard this one.
    if (token !== this._loadToken) return;

    if (!geoData.isGeoreferenced) {
      this.showToast('Notice: This PDF does not contain embedded geospatial tags.');
      return;
    }

    this.geoData = geoData;

    // 2. Initialize Coordinate Transformation Engine
    this.geoTransform = new GeoTransform(this.geoData);

    // 3. Render Page 1 to High-DPI Canvas
    await this.pdfRenderer.loadDocument(buffer);
    const renderRes = await this.pdfRenderer.renderPage(1, 2.0);

    if (token !== this._loadToken) return; // superseded while rendering

    // Page size in scale-1 canvas points, shared by both views.
    const baseScale = this.pdfRenderer.scale || 2.0;
    this._pageWidthPts = renderRes.width / baseScale;
    this._pageHeightPts = renderRes.height / baseScale;

    // 4. Update UI Header and Labels
    this.el.lblActivePlan.textContent = filename;
    this.el.hudPlanName.textContent = this.geoData.name || filename;
    this.el.hudCrsTag.textContent = this.geoTransform.crsName;
    this.el.welcomeScreen.style.display = 'none';
    this.el.modeToggleGroup.style.display = 'flex';
    this.el.mapFloatingControls.style.display = 'flex';
    this.el.telemetryHud.classList.add('active');

    // 5. Initialize or Update Leaflet Map
    this._initLeafletMap(renderRes);

    // 6. Initialize Plan Sheet Canvas View
    this._initPlanSheet(renderRes.canvas);

    this.showToast(`GeoPDF loaded: ${this.geoTransform.crsName}`);

    // If we have an existing GPS fix, immediately update
    if (this.currentPosition) {
      this.updateLocationDisplay(this.currentPosition);
    }
  }

  /**
   * Initialize Leaflet GIS Map
   * @param {{dataUrl: string, width: number, height: number}} renderRes
   */
  _initLeafletMap(renderRes) {
    const bounds = this.geoData.boundsLatLng;
    const center = [bounds.centerLat, bounds.centerLon];

    if (!this.leafletMap) {
      this.leafletMap = L.map('map-container', {
        center: center,
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
        maxZoom: 24
      });

      // Basemap Tile Layers. maxNativeZoom keeps tile requests within what
      // each provider actually serves; above it Leaflet upscales the tiles
      // while the GeoPDF overlay is re-rendered sharply by PDF.js.
      const tileOptions = { maxNativeZoom: 19, maxZoom: 24 };

      this.basemaps.satellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        tileOptions
      );

      // No-key street map fallback. Works in regions/networks where
      // openstreetmap.org is blocked or unreachable.
      this.basemaps.street = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        tileOptions
      );

      // Canonical OSM tile endpoint (the a/b/c subdomains are deprecated).
      this.basemaps.osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        ...tileOptions,
        attribution: '© OpenStreetMap contributors'
      });

      this.basemaps.carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', tileOptions);

      this.basemaps.grid = L.gridLayer({ maxZoom: 24 }); // Offline blank grid

      // Detect a provider that is completely unreachable (offline, DNS block,
      // tile-policy block) and fall back automatically instead of leaving the
      // map blank.
      Object.keys(this.basemaps).forEach(name => this._watchBasemapHealth(name));

      this.basemaps[this.activeBasemap].addTo(this.leafletMap);
      this._updateAttribution();

      // Tap on map for coordinate inspector
      this.leafletMap.on('click', e => this.handleMapClick(e.latlng));
    }

    // Set or replace GeoPDF Image Overlay
    if (this.pdfOverlay) {
      this.leafletMap.removeLayer(this.pdfOverlay);
      this.pdfOverlay = null;
    }

    // Place the page through the GeoPDF affine transform instead of stretching
    // it across an axis-aligned lat/lon box.  The bbox approach ignores page
    // margins/title blocks and grid convergence, which distorts X/Y scale.
    this.pdfOverlay = new GeoPDFOverlay(renderRes.dataUrl, this.geoTransform, {
      renderScale: this.pdfRenderer.scale || 2.0,
      width: renderRes.width,
      height: renderRes.height,
      pageWidth: this._pageWidthPts,
      pageHeight: this._pageHeightPts,
      opacity: this.pdfOpacity,
      filter: this._pdfFilterStyle(),
      fetchCrop: (rect, scale) => this._renderPdfCrop(rect, scale)
    }).addTo(this.leafletMap);

    this.pdfOverlay.setFilter(this._pdfFilterStyle());

    // Fit the map to the georeferenced viewport (the sheet itself keeps its
    // real-world page size, including any margins/title block).
    const imageBounds = [
      [bounds.south, bounds.west],
      [bounds.north, bounds.east]
    ];

    // fitBounds against a hidden (zero-size) map would clamp to maxZoom, so
    // defer it until Map View is actually visible.
    if (this.el.mapContainer.clientWidth && this.el.mapContainer.clientHeight) {
      this._pendingMapFit = false;
      this.leafletMap.fitBounds(imageBounds, { padding: [40, 40] });
    } else {
      this._pendingMapFit = true;
    }

    // Create GPS location marker on map
    if (!this.userMarker) {
      const pulseHtml = `
        <div style="position: relative; width: 32px; height: 32px;">
          <div id="leaflet-heading-cone" style="position: absolute; top: -14px; left: 4px; width: 0; height: 0; border-left: 12px solid transparent; border-right: 12px solid transparent; border-bottom: 22px solid rgba(0, 122, 255, 0.4); transform-origin: 12px 30px; display: none;"></div>
          <div style="width: 18px; height: 18px; background-color: #007aff; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 2px 10px rgba(0, 122, 255, 0.7); position: absolute; top: 7px; left: 7px;"></div>
        </div>
      `;

      const userIcon = L.divIcon({
        className: 'user-gps-div-icon',
        html: pulseHtml,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      this.userMarker = L.marker(center, { icon: userIcon, zIndexOffset: 1000 }).addTo(this.leafletMap);
      this.accuracyCircle = L.circle(center, {
        radius: 10,
        color: '#007aff',
        fillColor: '#007aff',
        fillOpacity: 0.15,
        weight: 1
      }).addTo(this.leafletMap);
    }

    this.renderWaypointsOnMap();
  }

  /**
   * CSS filter used for the PDF raster (night mode)
   */
  _pdfFilterStyle() {
    return this.invertColors ? 'invert(1) hue-rotate(180deg) brightness(1.1) contrast(1.2)' : 'none';
  }

  /**
   * Apply the current PDF filter to every PDF raster surface.
   */
  _applyPdfFilter() {
    const filter = this._pdfFilterStyle();
    if (this.pdfOverlay) this.pdfOverlay.setFilter(filter);
    this.el.planCanvas.style.filter = filter;
    if (this._planDetailCanvas) this._planDetailCanvas.style.filter = filter;
  }

  /**
   * Render a page crop for the map overlay's high-resolution detail layer.
   * @param {{x:number,y:number,width:number,height:number}} rect
   * @param {number} scale
   * @returns {Promise<HTMLCanvasElement>}
   */
  _renderPdfCrop(rect, scale) {
    return this.pdfRenderer.renderRegion(rect.x, rect.y, rect.width, rect.height, scale);
  }

  /**
   * Human-readable name for a basemap provider.
   */
  _basemapLabel(name) {
    return {
      satellite: 'Esri Satellite',
      street: 'Esri Street Map',
      osm: 'OpenStreetMap',
      carto: 'Carto Positron',
      grid: 'Surveyor Grid'
    }[name] || name;
  }

  /**
   * Show the correct provider attribution. Leaflet's built-in attribution
   * control is disabled so the credit can sit in the top-left, clear of the
   * telemetry HUD.
   */
  _updateAttribution() {
    const el = this.el.mapAttribution;
    if (!el) return;
    const html = this.basemapAttribution[this.activeBasemap] || '';
    el.innerHTML = html;
    el.style.display = html && this.viewMode === 'map' ? 'block' : 'none';
  }

  /**
   * Watch a tile layer for a total failure (no tiles loaded at all) and
   * trigger the fallback chain. A couple of missing edge tiles are ignored.
   */
  _watchBasemapHealth(name) {
    const layer = this.basemaps[name];
    if (!layer || name === 'grid' || layer._teraniaHealthWatch) return;
    layer._teraniaHealthWatch = true;

    let loaded = 0;
    let errors = 0;
    let timer = null;

    layer.on('add', () => {
      loaded = 0;
      errors = 0;
      clearTimeout(timer);
      timer = null;
    });

    // Reset per tile batch so a provider that goes offline mid-session is
    // still detected (rather than relying on tiles loaded earlier).
    layer.on('loading', () => {
      loaded = 0;
      errors = 0;
      clearTimeout(timer);
      timer = null;
    });

    layer.on('tileload', () => {
      loaded++;
    });

    layer.on('tileerror', () => {
      errors++;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (this.activeBasemap !== name) return;
        if (loaded === 0 && errors >= 2) {
          this._handleBasemapFailure(name);
        }
      }, 2500);
    });

    layer.on('remove', () => {
      clearTimeout(timer);
      timer = null;
    });
  }

  /**
   * Switch to the next working provider, or the offline grid if every
   * provider is unreachable.
   */
  _handleBasemapFailure(name) {
    if (this._basemapFailures[name] || this.activeBasemap !== name) return;
    this._basemapFailures[name] = true;

    const fallbackOrder = {
      satellite: ['street', 'osm'],
      street: ['osm', 'satellite'],
      osm: ['street', 'satellite'],
      carto: ['osm', 'street']
    };

    const next = (fallbackOrder[name] || []).find(candidate =>
      this.basemaps[candidate] && !this._basemapFailures[candidate]
    );

    if (next) {
      this.setBasemap(next, { auto: true });
      this.showToast(`${this._basemapLabel(name)} tiles unavailable — switched to ${this._basemapLabel(next)}`);
    } else {
      this.setBasemap('grid', { auto: true });
      this._autoFallbackActive = true;
      this.showToast('Map tile servers unreachable — switched to offline survey grid');
    }
  }

  /**
   * Set Basemap Style
   * @param {string} name
   * @param {{auto?: boolean}} [opts]
   */
  setBasemap(name, opts = {}) {
    if (!this.leafletMap || !this.basemaps[name]) return;

    // A manual selection is also a retry, so clear any earlier failure.
    if (!opts.auto) {
      delete this._basemapFailures[name];
      this._autoFallbackActive = false;
    }

    if (this.basemaps[this.activeBasemap]) {
      this.leafletMap.removeLayer(this.basemaps[this.activeBasemap]);
    }
    this.activeBasemap = name;
    this.basemaps[name].addTo(this.leafletMap);

    if (this.el.selectBasemap && this.el.selectBasemap.value !== name) {
      this.el.selectBasemap.value = name;
    }
    this._updateAttribution();

    // Re-bring PDF overlay to front
    if (this.pdfOverlay) {
      this.pdfOverlay.bringToFront();
    }
  }

  /**
   * Initialize Plan Sheet Canvas
   */
  _initPlanSheet(renderedCanvas) {
    const target = this.el.planCanvas;
    target.width = renderedCanvas.width;
    target.height = renderedCanvas.height;
    const ctx = target.getContext('2d');
    ctx.drawImage(renderedCanvas, 0, 0);
    target.style.filter = this._pdfFilterStyle();

    // Detail layer: a screen-resolution crop of the visible sheet region,
    // drawn on top of the 2x base canvas when zoomed in.
    this._planDetailToken++;
    this._planDetailKey = '';
    clearTimeout(this._planDetailTimer);

    if (!this._planDetailCanvas) {
      const detail = document.createElement('canvas');
      detail.id = 'plan-detail-canvas';
      detail.style.position = 'absolute';
      detail.style.left = '0';
      detail.style.top = '0';
      detail.style.display = 'none';
      detail.style.pointerEvents = 'none';
      detail.style.zIndex = '5';
      detail.style.filter = this._pdfFilterStyle();
      this.el.planCanvasWrapper.appendChild(detail);
      this._planDetailCanvas = detail;
    } else {
      this._planDetailCanvas.width = 0;
      this._planDetailCanvas.height = 0;
      this._planDetailCanvas.style.display = 'none';
      this._planDetailCanvas.style.filter = this._pdfFilterStyle();
    }

    // Reset pan and zoom to fit screen
    this.fitPlanToScreen();
  }

  /**
   * Reset Plan View transform to fit screen
   */
  fitPlanToScreen() {
    const container = this.el.planContainer;
    const canvas = this.el.planCanvas;
    if (!canvas.width || !container.clientWidth) return;

    const scaleX = (container.clientWidth * 0.92) / canvas.width;
    const scaleY = (container.clientHeight * 0.92) / canvas.height;
    this.planScale = Math.min(scaleX, scaleY);

    this.planPanX = (container.clientWidth - canvas.width * this.planScale) / 2;
    this.planPanY = (container.clientHeight - canvas.height * this.planScale) / 2;

    this._updatePlanTransform();
  }

  /**
   * Update Plan Canvas CSS Transform
   */
  _updatePlanTransform() {
    this.el.planCanvasWrapper.style.transform = `translate(${this.planPanX}px, ${this.planPanY}px) scale(${this.planScale})`;
    this._schedulePlanDetailRender();
  }

  /**
   * Debounced re-render of the crisp Plan View detail crop. The base canvas
   * stays visible (slightly soft) while the new crop is prepared.
   */
  _schedulePlanDetailRender() {
    if (!this.pdfRenderer.pdfDoc || !this._planDetailCanvas) return;
    clearTimeout(this._planDetailTimer);
    this._planDetailTimer = setTimeout(() => this._renderPlanDetail(), 180);
  }

  /**
   * Render the visible part of the sheet at the screen's native pixel
   * density and place it over the base canvas in wrapper coordinates.
   */
  async _renderPlanDetail() {
    if (!this.pdfRenderer.pdfDoc || !this.geoData) return;

    const detail = this._planDetailCanvas;
    const base = this.el.planCanvas;
    const container = this.el.planContainer;
    if (!detail || !base.width || !container.clientWidth) return;

    const baseScale = this.pdfRenderer.scale || 2.0;
    const dpr = window.devicePixelRatio || 1;
    const devicePxPerPt = this.planScale * baseScale * dpr;

    // At fit / low zoom the 2x base canvas already has enough pixels.
    if (devicePxPerPt <= baseScale * 1.05) {
      detail.style.display = 'none';
      return;
    }

    // Visible rectangle in base-canvas pixels -> page points.
    let x0 = -this.planPanX / this.planScale / baseScale;
    let y0 = -this.planPanY / this.planScale / baseScale;
    let x1 = (container.clientWidth - this.planPanX) / this.planScale / baseScale;
    let y1 = (container.clientHeight - this.planPanY) / this.planScale / baseScale;

    // Pad so a short pan stays sharp while the debounce settles.
    const padX = (x1 - x0) * 0.12;
    const padY = (y1 - y0) * 0.12;
    x0 -= padX;
    x1 += padX;
    y0 -= padY;
    y1 += padY;

    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(this._pageWidthPts, x1);
    y1 = Math.min(this._pageHeightPts, y1);

    const width = x1 - x0;
    const height = y1 - y0;
    if (width <= 0.25 || height <= 0.25) {
      detail.style.display = 'none';
      return;
    }

    let scale = devicePxPerPt;

    // Keep the crop canvas within sensible browser limits.
    const area = width * height;
    const maxPixels = 10000000;
    if (area * scale * scale > maxPixels) {
      scale = Math.sqrt(maxPixels / area);
    }
    scale = Math.min(scale, 8192 / width, 8192 / height);
    if (!isFinite(scale) || scale <= 0) return;

    const key = [
      x0.toFixed(2), y0.toFixed(2),
      width.toFixed(2), height.toFixed(2),
      scale.toFixed(2)
    ].join('|');
    if (key === this._planDetailKey) return;

    const token = ++this._planDetailToken;
    this._planDetailKey = key;

    try {
      const canvas = await this.pdfRenderer.renderRegion(x0, y0, width, height, scale);
      if (token !== this._planDetailToken || !this._planDetailCanvas) return;

      detail.width = canvas.width;
      detail.height = canvas.height;
      detail.getContext('2d').drawImage(canvas, 0, 0);

      // CSS size is in base-canvas (wrapper) pixels, not page points.
      detail.style.left = `${x0 * baseScale}px`;
      detail.style.top = `${y0 * baseScale}px`;
      detail.style.width = `${width * baseScale}px`;
      detail.style.height = `${height * baseScale}px`;
      detail.style.display = 'block';
      detail.style.filter = this._pdfFilterStyle();
    } catch (err) {
      console.warn('Plan detail render failed:', err);
    }
  }

  /**
   * Set up Plan Sheet Canvas Touch & Mouse Gestures
   */
  _setupPlanInteractions() {
    const container = this.el.planContainer;

    // Mouse Pan
    container.addEventListener('mousedown', e => {
      this.isPanning = true;
      this.panStartX = e.clientX - this.planPanX;
      this.panStartY = e.clientY - this.planPanY;
    });

    window.addEventListener('mousemove', e => {
      if (!this.isPanning) return;
      this.planPanX = e.clientX - this.panStartX;
      this.planPanY = e.clientY - this.panStartY;
      this._updatePlanTransform();
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
    });

    // Mouse Wheel Zoom
    container.addEventListener('wheel', e => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const newScale = Math.max(0.05, Math.min(20.0, this.planScale * zoomFactor));

      this.planPanX = mouseX - (mouseX - this.planPanX) * (newScale / this.planScale);
      this.planPanY = mouseY - (mouseY - this.planPanY) * (newScale / this.planScale);
      this.planScale = newScale;

      this._updatePlanTransform();
    }, { passive: false });

    // Touch Pinch-to-Zoom & Pan
    container.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        this.isPanning = true;
        this.panStartX = e.touches[0].clientX - this.planPanX;
        this.panStartY = e.touches[0].clientY - this.planPanY;
      } else if (e.touches.length === 2) {
        this.isPanning = false;
        this.pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    });

    container.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && this.isPanning) {
        this.planPanX = e.touches[0].clientX - this.panStartX;
        this.planPanY = e.touches[0].clientY - this.panStartY;
        this._updatePlanTransform();
      } else if (e.touches.length === 2 && this.pinchDist) {
        const newDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = newDist / this.pinchDist;
        this.planScale = Math.max(0.05, Math.min(20.0, this.planScale * factor));
        this.pinchDist = newDist;
        this._updatePlanTransform();
      }
    });

    container.addEventListener('touchend', () => {
      this.isPanning = false;
      this.pinchDist = null;
    });

    // Tap on Plan to inspect coordinates
    container.addEventListener('click', e => {
      if (this.isPanning) return;
      const rect = this.el.planCanvas.getBoundingClientRect();
      const canvasX = (e.clientX - rect.left) / this.planScale;
      const canvasY = (e.clientY - rect.top) / this.planScale;

      if (this.geoTransform) {
        // Since canvas was rendered at scale 2.0x, convert to unscaled PDF canvas points
        const renderScale = this.pdfRenderer.scale || 2.0;
        const ptX = canvasX / renderScale;
        const ptY = canvasY / renderScale;

        const gps = this.geoTransform.canvasToGps(ptX, ptY);
        if (gps) {
          this.handleMapClick(L.latLng(gps.lat, gps.lon));
        }
      }
    });
  }

  /**
   * Switch Between Map Mode and Plan Mode
   */
  switchMode(mode) {
    this.viewMode = mode;
    if (mode === 'map') {
      this.el.btnModeMap.classList.add('active');
      this.el.btnModePlan.classList.remove('active');
      this.el.mapContainer.classList.add('active');
      this.el.planContainer.classList.remove('active');
      if (this.leafletMap) {
        this.leafletMap.invalidateSize();
        if (this._pendingMapFit && this.geoData) {
          this._pendingMapFit = false;
          this.fitToGeoPDFExtent();
        }
      }
    } else {
      this.el.btnModePlan.classList.add('active');
      this.el.btnModeMap.classList.remove('active');
      this.el.planContainer.classList.add('active');
      this.el.mapContainer.classList.remove('active');
      this.fitPlanToScreen();
    }
    this._updateAttribution();
  }

  /**
   * Update Real-time Location Displays
   */
  updateLocationDisplay(pos) {
    const lat = pos.lat;
    const lon = pos.lon;
    const accuracy = pos.accuracy;

    // 1. Update Telemetry HUD
    this.el.lblLatLon.textContent = `${lat.toFixed(6)}°, ${lon.toFixed(6)}°`;
    this.el.lblAccuracy.textContent = `± ${accuracy.toFixed(1)} m (${pos.quality})`;

    // Speed & Bearing
    const speedStr = `${(pos.speed || 0).toFixed(1)} km/h`;
    const headingStr = pos.heading !== null ? `${Math.round(pos.heading)}°` : '---°';
    this.el.lblSpeedBearing.textContent = `${speedStr} | ${headingStr}`;

    // Grid Coordinates (MGA Zone 56 / Proj4)
    if (this.geoTransform) {
      const grid = this.geoTransform.toGrid(lat, lon);
      this.el.lblGrid.textContent = `E: ${grid.easting.toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} | N: ${grid.northing.toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;

      // Check proximity / site containment
      const rel = this.geoTransform.getRelativePosition(lat, lon);
      if (rel && !rel.inside) {
        this.el.proximityBanner.classList.add('active');
        this.el.proximityText.textContent = `Site plan is ${Math.round(rel.distanceMeters)} m ${rel.bearingText} (bearing ${rel.bearingDeg}°)`;
      } else {
        this.el.proximityBanner.classList.remove('active');
      }
    }

    // 2. Update Leaflet Marker & Accuracy Aura
    if (this.userMarker && this.leafletMap) {
      const latlng = [lat, lon];
      this.userMarker.setLatLng(latlng);
      this.accuracyCircle.setLatLng(latlng);
      this.accuracyCircle.setRadius(accuracy);

      if (this.followMe && this.viewMode === 'map') {
        this.leafletMap.panTo(latlng, { animate: true, duration: 0.5 });
      }
    }

    // 3. Update Plan Sheet Marker
    if (this.geoTransform) {
      const canvasPt = this.geoTransform.gpsToCanvas(lat, lon);
      if (canvasPt) {
        const renderScale = this.pdfRenderer.scale || 2.0;
        const screenX = canvasPt.x * renderScale;
        const screenY = canvasPt.y * renderScale;

        this.el.planGpsMarker.style.display = 'block';
        this.el.planGpsMarker.style.left = `${screenX}px`;
        this.el.planGpsMarker.style.top = `${screenY}px`;

        if (this.followMe && this.viewMode === 'plan') {
          // Center plan view on this position
          const container = this.el.planContainer;
          this.planPanX = container.clientWidth / 2 - screenX * this.planScale;
          this.planPanY = container.clientHeight / 2 - screenY * this.planScale;
          this._updatePlanTransform();
        }
      }
    }
  }

  /**
   * Update Heading / Compass Display
   */
  updateHeadingDisplay(heading) {
    if (heading === null) return;

    // Leaflet Heading Cone
    const leafletCone = document.getElementById('leaflet-heading-cone');
    if (leafletCone) {
      leafletCone.style.display = 'block';
      leafletCone.style.transform = `rotate(${heading}deg)`;
    }

    // Plan View Heading Cone
    if (this.el.planHeadingCone) {
      this.el.planHeadingCone.style.transform = `rotate(${heading}deg)`;
    }
  }

  /**
   * Center view on current user location
   */
  centerOnUser() {
    if (!this.currentPosition) {
      this.showToast('Waiting for GPS satellite fix...');
      return;
    }

    if (this.viewMode === 'map' && this.leafletMap) {
      this.leafletMap.setView([this.currentPosition.lat, this.currentPosition.lon], 18, { animate: true });
    } else if (this.viewMode === 'plan' && this.geoTransform) {
      const canvasPt = this.geoTransform.gpsToCanvas(this.currentPosition.lat, this.currentPosition.lon);
      if (canvasPt) {
        const renderScale = this.pdfRenderer.scale || 2.0;
        const screenX = canvasPt.x * renderScale;
        const screenY = canvasPt.y * renderScale;
        const container = this.el.planContainer;
        this.planPanX = container.clientWidth / 2 - screenX * this.planScale;
        this.planPanY = container.clientHeight / 2 - screenY * this.planScale;
        this._updatePlanTransform();
      }
    }
    this.showToast('Centered on GPS location');
  }

  /**
   * Toggle Follow Me Mode
   */
  toggleFollowMe() {
    this.followMe = !this.followMe;
    this.el.btnFollowMe.classList.toggle('active', this.followMe);
    this.showToast(this.followMe ? 'Follow Me: ON' : 'Follow Me: OFF');
  }

  /**
   * Fit view to GeoPDF bounds
   */
  fitToGeoPDFExtent() {
    if (!this.geoData) return;

    if (this.viewMode === 'map' && this.leafletMap) {
      const b = this.geoData.boundsLatLng;
      this.leafletMap.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [40, 40] });
    } else {
      this.fitPlanToScreen();
    }
  }

  /**
   * Copy Real-time Coordinates to Clipboard
   */
  copyCoordinates() {
    if (!this.currentPosition) return;
    const lat = this.currentPosition.lat;
    const lon = this.currentPosition.lon;

    let text = `Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`;
    if (this.geoTransform) {
      const g = this.geoTransform.toGrid(lat, lon);
      text += ` | ${g.crs}: Easting ${g.easting.toFixed(2)}, Northing ${g.northing.toFixed(2)}`;
    }

    navigator.clipboard.writeText(text).then(() => {
      this.showToast('Coordinates copied to clipboard!');
    }).catch(() => {
      this.showToast(text);
    });
  }

  /**
   * Toggle Walk Simulation (for desktop/office testing)
   */
  toggleSimulation() {
    if (!this.geoData) {
      this.showToast('Please load a GeoPDF first');
      return;
    }

    if (this.gpsTracker.isSimulating) {
      this.gpsTracker.stopSimulation();
      this.gpsTracker.start();
      this.el.btnHudSimulate.classList.remove('active');
      this.showToast('Walk Simulation Stopped');
    } else {
      this.gpsTracker.startSimulation(this.geoData.boundsLatLng);
      this.el.btnHudSimulate.classList.add('active');
      this.showToast('Simulating live walking track across site plan...');
    }
  }

  /**
   * Handle Click / Tap on Map or Plan for inspection
   */
  handleMapClick(latlng) {
    if (this.isMeasuring) {
      this.addMeasurePoint(latlng);
      return;
    }

    let msg = `Lat: ${latlng.lat.toFixed(6)}, Lon: ${latlng.lng.toFixed(6)}`;
    if (this.geoTransform) {
      const g = this.geoTransform.toGrid(latlng.lat, latlng.lng);
      msg += `\n${g.crs}\nE: ${g.easting.toFixed(2)} m | N: ${g.northing.toFixed(2)} m`;
    }

    if (this.leafletMap && this.viewMode === 'map') {
      L.popup()
        .setLatLng(latlng)
        .setContent(`<div style="font-family: inherit; font-size: 0.85rem; line-height: 1.4;"><strong>Inspection Point</strong><br>${msg.replace(/\n/g, '<br>')}</div>`)
        .openOn(this.leafletMap);
    } else {
      this.showToast(msg);
    }
  }

  /**
   * Open Add Waypoint Modal
   */
  openAddWaypointModal() {
    if (!this.currentPosition) {
      this.showToast('No GPS position locked yet');
      return;
    }
    this.el.inputWpName.value = `Point ${this.fieldTools.waypoints.length + 1}`;
    this.el.inputWpNotes.value = '';
    this.el.modalWaypoint.classList.add('active');
  }

  closeWaypointModal() {
    this.el.modalWaypoint.classList.remove('active');
  }

  saveWaypoint() {
    if (!this.currentPosition) return;
    const name = this.el.inputWpName.value.trim() || 'Waypoint';
    const cat = this.el.selectWpCategory.value;
    const note = this.el.inputWpNotes.value.trim();

    let easting = null, northing = null;
    if (this.geoTransform) {
      const g = this.geoTransform.toGrid(this.currentPosition.lat, this.currentPosition.lon);
      easting = g.easting;
      northing = g.northing;
    }

    this.fieldTools.addWaypoint({
      name,
      category: cat,
      note,
      lat: this.currentPosition.lat,
      lon: this.currentPosition.lon,
      easting,
      northing,
      altitude: this.currentPosition.altitude
    });

    this.closeWaypointModal();
    this.renderWaypointsOnMap();
    this.updateDrawerWaypoints();
    this.showToast(`Waypoint "${name}" saved!`);
  }

  renderWaypointsOnMap() {
    if (!this.leafletMap) return;

    if (!this.waypointLayerGroup) {
      this.waypointLayerGroup = L.layerGroup().addTo(this.leafletMap);
    }
    this.waypointLayerGroup.clearLayers();

    this.fieldTools.waypoints.forEach(w => {
      const marker = L.circleMarker([w.lat, w.lon], {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: '#d93838',
        fillOpacity: 0.95
      });

      marker.bindPopup(`
        <div style="font-family: inherit; font-size: 0.85rem;">
          <strong>${w.name}</strong> [${w.category}]<br>
          Lat: ${w.lat.toFixed(6)}, Lon: ${w.lon.toFixed(6)}<br>
          ${w.easting ? `E: ${w.easting.toFixed(2)} | N: ${w.northing.toFixed(2)}<br>` : ''}
          ${w.note ? `<em>${w.note}</em><br>` : ''}
          <small>${new Date(w.timestamp).toLocaleString()}</small>
        </div>
      `);

      this.waypointLayerGroup.addLayer(marker);
    });
  }

  openDrawer() {
    this.updateDrawerWaypoints();
    this.el.drawerBackdrop.classList.add('active');
    this.el.sideDrawer.classList.add('active');
  }

  closeDrawer() {
    this.el.drawerBackdrop.classList.remove('active');
    this.el.sideDrawer.classList.remove('active');
  }

  updateDrawerWaypoints() {
    const wps = this.fieldTools.waypoints;
    if (wps.length === 0) {
      this.el.waypointsContainer.innerHTML = '<p style="color: var(--color-neutral); font-size: 0.9rem; text-align: center; margin-top: 2rem;">No waypoints recorded yet. Tap "Drop Pin" to save a site feature or inspection mark.</p>';
      return;
    }

    let html = '';
    wps.forEach(w => {
      html += `
        <div class="waypoint-item">
          <div class="waypoint-header">
            <span class="waypoint-name">${w.name}</span>
            <span class="waypoint-cat">${w.category}</span>
          </div>
          <div class="waypoint-coords">
            ${w.lat.toFixed(6)}°, ${w.lon.toFixed(6)}°
            ${w.easting ? `&bull; E ${Math.round(w.easting)} N ${Math.round(w.northing)}` : ''}
          </div>
          ${w.note ? `<p style="font-size: 0.8rem; color: #444; margin-bottom: 0.4rem;">${w.note}</p>` : ''}
          <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
            <button class="btn btn-outline" style="padding: 0.2rem 0.6rem; font-size: 0.72rem; color: var(--color-dark); border-color: var(--color-border);" onclick="window.appInstance.panToWaypoint('${w.id}')">Zoom</button>
            <button class="btn btn-outline" style="padding: 0.2rem 0.6rem; font-size: 0.72rem; color: var(--color-danger); border-color: var(--color-danger);" onclick="window.appInstance.deleteWaypoint('${w.id}')">Delete</button>
          </div>
        </div>
      `;
    });

    this.el.waypointsContainer.innerHTML = html;
  }

  panToWaypoint(id) {
    const wp = this.fieldTools.waypoints.find(w => w.id === id);
    if (!wp) return;
    this.closeDrawer();
    if (this.viewMode === 'map' && this.leafletMap) {
      this.leafletMap.setView([wp.lat, wp.lon], 19, { animate: true });
    }
  }

  deleteWaypoint(id) {
    this.fieldTools.removeWaypoint(id);
    this.renderWaypointsOnMap();
    this.updateDrawerWaypoints();
  }

  /**
   * Measurement Tool Toggle
   */
  toggleMeasurement() {
    this.isMeasuring = !this.isMeasuring;
    this.el.btnMeasureTool.classList.toggle('active', this.isMeasuring);

    if (this.isMeasuring) {
      this.fieldTools.startMeasurement();
      if (!this.measureLayer && this.leafletMap) {
        this.measureLayer = L.layerGroup().addTo(this.leafletMap);
      }
      this.measureLayer.clearLayers();
      this.showToast('Measure Tool: Click two or more points on the map');
    } else {
      this.fieldTools.stopMeasurement();
      if (this.measureLayer) this.measureLayer.clearLayers();
      this.showToast('Measure Tool Stopped');
    }
  }

  addMeasurePoint(latlng) {
    const summary = this.fieldTools.addMeasurePoint(latlng);

    if (this.measureLayer) {
      L.circleMarker(latlng, { radius: 5, color: '#ff4757', fillColor: '#ffffff', fillOpacity: 1 }).addTo(this.measureLayer);

      if (this.fieldTools.measurePoints.length >= 2) {
        const pts = this.fieldTools.measurePoints.map(p => [p.lat, p.lon || p.lng]);
        L.polyline(pts, { color: '#ff4757', weight: 3, dashArray: '6, 6' }).addTo(this.measureLayer);
      }
    }

    if (summary.totalDistance > 0) {
      const seg = summary.segments[summary.segments.length - 1];
      this.showToast(`Dist: ${summary.totalDistance.toFixed(2)} m (Seg: ${seg.distance.toFixed(1)} m, ${seg.bearing}° ${seg.bearingText})`);
    }
  }

  /**
   * Open Plan Metadata Modal
   */
  openInfoModal() {
    if (!this.geoData) return;

    let html = `
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #eee;"><td style="padding: 6px 0; font-weight: 700;">Plan Title:</td><td>${this.geoData.name || 'N/A'}</td></tr>
        <tr style="border-bottom: 1px solid #eee;"><td style="padding: 6px 0; font-weight: 700;">Standard:</td><td>${this.geoData.standard}</td></tr>
        <tr style="border-bottom: 1px solid #eee;"><td style="padding: 6px 0; font-weight: 700;">CRS / Projection:</td><td>${this.geoTransform.crsName}</td></tr>
        <tr style="border-bottom: 1px solid #eee;"><td style="padding: 6px 0; font-weight: 700;">EPSG Code:</td><td>${this.geoTransform.crsCode}</td></tr>
        <tr style="border-bottom: 1px solid #eee;"><td style="padding: 6px 0; font-weight: 700;">Ground Control Points:</td><td>${this.geoData.gcps ? this.geoData.gcps.length : 0} points</td></tr>
        <tr style="border-bottom: 1px solid #eee;"><td style="padding: 6px 0; font-weight: 700;">Page Dimensions:</td><td>${Math.round(this.geoData.mediaBox[2])} &times; ${Math.round(this.geoData.mediaBox[3])} pt</td></tr>
      </table>
    `;

    if (this.geoData.boundsLatLng) {
      const b = this.geoData.boundsLatLng;
      html += `
        <h4 style="margin-top: 1rem; margin-bottom: 0.5rem; color: var(--color-primary);">Geographic Extent (WGS84)</h4>
        <div style="font-size: 0.8rem; background: #f5f7f6; padding: 0.6rem; border-radius: 6px;">
          North: ${b.north.toFixed(6)}°<br>
          South: ${b.south.toFixed(6)}°<br>
          East: ${b.east.toFixed(6)}°<br>
          West: ${b.west.toFixed(6)}°
        </div>
      `;
    }

    this.el.infoContent.innerHTML = html;
    this.el.modalInfo.classList.add('active');
  }

  showToast(message) {
    this.el.toast.textContent = message;
    this.el.toast.classList.add('show');
    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      this.el.toast.classList.remove('show');
    }, 3200);
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.appInstance = new TeraniaGeoApp();
});
