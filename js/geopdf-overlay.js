/**
 * geopdf-overlay.js
 * Affine-corrected raster overlay for georeferenced PDF pages.
 *
 * Leaflet's standard L.imageOverlay can only place an image into an
 * axis-aligned lat/lon box. That assumes the PDF page is exactly the
 * georeferenced extent, north-up and has the same aspect ratio as the
 * geographic bounds. Real plan sheets usually contain margins, title
 * blocks and a grid convergence rotation, so the image ends up stretched
 * (different X/Y scale) and displaced.
 *
 * This layer maps the rendered page through the GeoPDF affine transform
 * (the same one used by the plan view) and applies the resulting matrix
 * with CSS. The raster therefore stays correctly scaled, rotated and
 * positioned against the basemap at every zoom level.
 *
 * Two raster layers are used:
 *   - a full-page base image rendered once at load (always covers the sheet)
 *   - an optional high-resolution crop of just the visible region, rendered
 *     on demand at the screen's pixel density. The crop keeps small text
 *     crisp at deep zoom without allocating a huge full-page canvas.
 */

(function () {
  if (typeof L === 'undefined') return;

  /**
   * Solve a 3x3 linear system with Gauss-Jordan elimination.
   * @param {number[][]} m
   * @param {number[]} rhs
   * @returns {number[]|null}
   */
  function solve3x3(m, rhs) {
    const a = m.map((row, i) => row.concat(rhs[i]));

    for (let col = 0; col < 3; col++) {
      let pivot = col;
      for (let r = col + 1; r < 3; r++) {
        if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
      }
      if (Math.abs(a[pivot][col]) < 1e-12) return null;

      const tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;

      const p = a[col][col];
      for (let c = col; c < 4; c++) a[col][c] /= p;

      for (let r = 0; r < 3; r++) {
        if (r === col) continue;
        const f = a[r][col];
        for (let c = col; c < 4; c++) a[r][c] -= f * a[col][c];
      }
    }

    return [a[0][3], a[1][3], a[2][3]];
  }

  /**
   * Least-squares affine fit: [x, y] -> [u, v].
   * Returns u = a*x + c*y + e and v = b*x + d*y + f.
   */
  function fitAffine(src, dst) {
    const n = src.length;
    if (n < 3) return null;

    let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0;
    let sxu = 0, syu = 0, su = 0;
    let sxv = 0, syv = 0, sv = 0;

    for (let i = 0; i < n; i++) {
      const x = src[i][0], y = src[i][1];
      const u = dst[i][0], v = dst[i][1];

      sxx += x * x;
      sxy += x * y;
      syy += y * y;
      sx += x;
      sy += y;

      sxu += x * u;
      syu += y * u;
      su += u;

      sxv += x * v;
      syv += y * v;
      sv += v;
    }

    const M = [
      [sxx, sxy, sx],
      [sxy, syy, sy],
      [sx, sy, n]
    ];

    const cu = solve3x3(M, [sxu, syu, su]);
    const cv = solve3x3(M, [sxv, syv, sv]);
    if (!cu || !cv) return null;

    return {
      a: cu[0], c: cu[1], e: cu[2],
      b: cv[0], d: cv[1], f: cv[2]
    };
  }

  const GeoPDFOverlay = L.Layer.extend({
    options: {
      opacity: 1,
      interactive: false,
      className: '',
      pane: 'overlayPane',
      renderScale: 1,
      width: 0,
      height: 0,
      pageWidth: 0,
      pageHeight: 0,
      filter: 'none',
      detailDebounce: 220,
      maxDetailPixels: 10000000,
      maxDetailDimension: 8192
    },

    /**
     * @param {string} imageUrl Rendered page as a data URL / blob URL.
     * @param {GeoTransform} geoTransform Coordinate transformer (canvas <-> lat/lon).
     * @param {Object} [options]
     *   fetchCrop(rect, scale) -> Promise<HTMLCanvasElement> renders a page crop.
     *   rect is {x, y, width, height} in scale-1 canvas points.
     */
    initialize(imageUrl, geoTransform, options) {
      L.setOptions(this, options);

      if (!geoTransform || !geoTransform.isReady) {
        throw new Error('GeoPDFOverlay requires a ready GeoTransform');
      }

      this._url = imageUrl;
      this._geoTransform = geoTransform;
      this._renderScale = this.options.renderScale || 1;
      this._width = this.options.width || 0;
      this._height = this.options.height || 0;
      this._pageWidth = this.options.pageWidth || (this._width / this._renderScale) || 0;
      this._pageHeight = this.options.pageHeight || (this._height / this._renderScale) || 0;

      this._container = null;
      this._base = null;
      this._detail = null;
      this._screenPxPerPt = 0;

      this._detailTimer = null;
      this._detailToken = 0;
      this._detailKey = '';

      this._fetchCrop = typeof this.options.fetchCrop === 'function'
        ? this.options.fetchCrop
        : null;

      this._computeBounds();
    },

    onAdd(map) {
      this._map = map;

      // Group both rasters in one container so CSS opacity/filter apply to
      // the composite once (otherwise the base + detail crop would darken
      // each other where they overlap).
      if (!this._container) this._initContainer();
      if (!this._base) this._initImage();
      if (this._base.el.parentNode !== this._container) {
        this._container.appendChild(this._base.el);
      }
      this.getPane().appendChild(this._container);

      this._reset();

      map.on('zoom zoomanim rotate viewreset resize moveend', this._reset, this);
      map.on('moveend zoomend resize', this._scheduleDetail, this);
      this._scheduleDetail();
    },

    onRemove(map) {
      this._detailToken++;
      clearTimeout(this._detailTimer);
      this._detailTimer = null;

      if (this._detail && this._detail.el.parentNode) {
        this._detail.el.parentNode.removeChild(this._detail.el);
      }
      if (this._container && this._container.parentNode) {
        this._container.parentNode.removeChild(this._container);
      }
      this._detail = null;
      this._detailKey = '';

      map.off('zoom zoomanim rotate viewreset resize moveend', this._reset, this);
      map.off('moveend zoomend resize', this._scheduleDetail, this);
      this._map = null;
    },

    getElement() {
      return this._container;
    },

    getBounds() {
      return this._bounds;
    },

    setOpacity(opacity) {
      this.options.opacity = opacity;
      this._updateOpacity();
      return this;
    },

    /**
     * Apply a CSS filter (e.g. night-mode inversion) to the raster group.
     * @param {string} filter
     */
    setFilter(filter) {
      this.options.filter = filter || 'none';
      if (this._container) this._container.style.filter = this.options.filter;
      return this;
    },

    setZIndex(zIndex) {
      this.options.zIndex = zIndex;
      if (this._container) this._container.style.zIndex = zIndex;
      return this;
    },

    bringToFront() {
      if (!this._map) return this;
      const pane = this.getPane();
      if (!pane || !this._container) return this;
      pane.appendChild(this._container);
      return this;
    },

    /**
     * Lat/Lon of the full rendered-page corners, extrapolated through the
     * affine transform. Used for fitting the map to the sheet if required.
     */
    _computeBounds() {
      const corners = this._computeCorners({
        x: 0,
        y: 0,
        width: this._pageWidth,
        height: this._pageHeight
      });
      if (!corners) return;
      this._latLngCorners = corners;
      this._bounds = L.latLngBounds(corners);
    },

    /**
     * Map a rectangle of the page (scale-1 canvas points) to four lat/lngs.
     * @param {{x:number,y:number,width:number,height:number}} rect
     * @returns {L.LatLng[]|null}
     */
    _computeCorners(rect) {
      const t = this._geoTransform;
      if (!t || !rect) return null;

      const points = [
        [rect.x, rect.y],
        [rect.x + rect.width, rect.y],
        [rect.x + rect.width, rect.y + rect.height],
        [rect.x, rect.y + rect.height]
      ];

      const latLngs = [];
      for (const [x, y] of points) {
        const gps = t.canvasToGps(x, y);
        if (!gps) return null;
        latLngs.push(L.latLng(gps.lat, gps.lon));
      }
      return latLngs;
    },

    _initContainer() {
      const container = document.createElement('div');
      container.className = 'geopdf-overlay-container';
      container.style.position = 'absolute';
      container.style.left = '0';
      container.style.top = '0';
      container.style.width = '0';
      container.style.height = '0';
      container.style.transformOrigin = '0 0';
      container.style.pointerEvents = 'none';
      container.style.opacity = this.options.opacity;
      container.style.filter = this.options.filter || 'none';
      if (this.options.zIndex != null) container.style.zIndex = this.options.zIndex;
      this._container = container;
    },

    _initImage() {
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('role', 'presentation');
      img.className = 'leaflet-image-layer leaflet-zoom-animated';
      if (this.options.className) L.DomUtil.addClass(img, this.options.className);

      img.style.position = 'absolute';
      img.style.left = '0';
      img.style.top = '0';
      img.style.width = `${this._width}px`;
      img.style.height = `${this._height}px`;
      img.style.transformOrigin = '0 0';
      img.style.pointerEvents = this.options.interactive ? 'auto' : 'none';
      img.src = this._url;

      this._base = {
        el: img,
        rect: { x: 0, y: 0, width: this._pageWidth, height: this._pageHeight },
        pxW: this._width,
        pxH: this._height,
        corners: this._computeCorners({
          x: 0,
          y: 0,
          width: this._pageWidth,
          height: this._pageHeight
        }),
        matrix: null
      };

      // If dimensions were not supplied, use the natural image size once loaded.
      if (!this._width || !this._height) {
        img.onload = () => {
          if (this._width && this._height) return;
          this._width = img.naturalWidth;
          this._height = img.naturalHeight;
          this._renderScale = this._renderScale || 1;
          this._pageWidth = this._width / this._renderScale;
          this._pageHeight = this._height / this._renderScale;
          img.style.width = `${this._width}px`;
          img.style.height = `${this._height}px`;
          this._base.pxW = this._width;
          this._base.pxH = this._height;
          this._base.rect = {
            x: 0, y: 0,
            width: this._pageWidth,
            height: this._pageHeight
          };
          this._base.corners = this._computeCorners(this._base.rect);
          this._computeBounds();
          this._reset();
        };
      }

      if (this._container) this._container.appendChild(img);
      this._updateOpacity();
    },

    _updateOpacity() {
      if (this._container) this._container.style.opacity = this.options.opacity;
    },

    /**
     * Layer point at a given (possibly target) zoom/center. During a zoom
     * animation Leaflet fires 'zoomanim' before the map origin changes, so we
     * must project against the target view.
     */
    _toLayerPoint(latLng, zoom, center) {
      const map = this._map;

      if (zoom != null && center && typeof map._latLngToNewLayerPoint === 'function') {
        return map._latLngToNewLayerPoint(latLng, zoom, center);
      }

      if (zoom != null) {
        const projected = map.project(latLng, zoom);
        const centerPoint = map.project(center || map.getCenter(), zoom);
        return projected.subtract(centerPoint).add(map.getSize().divideBy(2));
      }

      return map.latLngToLayerPoint(latLng);
    },

    /**
     * Rebuild the CSS matrix mapping image pixels -> layer pixels for one
     * raster layer.
     * @param {Object} layer
     * @param {number|null} zoom
     * @param {L.LatLng|null} center
     */
    _applyMatrix(layer, zoom, center) {
      if (!this._map || !layer || !layer.el || !layer.corners) return;
      const w = layer.pxW;
      const h = layer.pxH;
      if (!w || !h) return;

      const points = layer.corners.map(latLng =>
        this._toLayerPoint(latLng, zoom, center)
      );

      const fit = fitAffine(
        [[0, 0], [w, 0], [w, h], [0, h]],
        points.map(p => [p.x, p.y])
      );
      if (!fit) return;

      const matrix = `matrix(${fit.a}, ${fit.b}, ${fit.c}, ${fit.d}, ${fit.e}, ${fit.f})`;
      if (matrix !== layer.matrix) {
        layer.matrix = matrix;
        layer.el.style.transform = matrix;
      }

      if (layer === this._base && layer.rect.width) {
        // Screen pixels per scale-1 page point, used to size detail crops.
        const pxPerImagePx = Math.hypot(fit.a, fit.b);
        this._screenPxPerPt = pxPerImagePx * (w / layer.rect.width);
      }
    },

    /**
     * Rebuild the CSS matrix for every raster layer.
     * @param {Object} [e] Leaflet event (zoomanim provides target zoom/center).
     */
    _reset(e) {
      if (!this._map || !this._base) return;

      const targetZoom = e && e.zoom != null ? e.zoom : null;
      const targetCenter = e && e.center ? e.center : null;

      this._applyMatrix(this._base, targetZoom, targetCenter);
      if (this._detail) this._applyMatrix(this._detail, targetZoom, targetCenter);
    },

    _scheduleDetail() {
      if (!this._fetchCrop || !this._map) return;
      clearTimeout(this._detailTimer);
      this._detailTimer = setTimeout(() => this._refreshDetail(), this.options.detailDebounce);
    },

    /**
     * Render only the visible part of the sheet at screen-matched resolution
     * and swap it in when ready.
     */
    _refreshDetail() {
      if (!this._map || !this._fetchCrop || !this._screenPxPerPt) return;

      const mapEl = this._map.getContainer();
      if (!mapEl.clientWidth || !mapEl.clientHeight) return;

      const size = this._map.getSize();
      if (!size.x || !size.y) return;

      // Visible map rectangle -> page coordinates (bbox is fine: grid
      // convergence is tiny compared with the crop padding).
      const pagePts = [];
      for (const p of [[0, 0], [size.x, 0], [size.x, size.y], [0, size.y]]) {
        const latLng = this._map.containerPointToLatLng(p);
        const gps = this._geoTransform.gpsToCanvas(latLng.lat, latLng.lng);
        if (!gps) return;
        pagePts.push(gps);
      }

      let minX = Math.min(...pagePts.map(p => p.x));
      let maxX = Math.max(...pagePts.map(p => p.x));
      let minY = Math.min(...pagePts.map(p => p.y));
      let maxY = Math.max(...pagePts.map(p => p.y));

      // Pad so short pans stay sharp while the debounced re-render runs.
      const padX = (maxX - minX) * 0.15;
      const padY = (maxY - minY) * 0.15;
      minX -= padX;
      maxX += padX;
      minY -= padY;
      maxY += padY;

      // Clamp to the page.
      minX = Math.max(0, minX);
      minY = Math.max(0, minY);
      maxX = Math.min(this._pageWidth, maxX);
      maxY = Math.min(this._pageHeight, maxY);

      const width = maxX - minX;
      const height = maxY - minY;
      if (width <= 0.5 || height <= 0.5) return;

      const dpr = window.devicePixelRatio || 1;
      let scale = this._screenPxPerPt * dpr;

      // Below the base image density there is nothing to gain.
      if (scale < this._renderScale * 0.9) {
        this._removeDetail();
        return;
      }

      // Cap the crop canvas so very large screens / zooms stay responsive.
      const area = width * height;
      const maxPixels = this.options.maxDetailPixels;
      if (area * scale * scale > maxPixels) {
        scale = Math.sqrt(maxPixels / area);
      }
      const maxDim = this.options.maxDetailDimension;
      scale = Math.min(scale, maxDim / width, maxDim / height);
      if (!isFinite(scale) || scale <= 0) return;

      // Quantise to avoid pointless re-renders.
      const key = [
        Math.round(minX), Math.round(minY),
        Math.round(width), Math.round(height),
        scale.toFixed(2)
      ].join('|');
      if (key === this._detailKey) return;

      const token = ++this._detailToken;
      this._detailKey = key;

      const rect = { x: minX, y: minY, width, height };
      Promise.resolve()
        .then(() => this._fetchCrop(rect, scale))
        .then(canvas => {
          if (!canvas || token !== this._detailToken || !this._map) return;
          this._setDetail(canvas, rect);
        })
        .catch(err => {
          if (token === this._detailToken) this._detailKey = '';
          console.warn('GeoPDF detail render failed:', err);
        });
    },

    _setDetail(canvas, rect) {
      const corners = this._computeCorners(rect);
      if (!corners) return;

      if (this._detail && this._detail.el.parentNode) {
        this._detail.el.parentNode.removeChild(this._detail.el);
      }

      canvas.className = 'leaflet-image-layer leaflet-zoom-animated geopdf-detail-layer';
      if (this.options.className) L.DomUtil.addClass(canvas, this.options.className);
      canvas.style.position = 'absolute';
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.width = `${canvas.width}px`;
      canvas.style.height = `${canvas.height}px`;
      canvas.style.transformOrigin = '0 0';
      canvas.style.pointerEvents = 'none';

      this._detail = {
        el: canvas,
        rect,
        pxW: canvas.width,
        pxH: canvas.height,
        corners,
        matrix: null
      };

      if (this._container) this._container.appendChild(canvas);
      this._applyMatrix(this._detail, null, null);
    },

    _removeDetail() {
      this._detailToken++;
      if (this._detail) {
        if (this._detail.el.parentNode) {
          this._detail.el.parentNode.removeChild(this._detail.el);
        }
        this._detail = null;
      }
      this._detailKey = '';
    }
  });

  L.GeoPDFOverlay = GeoPDFOverlay;
  L.geoPDFOverlay = function (imageUrl, geoTransform, options) {
    return new GeoPDFOverlay(imageUrl, geoTransform, options);
  };

  // Make globally available (consistent with the other app modules)
  window.GeoPDFOverlay = GeoPDFOverlay;
})();
