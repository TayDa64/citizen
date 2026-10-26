import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

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
