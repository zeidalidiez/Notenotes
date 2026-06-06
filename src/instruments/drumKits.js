/**
 * drumKits — Drum kit presets, pad sound metadata, and General MIDI drum note
 * map for SketchKit.
 *
 * Pure data, extracted from SketchKit.js so that module can stay focused on
 * drum synthesis and UI. DRUM_KITS is also re-exported from SketchKit.js for
 * backward compatibility.
 */

export const DRUM_KITS = {
  classic: {
    name: 'Classic',
    sounds: {
      kick:    { osc: 'sine',  freq0: 150, freq1: 40,  decay: 0.4,  vol: 1.0, clicks: false },
      snare:   { osc: 'triangle', noiseHp: 1000, bodyFreq: 200, bodyDecay: 0.12, noiseDecay: 0.15, vol: 0.8, clicks: false },
      clap:    { bpFreq: 2000, bpQ: 3, vol: 0.8, decay: 0.08, clicks: false },
      hihat:   { hpFreq: 7000, vol: 0.5, decay: 0.06, clicks: false },
      cymbal:  { hpFreq: 5000, vol: 0.4, decay: 0.4, clicks: false },
      tomlo:   { osc: 'triangle', freq0: 96, freq1: 48,  decay: 0.35, vol: 0.8, clicks: false },
      tommid:  { osc: 'triangle', freq0: 168, freq1: 84,  decay: 0.35, vol: 0.8, clicks: false },
      tomhi:   { osc: 'triangle', freq0: 264, freq1: 132,  decay: 0.3,  vol: 0.75, clicks: false },
      rim:     { bpFreq: 4000, bpQ: 8, rimFreq: 800, rimDecay: 0.03, noiseDecay: 0.08, vol: 0.9, clicks: true },
      shaker:  { hpFreq: 8000, vol: 0.25, decay: 0.2, steps: 8, clicks: false },
    }
  },
  eight08: {
    name: '808',
    sounds: {
      kick:    { osc: 'sine',  freq0: 56,  freq1: 28,  decay: 0.55, vol: 1.0, clicks: true },
      snare:   { osc: 'triangle', noiseHp: 1500, bodyFreq: 250, bodyDecay: 0.08, noiseDecay: 0.18, vol: 0.9, clicks: false },
      clap:    { bpFreq: 1800, bpQ: 4, vol: 0.9, decay: 0.1, clicks: true },
      hihat:   { hpFreq: 9000, vol: 0.4, decay: 0.04, clicks: false },
      cymbal:  { hpFreq: 6000, vol: 0.35, decay: 0.5, clicks: false },
      tomlo:   { osc: 'sine',  freq0: 75,  freq1: 38,  decay: 0.4,  vol: 0.85, clicks: true },
      tommid:  { osc: 'sine',  freq0: 130, freq1: 65,  decay: 0.35, vol: 0.85, clicks: true },
      tomhi:   { osc: 'sine',  freq0: 200, freq1: 110,  decay: 0.3,  vol: 0.8, clicks: true },
      rim:     { bpFreq: 3500, bpQ: 10, rimFreq: 1000, rimDecay: 0.02, noiseDecay: 0.06, vol: 0.95, clicks: true },
      shaker:  { hpFreq: 9000, vol: 0.2, decay: 0.15, steps: 10, clicks: false },
    }
  },
  electronic: {
    name: 'Electronic',
    sounds: {
      kick:    { osc: 'sawtooth', freq0: 120, freq1: 30,  decay: 0.3,  vol: 0.9, clicks: true },
      snare:   { osc: 'square', noiseHp: 2000, bodyFreq: 300, bodyDecay: 0.1, noiseDecay: 0.12, vol: 0.85, clicks: true },
      clap:    { bpFreq: 2500, bpQ: 6, vol: 0.85, decay: 0.06, clicks: true },
      hihat:   { hpFreq: 10000, vol: 0.4, decay: 0.03, clicks: true },
      cymbal:  { hpFreq: 7000, vol: 0.35, decay: 0.35, clicks: false },
      tomlo:   { osc: 'square', freq0: 90,  freq1: 40,  decay: 0.3,  vol: 0.8, clicks: true },
      tommid:  { osc: 'square', freq0: 160, freq1: 80,  decay: 0.28, vol: 0.75, clicks: true },
      tomhi:   { osc: 'square', freq0: 250, freq1: 120,  decay: 0.25, vol: 0.7, clicks: true },
      rim:     { bpFreq: 5000, bpQ: 12, rimFreq: 1200, rimDecay: 0.02, noiseDecay: 0.05, vol: 0.9, clicks: true },
      shaker:  { hpFreq: 10000, vol: 0.2, decay: 0.12, steps: 12, clicks: true },
    }
  },
  acoustic: {
    name: 'Acoustic',
    sounds: {
      kick:    { osc: 'sine',  freq0: 130, freq1: 35,  decay: 0.5,  vol: 1.0, clicks: false },
      snare:   { osc: 'triangle', noiseHp: 800, bodyFreq: 180, bodyDecay: 0.15, noiseDecay: 0.2, vol: 0.85, clicks: false },
      clap:    { bpFreq: 1500, bpQ: 2, vol: 0.75, decay: 0.1, clicks: false },
      hihat:   { hpFreq: 6000, vol: 0.35, decay: 0.08, clicks: false },
      cymbal:  { hpFreq: 4000, vol: 0.3, decay: 0.5, clicks: false },
      tomlo:   { osc: 'triangle', freq0: 100, freq1: 50,  decay: 0.4,  vol: 0.85, clicks: false },
      tommid:  { osc: 'triangle', freq0: 155, freq1: 77,  decay: 0.35, vol: 0.85, clicks: false },
      tomhi:   { osc: 'triangle', freq0: 230, freq1: 115,  decay: 0.3,  vol: 0.8, clicks: false },
      rim:     { bpFreq: 3000, bpQ: 6, rimFreq: 700, rimDecay: 0.04, noiseDecay: 0.1, vol: 0.9, clicks: true },
      shaker:  { hpFreq: 7000, vol: 0.2, decay: 0.25, steps: 7, clicks: false },
    }
  },
};

export const SOUNDS = [
  { id: 'kick',    icon: '💥', label: 'KICK' },
  { id: 'snare',   icon: '🥁', label: 'SNARE' },
  { id: 'clap',    icon: '👏', label: 'CLAP' },
  { id: 'hihat',   icon: '🔔', label: 'HI-HAT' },
  { id: 'cymbal',  icon: '✨', label: 'CYMBAL' },
  { id: 'tomlo',   icon: '🪘', label: 'TOM LO' },
  { id: 'tommid',  icon: '🪘', label: 'TOM MID' },
  { id: 'tomhi',   icon: '🪘', label: 'TOM HI' },
  { id: 'rim',     icon: '🥢', label: 'RIM' },
  { id: 'shaker',  icon: '🪇', label: 'SHAKER' },
];

export const GM_DRUM_NOTES = {
  kick: 36,
  snare: 38,
  clap: 39,
  hihat: 42,
  cymbal: 49,
  tomlo: 45,
  tommid: 47,
  tomhi: 50,
  rim: 37,
  shaker: 82,
};
