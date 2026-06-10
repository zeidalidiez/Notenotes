/**
 * PitchDetect - monophonic pitch detection and audio-to-MIDI transcription.
 *
 * The math is pure: it operates on a Float32 sample buffer (mono PCM) and a
 * sample rate, with no Web Audio or DOM. That makes the whole transcription
 * path deterministic and testable with synthesized tones.
 *
 * `detectPitchHz` uses normalized autocorrelation (an ACF2+-style refinement):
 * it finds the lag of the strongest periodic correlation, gated by a clarity
 * threshold and a minimum signal level so silence and noise read as unvoiced.
 * `transcribeSamplesToNotes` frames the signal, smooths the per-frame pitch to
 * kill octave/edge jitter, segments contiguous same-pitch runs into notes, and
 * converts frame timing into ticks against the project tempo.
 *
 * This is a hint-quality transcriber for single-line humming/whistling, not a
 * polyphonic analyzer - the result is an editable MIDI snippet, not a transcript
 * anyone has to trust note-for-note.
 */

export const A4_HZ = 440;
export const A4_MIDI = 69;
export const DEFAULT_MIN_HZ = 65;    // ~C2
export const DEFAULT_MAX_HZ = 1200;  // ~D6
export const PPQ = 480;

export function hzToMidi(hz) {
  if (!(hz > 0)) return null;
  return A4_MIDI + 12 * Math.log2(hz / A4_HZ);
}

export function midiToHz(midi) {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

function rms(samples, start = 0, end = samples.length) {
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, end - start));
}

/**
 * Estimate the fundamental frequency (Hz) of a mono frame, or null when the
 * frame is too quiet or too noisy to be a clear pitch.
 *
 * @returns {{ hz: number, clarity: number } | null}
 */
export function detectPitchHz(samples, sampleRate, options = {}) {
  const minHz = options.minHz ?? DEFAULT_MIN_HZ;
  const maxHz = options.maxHz ?? DEFAULT_MAX_HZ;
  const minClarity = options.minClarity ?? 0.9;
  const minRms = options.minRms ?? 0.01;

  const n = samples.length;
  if (n < 2 || !(sampleRate > 0)) return null;
  if (rms(samples) < minRms) return null;

  const maxLag = Math.min(n - 1, Math.floor(sampleRate / minHz));
  const minLag = Math.max(1, Math.floor(sampleRate / maxHz));
  if (maxLag <= minLag) return null;

  // Normalized autocorrelation across the candidate lag range. 1.0 == perfectly
  // periodic at that lag.
  const norms = new Array(maxLag + 1).fill(0);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let energy = 0;
    for (let i = 0; i < n - lag; i++) {
      corr += samples[i] * samples[i + lag];
      energy += samples[i] * samples[i] + samples[i + lag] * samples[i + lag];
    }
    norms[lag] = energy > 0 ? (2 * corr) / energy : 0;
  }

  // Autocorrelation is high near lag 0 and slides down to a trough around the
  // half-period before rising to a peak at the true period. Descend past that
  // initial shoulder first, otherwise minLag (a short lag / high frequency) is
  // mistaken for the peak and low notes are dropped.
  let lag = minLag;
  while (lag < maxLag && norms[lag] > norms[lag + 1]) lag++;

  // Then climb to the FIRST local maximum. That first peak is the fundamental
  // period; a plain global max would prefer the equally-strong 2x/3x-period
  // peaks of a sustained tone and report an octave too low. Stopping at maxLag
  // also keeps tones near minHz (~C2) from being lost at the boundary.
  while (lag < maxLag && norms[lag] <= norms[lag + 1]) lag++;

  const bestLag = lag;
  const bestCorr = norms[lag];
  if (bestLag < 1 || bestCorr < minClarity) return null;

  // Parabolic interpolation around the peak lag for sub-sample precision.
  const refined = parabolicPeakLag(samples, bestLag, n);
  const hz = sampleRate / refined;
  if (hz < minHz || hz > maxHz) return null;
  return { hz, clarity: bestCorr };
}

