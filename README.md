# Terania GeoPDF Field Navigator (PWA)

A Progressive Web Application (PWA) tailored for Terania surveyors, civil engineers, and field operators. It enables loading any **Georeferenced PDF (GeoPDF)** from a device and visualizing the operator's **real-time location** in the field with sub-centimeter georeferencing precision.

Designed with Terania corporate branding and full **offline capability** for remote field areas with no cellular coverage.

---

## Key Features

- **Dual Viewport Experience**:
  - **GIS Map Overlay View**: Real-time Leaflet GIS mapping with live satellite imagery (Esri), Esri street tiles (no API key), OpenStreetMap, or minimal light basemaps. If a tile provider is blocked or unreachable, the app automatically falls back to the next working provider, and finally to the offline surveyor grid. Zoom up to level 24 (tiles upscale beyond their native zoom) while the GeoPDF overlay is re-rendered sharply at the visible zoom. Smooth opacity slider (0%–100%), provider attribution, and color inversion (night mode).
  - **High-DPI Plan Sheet View**: Smooth canvas viewer displaying the full uncropped engineering drawing, title block, surveyor notes, and dimensions, with real-time GPS positioning plotted directly onto the drawing sheet. Deep zoom (up to 20× the fitted view) uses on-demand, screen-resolution PDF.js crop rendering so fine text and linework stay crisp.
- **Standards-Compliant GeoPDF Parser**:
  - **Adobe ISO 32000-1 / ISO 32000-2**: Parses `/VP`, `/Measure`, `/Subtype /GEO`, `/GPTS`, `/LPTS`, `/Bounds`, and `/GCS` (WKT/EPSG).
  - **OGC 08-139 / TerraGo GeoPDF**: Parses `/LGIDict`, `/Registration`, `/CTM`, and `/Projection` dictionaries.
  - **Compressed Object Streams (`/ObjStm`)**: Automatically decompresses Flate streams with Pako to find compressed geospatial metadata.
- **Coordinate Reference Systems & Australian Datums**:
  - Native support for **GDA2020 / MGA Zone 56** (EPSG:7856 - Northern NSW / Lismore / Ballina / Byron / Tweed), **MGA Zone 55** (EPSG:7855), **MGA Zone 54** (EPSG:7854), and legacy **GDA94** (EPSG:28356/28355).
  - Real-time conversion between WGS84 GPS Lat/Lon (decimal degrees and DMS) and Projected Grid Coordinates (Easting & Northing in meters).
- **Field Navigation & Telemetry**:
  - Live GPS tracking (`navigator.geolocation.watchPosition` with `enableHighAccuracy: true`).
  - GPS precision indicator & accuracy aura ($\pm\text{m}$).
  - Magnetic compass heading & direction orientation cone (via `DeviceOrientationEvent`).
  - "Follow Me" camera tracking mode.
  - Proximity warning banner calculating ground distance and bearing to the site when approaching from outside the boundary.
- **Field Survey Tools**:
  - **Waypoints / Pins**: Drop pins with names, categories (Boundary Peg, Control Point, Pipe/Pit, Hazard), and notes. Export all waypoints as **GeoJSON** or **CSV**.
  - **Ground Distance & Bearing Measurement**: Tap two or more points on the plan to measure true ground distances in meters and azimuth bearing in degrees.
  - **Coordinate Inspector**: Tap anywhere on the plan to inspect its exact Latitude, Longitude, Easting, and Northing.
  - **Simulated Walk**: Test GPS tracking from an office PC with a built-in walk simulation across the site plan.
- **Site Codes & Client Plan Repository**:
  - Upload GeoPDF plans into the `sites/` directory named with their project code (e.g. `sites/brownsck.pdf`, `sites/lismoredcdb.pdf`).
  - Clients and surveyors enter the exact site code (e.g. `brownsck`) in the app, or open a direct URL (`https://your-domain/?site=brownsck` or `#brownsck`) to load the site drawing.
  - **Private by design**: the app never lists or autocompletes site codes, so clients cannot discover plans that weren't shared with them. Only the code that was entered is requested (with a few harmless case/spelling variants of that one code).
  - Loading is serialised and rapid code switches are handled safely; errors are deliberately generic and never reveal other site codes.
  - Plans load over the network and are automatically cached for offline field navigation.
