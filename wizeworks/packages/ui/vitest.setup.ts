import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// jsdom doesn't implement ResizeObserver — several Radix primitives use it
// (Slider, ScrollArea, etc.). A minimal stub is enough for unit tests.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
}

// Radix Select also calls hasPointerCapture / scrollIntoView, both no-ops in jsdom.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
}

// silicaui-react checks, in development, that its CSS plugin is loaded by reading
// the `--sui-plugin` sentinel the plugin sets on <html>. Tests load no CSS, so the
// check retried for 3 seconds — and when a test file finished first, its next
// retry ran after jsdom was torn down and threw `getComputedStyle is not
// defined`, failing the run on a slow CI machine and passing on a fast one.
// Setting the sentinel says what is true for a unit test: styling is not under test.
if (typeof document !== 'undefined') {
  document.documentElement.style.setProperty('--sui-plugin', '1');
}
