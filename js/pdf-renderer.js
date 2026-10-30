/**
 * pdf-renderer.js
 * High-DPI PDF.js rendering pipeline for Terania GeoPDF.
 * - Renders vector-crisp PDF pages using Mozilla PDF.js
 * - Handles Retina / High-DPI device pixel ratios
 * - Multi-page navigation support
 * - Exports rendered page for Leaflet ImageOverlay or Sheet Canvas
 */

class PDFRenderer {
  constructor() {
    this.pdfDoc = null;
    this.currentPageNum = 1;
    this.numPages = 1;
    this.renderedCanvas = null;
    this.renderedDataUrl = null;
    this.pageViewport = null;
    this.scale = 2.0; // High DPI default scale for survey precision

    // Region renders are serialised so a zoom burst cannot pile up
    // concurrent PDF.js render tasks on the same page.
    this._renderChain = Promise.resolve();

    // Configure PDF.js worker
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = './assets/vendor/pdf.worker.min.js';
    }
  }

  /**
   * Load PDF document from ArrayBuffer
   * @param {ArrayBuffer} arrayBuffer 
   */
  async loadDocument(arrayBuffer) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library is not loaded');
    }

    // Reset render queue for new document
    this._renderChain = Promise.resolve();

    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer
    });

    this.pdfDoc = await loadingTask.promise;
    this.numPages = this.pdfDoc.numPages;
    this.currentPageNum = 1;

    return {
      numPages: this.numPages
    };
  }

  /**
   * Render a specific page to an offscreen or provided canvas
   * @param {number} pageNum 
   * @param {number} renderScale 
   * @param {HTMLCanvasElement} [targetCanvas]
   * @returns {Promise<{canvas: HTMLCanvasElement, dataUrl: string, width: number, height: number}>}
   */
  async renderPage(pageNum = 1, renderScale = 2.0, targetCanvas = null) {
    if (!this.pdfDoc) {
      throw new Error('No PDF document loaded');
    }

    this.currentPageNum = pageNum;
    this.scale = renderScale;

    const run = async () => {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.scale });
      this.pageViewport = viewport;

      const canvas = targetCanvas || document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      // Clean background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const renderContext = {
        canvasContext: ctx,
        viewport: viewport,
        intent: 'display'
      };

      await page.render(renderContext).promise;

      this.renderedCanvas = canvas;
      this.renderedDataUrl = canvas.toDataURL('image/png');

      return {
        canvas,
        dataUrl: this.renderedDataUrl,
        width: canvas.width,
        height: canvas.height,
        viewport
      };
    };

    const result = this._renderChain.then(run, run);
    this._renderChain = result.catch(() => {});
    return result;
  }

  /**
   * Render an arbitrary crop of the current page at a given scale.
   *
   * The crop rectangle (x, y, width, height) is expressed in "canvas points"
   * - the same scale-1, top-left-origin coordinate space used by
   * GeoTransform and by renderPage(..., 1). This lets the map overlay and
   * the plan view re-render only the visible part of the sheet at a pixel
   * density matched to the screen, so text stays crisp at deep zoom without
   * ever allocating a huge full-page canvas.
   *
   * PDF.js viewport offsets are applied in output (canvas) space, so
   * offsetX/offsetY simply shift the crop origin to (0, 0).
   *
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {number} scale Rendered pixels per canvas point.
   * @returns {Promise<HTMLCanvasElement>}
   */
  renderRegion(x, y, width, height, scale) {
    // Serialise renders; callers discard stale results with their own tokens.
    const run = () => this._renderRegionNow(x, y, width, height, scale);
    const result = this._renderChain.then(run, run);
    this._renderChain = result.catch(() => {});
    return result;
  }

  async _renderRegionNow(x, y, width, height, scale) {
    if (!this.pdfDoc) {
      throw new Error('No PDF document loaded');
    }

    const page = await this.pdfDoc.getPage(this.currentPageNum);
    const viewport = page.getViewport({
      scale,
      offsetX: -x * scale,
      offsetY: -y * scale
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
      intent: 'display'
    }).promise;

    return canvas;
  }

  /**
   * Next page
   */
  async nextPage() {
    if (this.currentPageNum < this.numPages) {
      return this.renderPage(this.currentPageNum + 1, this.scale);
    }
    return null;
  }

  /**
   * Previous page
   */
  async prevPage() {
    if (this.currentPageNum > 1) {
      return this.renderPage(this.currentPageNum - 1, this.scale);
    }
    return null;
  }
}

// Make globally available
window.PDFRenderer = PDFRenderer;