- **Offline PWA Architecture**:
  - All libraries (Leaflet, Proj4, PDF.js, Pako) are bundled locally.
  - Service Worker (`sw.js`) caches the entire application shell, logos, fonts, and sample plans for 100% offline field operation.

---

## Quick Start / Local Testing

Run a local HTTP server from the `geopdf` directory:

```bash
# Using Python
python -m http.server 8080

# Or using Node.js / npx
npx serve
```

Open `http://localhost:8080` in your web browser.

Click **"Load Demo GeoPDF (Lismore MGA56)"** to immediately test the app with a real-world cadastral plan and simulated walking track.

---

## Hosting on GitHub Pages

This application is built with 100% client-side technologies and relative paths (`./`), making it ready for **GitHub Pages**.

### Option A: As a New Standalone GitHub Repository

1. Create a new repository on GitHub (e.g., `terania-geopdf`).
2. Inside the `geopdf` directory, initialize git and push:
   ```bash
   cd "geopdf"
   git init
   git add .
   git commit -m "Initial commit of Terania GeoPDF PWA"
   git branch -M main
   git remote add origin https://github.com/<your-username>/terania-geopdf.git
   git push -u origin main
   ```
3. In your GitHub repository:
   - Go to **Settings** > **Pages**.
   - Under **Build and deployment** > **Source**, select **Deploy from a branch**.
   - Choose `main` branch and `/ (root)` folder, then click **Save**.
4. Your PWA will be live at:
   `https://<your-username>.github.io/terania-geopdf/`

### Option B: Inside an Existing Terania Repository

If you keep the `geopdf` folder inside your existing repository:
- Once pushed, your PWA will be accessible at:
  `https://<your-username>.github.io/<repo-name>/geopdf/`

---

## Installing the PWA on Mobile Devices

### Apple iOS (iPhone & iPad)
1. Open the hosted URL in **Safari**.
2. Tap the **Share** button (box with an upward arrow).
3. Scroll down and tap **"Add to Home Screen"**.
4. The Terania GeoPDF app icon will be added to your home screen and will open in standalone fullscreen mode without browser URL bars.

### Android
1. Open the hosted URL in **Google Chrome**.
2. Tap the three-dot menu icon in the upper right.
3. Tap **"Install app"** or **"Add to Home screen"**.
4. Confirm installation. The app will launch as an independent native-like application.

---

## File Structure

```
geopdf/
├── index.html              # Main PWA application entry point
├── manifest.json           # PWA web manifest (icons, branding, theme)
├── sw.js                   # Service Worker for offline field caching
├── README.md               # Documentation and deployment guide
├── sites/                  # Project GeoPDF repository for site codes (e.g. brownsck.pdf)
├── sample/                 # Built-in demo sample GeoPDF files
├── css/
│   └── style.css           # Terania branded stylesheet & HUD controls
├── js/
│   ├── geopdf-parser.js    # ISO 32000 & TerraGo GeoPDF parser
│   ├── geo-transform.js    # Affine/DLT coordinate transformation & Proj4
│   ├── geopdf-overlay.js   # Affine-corrected GeoPDF raster overlay for Leaflet
│   ├── gps-tracker.js      # Geolocation & device orientation tracking
│   ├── pdf-renderer.js     # High-DPI Mozilla PDF.js rendering pipeline
│   ├── field-tools.js      # Waypoints, measurement & coordinate inspector
│   └── app.js              # Application controller & UI management
├── sample/
│   └── testdcdb_MGA56.pdf  # Verified sample GeoPDF (Lismore DCDB)
└── assets/
    ├── Terania_*.png       # Terania logo set (horizontal, stacked, icon)
    └── vendor/
        ├── leaflet.js / .css
        ├── pdf.min.js / pdf.worker.min.js
        ├── proj4.js
        ├── pako.min.js
        └── images/         # Leaflet map pins & layers controls
```

---

## Brand Compliance

Matches the Terania Take 5 Safety PWA design specifications:
- **Primary Brand Color**: `#005445` (Terania Forest Green)
- **Secondary Accent**: `#f2e7ce` (Warm Sand)
- **Accent Tints**: `#003d32` (Deep Forest), `#fbf8f1` (Light Sand), `#37813d` (Field Green)
- **Typography**: Google Font `Outfit`
- **Official Logos**: Terania horizontal reversed badge on header, Terania stacked icon on welcome screens.
