import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import {
  PLAYER_ROLE_CAMPAIGN,
  writeStoredPlayerRole,
} from '../playerRole.js';

beforeEach(() => {
  // Existing Slice 1/2 UI tests expect diagram + TriggerPanel; campaign lens
  // matches that surface. Role-gate tests pass initialPlayerRole={null}.
  writeStoredPlayerRole(PLAYER_ROLE_CAMPAIGN);
});

afterEach(() => {
  cleanup();
});

class ResizeObserver {
  constructor(callback) {
    this.callback = callback;
  }

  observe(target) {
    this.callback([
      {
        target,
        contentRect: { width: 220, height: 80, top: 0, left: 0, bottom: 80, right: 220 },
      },
    ]);
  }

  unobserve() {}
  disconnect() {}
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserver;
}

if (typeof Element !== 'undefined') {
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      width: 220,
      height: 80,
      top: 0,
      left: 0,
      bottom: 80,
      right: 220,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    };
  };
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  });
}

// jsdom lacks DOMMatrix*; @xyflow reads zoom from the viewport transform.
if (typeof window !== 'undefined' && typeof window.DOMMatrixReadOnly !== 'function') {
  window.DOMMatrixReadOnly = class DOMMatrixReadOnly {
    constructor(init) {
      this.m22 = 1;
      if (typeof init === 'string') {
        const scale = init.match(/matrix\(([^)]+)\)/i);
        if (scale) {
          const parts = scale[1].split(',').map((part) => Number(part.trim()));
          if (Number.isFinite(parts[3])) this.m22 = parts[3];
        }
      }
    }
  };
}
