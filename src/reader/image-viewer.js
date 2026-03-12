/**
 * Image Viewer Module
 * Click-to-enlarge with zoom/pan support
 */
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

  init() {
    this.overlay = document.getElementById('image-viewer');
    this.img = document.getElementById('image-viewer-img');
    this.container = document.getElementById('image-viewer-container');

    // Close handlers
    document.getElementById('image-viewer-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay || e.target === this.container) this.close();
    });

    // Zoom controls
    document.getElementById('img-zoom-in').addEventListener('click', () => this.zoom(0.3));
    document.getElementById('img-zoom-out').addEventListener('click', () => this.zoom(-0.3));
    document.getElementById('img-zoom-reset').addEventListener('click', () => this.resetTransform());

    // Mouse wheel zoom
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      this.zoom(delta);
    }, { passive: false });

    // Drag to pan
    this.container.addEventListener('mousedown', (e) => {
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
      if (this.overlay.classList.contains('is-hidden')) return;
      if (e.key === 'Escape') this.close();
      if (e.key === '+' || e.key === '=') this.zoom(0.3);
      if (e.key === '-') this.zoom(-0.3);
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
    this.scale = Math.max(0.2, Math.min(8, this.scale + delta));
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

  unmount() {},

  /**
   * Hook into epub.js rendition to intercept image clicks inside EPUB iframes
   * @param {object} rendition - epub.js rendition object
   */
  hookRendition(rendition) {
    rendition.hooks.content.register((contents) => {
      const doc = contents.document;
      const images = doc.querySelectorAll('img, image, svg image');

      images.forEach((img) => {
        img.classList.add('image-viewer-zoomable');
        img.addEventListener('click', (e) => {
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
    });
  }
};
