/**
 * ambient.js - Aurora Glass Dynamic Ambient Cover Palette Extractor
 * Extracts 3-4 dominant colors from album artwork (32x32 downscale),
 * applies WCAG AA luminance clamps, and coordinates 900ms cross-fading.
 */

import { store } from '../core/store.js';
import { settings } from '../core/settings.js';

export class AmbientManager {
  constructor() {
    this.layerA = null;
    this.layerB = null;
    this.activeLayer = 'A';
    this.defaultColors = [
      'rgb(16, 24, 38)',
      'rgb(14, 20, 32)',
      'rgb(12, 17, 26)',
      'rgb(10, 14, 22)'
    ];
    this.cachedPalette = new Map();
  }

  init() {
    this.layerA = document.getElementById('ambientLayerA');
    this.layerB = document.getElementById('ambientLayerB');

    // Apply default palette immediately
    this.applyPalette(this.defaultColors);

    store.subscribe('currentTrack', (track) => {
      this.updateFromTrack(track);
    });

    settings.subscribe('theme', () => {
      this.cachedPalette.clear();
      const currentTrack = store.get('currentTrack');
      if (currentTrack) {
        this.updateFromTrack(currentTrack);
      } else {
        this.applyPalette(this.defaultColors);
      }
    });
  }

  async updateFromTrack(track) {
    if (!track || !track.metadata?.pictureUrl) {
      this.applyPalette(this.defaultColors);
      return;
    }

    const cacheKey = track.id || track.path;
    if (this.cachedPalette.has(cacheKey)) {
      this.applyPalette(this.cachedPalette.get(cacheKey));
      return;
    }

    try {
      const colors = await this.extractColorsFromImage(track.metadata.pictureUrl);
      this.cachedPalette.set(cacheKey, colors);
      this.applyPalette(colors);
    } catch {
      this.applyPalette(this.defaultColors);
    }
  }