function lagCorrelation(samples, lag, n) {
  let corr = 0;
  for (let i = 0; i < n - lag; i++) corr += samples[i] * samples[i + lag];
  return corr;
}

function parabolicPeakLag(samples, lag, n) {
  if (lag <= 1 || lag >= n - 1) return lag;
  const c0 = lagCorrelation(samples, lag - 1, n);
  const c1 = lagCorrelation(samples, lag, n);
  const c2 = lagCorrelation(samples, lag + 1, n);
  const denom = c0 - 2 * c1 + c2;
  if (denom === 0) return lag;
  const shift = (0.5 * (c0 - c2)) / denom;
  if (shift < -1 || shift > 1) return lag;
  return lag + shift;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Transcribe mono PCM into MIDI note events.
 *
 * @param {Float32Array|number[]} samples
 * @param {number} sampleRate
 * @param {object} [opts]
 *   bpm, ppq, frameSize, hopSize, minClarity, minRms, minNoteFrames, smoothing
 * @returns {{ notes: Array<{pitch,startTick,durationTick,velocity}>, durationTicks: number }}
 */
export function transcribeSamplesToNotes(samples, sampleRate, opts = {}) {
  const bpm = clampNumber(opts.bpm, 40, 300, 120);
  const ppq = opts.ppq ?? PPQ;
  const frameSize = opts.frameSize ?? 2048;
  const hopSize = opts.hopSize ?? 1024;
  const minNoteFrames = opts.minNoteFrames ?? 3;
  const smoothing = opts.smoothing ?? 3; // median window (frames), odd

  const empty = { notes: [], durationTicks: ppq * 4 };
  if (!samples || samples.length < frameSize || !(sampleRate > 0)) return empty;

  const ticksPerSecond = (bpm / 60) * ppq;
  const secondsPerHop = hopSize / sampleRate;

  // 1) Per-frame pitch (MIDI, rounded) + level, or null when unvoiced.
  const frames = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const frame = samples.subarray
      ? samples.subarray(start, start + frameSize)
      : samples.slice(start, start + frameSize);
    const pitch = detectPitchHz(frame, sampleRate, opts);
    const midi = pitch ? hzToMidi(pitch.hz) : null;
    frames.push({
      midi: midi === null ? null : Math.round(midi),
      level: rms(frame),
    });
  }
  if (!frames.length) return empty;

  // 2) Median-smooth the MIDI track to remove single-frame jitter/octave slips.
  const smoothed = frames.map((f, i) => {
    if (f.midi === null) return null;
    const half = Math.floor(smoothing / 2);
    const window = [];
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < frames.length && frames[j].midi !== null) window.push(frames[j].midi);
    }
    return window.length ? Math.round(median(window)) : f.midi;
  });

  // 3) Segment contiguous same-pitch runs into notes.
  const notes = [];
  let runMidi = null;
  let runStart = 0;
  let runLevel = 0;
  let runLen = 0;
  const flush = (endFrame) => {
    if (runMidi !== null && runLen >= minNoteFrames) {
      const startTick = Math.round(runStart * secondsPerHop * ticksPerSecond);
      const endTick = Math.round(endFrame * secondsPerHop * ticksPerSecond);
      const durationTick = Math.max(1, endTick - startTick);
      const velocity = clampNumber(0.4 + runLevel / runLen * 3, 0.2, 1, 0.8);
      notes.push({ pitch: runMidi, startTick, durationTick, velocity: round2(velocity) });
    }
  };
  for (let i = 0; i < smoothed.length; i++) {
    const m = smoothed[i];
    if (m === runMidi) {
      runLen++;
      runLevel += frames[i].level;
    } else {
      flush(i);
      runMidi = m;
      runStart = i;
      runLen = 1;
      runLevel = frames[i].level;
    }
  }
  flush(smoothed.length);

  // `flush` only emits notes with a non-null pitch, so no filtering is needed.
  const lastEnd = notes.length ? notes[notes.length - 1].startTick + notes[notes.length - 1].durationTick : 0;
  const durationTicks = Math.max(ppq, Math.ceil((lastEnd || ppq) / ppq) * ppq);
  return { notes, durationTicks };
}

function clampNumber(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
