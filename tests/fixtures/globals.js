/**
 * Browser global shims for headless `node --test`. Installed before any source
 * import (via register-loader.mjs) so modules that read globals at evaluation
 * time, or in their constructors, find a faithful-enough stand-in.
 *
 * AudioContext is wired to FakeAudioContext. The most recently constructed
 * context is exposed as `globalThis.__lastAudioContext` so a test can reach the
 * instrumented context the AudioEngine singleton created and inspect node
 * lifecycle.
 *
 * Only the surfaces the source actually touches are shimmed — this is a test
 * harness, not a browser. Anything missing should be added deliberately.
 */

import { FakeAudioContext } from './FakeAudioContext.js';

class InstrumentedAudioContext extends FakeAudioContext {
  constructor(opts) {
    super(opts);
    globalThis.__lastAudioContext = this;
  }
}

globalThis.__lastAudioContext = null;
globalThis.AudioContext = InstrumentedAudioContext;

const listeners = new Map();
const fakeWindow = {
  AudioContext: InstrumentedAudioContext,
  addEventListener: (type, fn) => {
    let arr = listeners.get(type);
    if (!arr) { arr = []; listeners.set(type, arr); }
    arr.push(fn);
  },
  removeEventListener: (type, fn) => {
    const arr = listeners.get(type);
    if (arr) listeners.set(type, arr.filter(f => f !== fn));
  },
  dispatchEvent: (evt) => {
    const arr = listeners.get(evt?.type);
    if (arr) for (const fn of [...arr]) fn(evt);
    return true;
  },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  location: { href: 'http://localhost/', reload() {} },
  navigator: { userAgent: 'node-test', getGamepads: () => [] },
  innerWidth: 1280,
  innerHeight: 800,
};

if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  };
}

if (typeof globalThis.window === 'undefined') globalThis.window = fakeWindow;

if (typeof globalThis.document === 'undefined') {
  const makeEl = () => {
    const el = {
      style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      children: [], attributes: {},
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter(x => x !== c); },
      remove() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
      querySelector: () => null, querySelectorAll: () => [],
      insertAdjacentHTML() {}, focus() {}, blur() {}, click() {},
      get innerHTML() { return ''; }, set innerHTML(_v) {},
    };
    return el;
  };
  globalThis.document = {
    createElement: makeEl,
    createElementNS: makeEl,
    createDocumentFragment: makeEl,
    body: makeEl(),
    documentElement: makeEl(),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null,
  };
}

if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = { userAgent: 'node-test', getGamepads: () => [], mediaDevices: null };
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now?.() ?? Date.now()), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

if (typeof globalThis.URL.createObjectURL === 'undefined') {
  let urlSeq = 0;
  globalThis.URL.createObjectURL = () => `blob:node/${++urlSeq}`;
  globalThis.URL.revokeObjectURL = () => {};
}

// FileReader / Blob / fetch(data:) — used by the audio-asset migration path.
if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = class Blob {
    constructor(parts = [], opts = {}) {
      this._parts = parts;
      this.type = opts.type || '';
      this.size = parts.reduce((n, p) => n + (p?.byteLength ?? p?.length ?? 0), 0);
    }
    async arrayBuffer() {
      const buf = this._parts.find(p => p instanceof ArrayBuffer);
      return buf || new ArrayBuffer(this.size);
    }
  };
}

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsDataURL(blob) {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,`;
      queueMicrotask(() => this.onload && this.onload());
    }
  };
}

export { InstrumentedAudioContext };