  extractColorsFromImage(imageUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 32;
          canvas.height = 32;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ ambientColors: this.defaultColors, accents: null });
            return;
          }

          ctx.drawImage(img, 0, 0, 32, 32);
          const imgData = ctx.getImageData(0, 0, 32, 32).data;
          const result = this.quantizeColors(imgData);
          resolve(result && result.ambientColors?.length >= 3 ? result : { ambientColors: this.defaultColors, accents: null });
        } catch {
          resolve({ ambientColors: this.defaultColors, accents: null });
        }
      };

      img.onerror = () => {
        resolve({ ambientColors: this.defaultColors, accents: null });
      };

      img.src = imageUrl;
    });
  }

  quantizeColors(data) {
    // Collect non-trivial pixels (avoid pure white and pure black)
    const samples = [];
    for (let i = 0; i < data.length; i += 16) { // step by 4 pixels (16 bytes)
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 128) continue;
      const sum = r + g + b;
      if (sum < 40 || sum > 710) continue; // Skip near black and near white

      samples.push([r, g, b]);
    }

    if (samples.length === 0) return { ambientColors: this.defaultColors, accents: null };

    // Sort into frequency buckets by quantized 12-bit key
    const buckets = new Map();
    for (const [r, g, b] of samples) {
      const qr = (r >> 4) << 4;
      const qg = (g >> 4) << 4;
      const qb = (b >> 4) << 4;
      const key = `${qr},${qg},${qb}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }

    const sorted = [...buckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0].split(',').map(Number));

    // Select top distinct colors with color-distance threshold
    const chosen = [];
    const rawDistinct = [];
    for (const [r, g, b] of sorted) {
      const isFarEnough = rawDistinct.every(([cr, cg, cb]) => {
        const dist = Math.hypot(r - cr, g - cg, b - cb);
        return dist > 55;
      });

      if (isFarEnough) {
        rawDistinct.push([r, g, b]);
        // Clamp luminance & saturation for WCAG AA text contrast
        chosen.push(this.clampForWcagAa(r, g, b));
      }
      if (chosen.length === 4) break;
    }

    // Fill remaining if fewer than 4
    while (chosen.length < 4) {
      chosen.push(this.defaultColors[chosen.length]);
    }

    const accents = this.deriveAccents(rawDistinct);
    return { ambientColors: chosen, accents };
  }

  rgbToHsl(r, g, b) {
    const rf = r / 255;
    const gf = g / 255;
    const bf = b / 255;
    const max = Math.max(rf, gf, bf);
    const min = Math.min(rf, gf, bf);
    let h = 0;
    let s = 0;
    let l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case rf: h = (gf - bf) / d + (gf < bf ? 6 : 0); break;
        case gf: h = (bf - rf) / d + 2; break;
        case bf: h = (rf - gf) / d + 4; break;
      }
      h /= 6;
    }
    return { h, s, l };
  }

  deriveAccents(rawDistinct) {
    if (!rawDistinct || rawDistinct.length === 0) return null;
    const [r, g, b] = rawDistinct[0];
    const { h } = this.rgbToHsl(r, g, b);
    const primary = this.hslToRgbString(h, 0.82, 0.58);
    let secondary;
    if (rawDistinct.length > 1) {
      const { h: h2 } = this.rgbToHsl(rawDistinct[1][0], rawDistinct[1][1], rawDistinct[1][2]);
      secondary = this.hslToRgbString(h2, 0.78, 0.55);
    } else {
      secondary = this.hslToRgbString((h + 0.12) % 1, 0.78, 0.55);
    }
    const glow = this.hslToRgbString(h, 0.82, 0.58, 0.35);
    return { primary, secondary, glow };
  }

  clampForWcagAa(r, g, b) {
    const { h } = this.rgbToHsl(r, g, b);
    const isLight = typeof document !== 'undefined' && document.documentElement?.getAttribute('data-theme') === 'light';
    const s = isLight ? 0.48 : 0.42;
    const l = isLight ? 0.85 : 0.18;
    return this.hslToRgbString(h, s, l);
  }

  hslToRgbString(h, s, l, alpha = null) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        let vt = t;
        if (vt < 0) vt += 1;
        if (vt > 1) vt -= 1;
        if (vt < 1 / 6) return p + (q - p) * 6 * vt;
        if (vt < 1 / 2) return q;
        if (vt < 2 / 3) return p + (q - p) * (2 / 3 - vt) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    const red = Math.round(r * 255);
    const green = Math.round(g * 255);
    const blue = Math.round(b * 255);
    if (alpha !== null) {
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }
    return `rgb(${red}, ${green}, ${blue})`;
  }

  applyPalette(colors, accents = null) {
    // Support object or array signature
    let ambientList = colors;
    let accentData = accents;
    if (colors && typeof colors === 'object' && !Array.isArray(colors)) {
      ambientList = colors.ambientColors || this.defaultColors;
      accentData = colors.accents || null;
    }

    // Keep brand accent pure Electric Blue across all albums
    // Ambient lighting strictly applied to background layers layerA & layerB

    if (!this.layerA || !this.layerB) return;

    const isDefault = !ambientList || ambientList === this.defaultColors;
    const isLight = typeof document !== 'undefined' && document.documentElement?.getAttribute('data-theme') === 'light';
    let gradient = '';

    if (isLight) {
      if (isDefault) {
        gradient = 'radial-gradient(ellipse at 50% -10%, rgba(199, 210, 254, 0.55) 0%, rgba(224, 242, 254, 0.4) 45%, #f4f6fa 100%)';
      } else {
        const dominant = Array.isArray(ambientList) && ambientList.length > 0 ? ambientList[0] : 'rgb(224, 231, 255)';
        const secondary = Array.isArray(ambientList) && ambientList.length > 1 ? ambientList[1] : dominant;
        gradient = `
          radial-gradient(ellipse at 50% 15%, ${dominant} 0%, rgba(244, 246, 250, 0.8) 65%, #f4f6fa 100%),
          radial-gradient(circle at 85% 10%, ${secondary} 0%, transparent 50%),
          #f4f6fa
        `.trim();
      }
    } else {
      if (isDefault) {
        gradient = 'radial-gradient(ellipse at 50% 0%, rgba(26, 36, 56, 0.35) 0%, rgba(10, 14, 22, 0.75) 60%, #07090e 100%)';
      } else {
        const dominant = Array.isArray(ambientList) && ambientList.length > 0 ? ambientList[0] : 'rgb(20, 30, 48)';
        const secondary = Array.isArray(ambientList) && ambientList.length > 1 ? ambientList[1] : dominant;
        gradient = `
          radial-gradient(ellipse at 50% 15%, ${dominant} 0%, rgba(8, 11, 18, 0.8) 65%, #07090e 100%),
          radial-gradient(circle at 85% 10%, ${secondary} 0%, transparent 45%),
          #07090e
        `.trim();
      }
    }

    // Cross-fade between layers (900ms via CSS opacity)
    if (this.activeLayer === 'A') {
      this.layerB.style.background = gradient;
      this.layerB.classList.add('active');
      this.layerA.classList.remove('active');
      this.activeLayer = 'B';
    } else {
      this.layerA.style.background = gradient;
      this.layerA.classList.add('active');
      this.layerB.classList.remove('active');
      this.activeLayer = 'A';
    }
  }
}

export const ambientManager = new AmbientManager();
