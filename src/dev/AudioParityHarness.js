import { PRESETS } from '../instruments/WebAudioSynth.js';
import {
  debugRenderAllBuiltInPatchWavs,
  debugRenderBuiltInPatchWav,
} from '../export/WavExporter.js';

export function presetIds() {
  return Object.keys(PRESETS);
}

export function renderPatch(presetId = 'chip_lead', options = {}) {
  return debugRenderBuiltInPatchWav(presetId, options);
}

export function renderAll(options = {}) {
  return debugRenderAllBuiltInPatchWavs(options);
}

export function blobUrl(blob) {
  return URL.createObjectURL(blob);
}

export function playPatch(presetId = 'chip_lead', options = {}) {
  const url = blobUrl(renderPatch(presetId, options));
  const audio = new Audio(url);
  audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
  audio.play();
  return { audio, url };
}
