/**
 * Image Viewer Module
 * Click-to-enlarge with zoom/pan support
 */
(function () {
  'use strict';

  const ZOOM_MIN_SCALE  = 0.2;
  const ZOOM_MAX_SCALE  = 8;
  const WHEEL_ZOOM_STEP = 0.15;
  const BUTTON_ZOOM_STEP = 0.3;

  const ImageViewer = {
  overlay: null,
  img: null,
  container: null,
  scale: 1,
  translateX: 0,
  translateY: 0,
  isDragging: false,
  startX: 0,
  startY: 0,
  hookedRenditions: new WeakSet(),
  hookedDocuments: new WeakSet(),
  _boundDocument: null,
  _contextSeq: 0,
  _rendition: null,

  init() {
    this.overlay = document.getElementById('image-viewer');
    this.img = document.getElementById('image-viewer-img');
    this.container = document.getElementById('image-viewer-container');

    if (this._boundDocument === document) return;
    this._boundDocument = document;

    // Close handlers
    document.getElementById('image-viewer-close')?.addEventListener('click', () => this.close());
    this.overlay?.addEventListener('click', (e) => {
      if (e.target === this.overlay || e.target === this.container) this.close();
    });

    // Zoom controls
    document.getElementById('img-zoom-in')?.addEventListener('click', () => this.zoom(BUTTON_ZOOM_STEP));
    document.getElementById('img-zoom-out')?.addEventListener('click', () => this.zoom(-BUTTON_ZOOM_STEP));
    document.getElementById('img-zoom-reset')?.addEventListener('click', () => this.resetTransform());

    // Mouse wheel zoom
    this.container?.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP;
      this.zoom(delta);
    }, { passive: false });

    // Drag to pan
    this.container?.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.startX = e.clientX - this.translateX;
      this.startY = e.clientY - this.translateY;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.translateX = e.clientX - this.startX;
      this.translateY = e.clientY - this.startY;
      this.applyTransform();
    });

    document.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (!this.overlay || this.overlay.classList.contains('is-hidden')) return;
      if (e.key === 'Escape') this.close();
      if (e.key === '+' || e.key === '=') this.zoom(BUTTON_ZOOM_STEP);
      if (e.key === '-') this.zoom(-BUTTON_ZOOM_STEP);
      if (e.key === '0') this.resetTransform();
    });
  },

  /**
   * Open the image viewer with a given src URL
   * @param {string} src - Image source URL (blob or data URL)
   */
  open(src) {
    this.resetTransform();
    this.img.src = src;
    this.overlay.classList.remove('is-hidden');
    document.body.classList.add('image-viewer-open');
  },

  close() {
    this.overlay.classList.add('is-hidden');
    this.img.src = '';
    document.body.classList.remove('image-viewer-open');
  },

  zoom(delta) {
    this.scale = Math.max(ZOOM_MIN_SCALE, Math.min(ZOOM_MAX_SCALE, this.scale + delta));
    this.applyTransform();
  },

  resetTransform() {
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.applyTransform();
  },

  applyTransform() {
    this.img.style.transform =
      `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
  },


  mount(context) {
    if (!context?.rendition) return;
    this.hookRendition(context.rendition);
  },

  unmount() {
    this._contextSeq++;
    this._rendition = null;
    this.close();
    this.hookedRenditions = new WeakSet();
    this.hookedDocuments = new WeakSet();
  },

  _currentContext() {
    return {
      seq: this._contextSeq,
      rendition: this._rendition
    };
  },

  _isCurrentContext(context) {
    return !!context &&
      context.seq === this._contextSeq &&
      context.rendition === this._rendition;
  },

  /**
   * Hook into epub.js rendition to intercept image clicks inside EPUB iframes
   * @param {object} rendition - epub.js rendition object
   */
  hookRendition(rendition) {
    if (!rendition) return;
    if (this._rendition !== rendition) {
      this._contextSeq++;
      this._rendition = rendition;
    }
    const context = this._currentContext();
    if (!this.hookedRenditions.has(rendition)) {
      this.hookedRenditions.add(rendition);
      rendition.hooks.content.register((contents) => this.bindContentImages(contents, context));
    }

    if (typeof rendition.getContents === 'function') {
      rendition.getContents().forEach((contents) => this.bindContentImages(contents, context));
    }
  },

  bindContentImages(contents, context = this._currentContext()) {
    if (!this._isCurrentContext(context)) return;
    const doc = contents && contents.document;
    if (!doc || this.hookedDocuments.has(doc)) return;
    this.hookedDocuments.add(doc);
    if (typeof doc.querySelectorAll !== 'function') return;

    const images = doc.querySelectorAll('img, image, svg image');
    images.forEach((img) => {
      img.classList.add('image-viewer-zoomable');
      img.addEventListener('click', (e) => {
        if (!this._isCurrentContext(context)) return;
        e.preventDefault();
        e.stopPropagation();

        let src = '';
        if (img.tagName.toLowerCase() === 'img') {
          src = img.src;
        } else {
          // SVG image element
          src = img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || img.getAttribute('href');
        }

        if (src) {
          this.open(src);
        }
      });
    });
  }
  };

  window.ImageViewer = ImageViewer;
})();
