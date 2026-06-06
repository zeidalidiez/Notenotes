/**
 * audioPeaks — Shared waveform peak analysis for audio snippets.
 *
 * Computes normalized RMS peak bins from decoded audio, used to draw waveform
 * previews. Extracted from CreativeMode and CanvasMode, which had duplicate
 * copies of this logic.
 */

/** Normalized RMS peak bins (0..1, 2-dp) from a decoded AudioBuffer. */
export function peaksFromAudioBuffer(buffer, bins = 48) {
  const length = buffer?.length || 0;
  if (!length) return [];
  const channels = Math.max(1, buffer.numberOfChannels || 1);
  const blockSize = Math.max(1, Math.floor(length / bins));
  const peaks = [];
  for (let i = 0; i < bins; i++) {
    const start = i * blockSize;
    const end = i === bins - 1 ? length : Math.min(length, start + blockSize);
    let sum = 0;
    let count = 0;
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let j = start; j < end; j++) {
        const sample = data[j] || 0;
        sum += sample * sample;
        count++;
      }
    }
    peaks.push(count ? Math.sqrt(sum / count) : 0);
  }
  const max = Math.max(...peaks, 0.0001);
  return peaks.map(value => Math.round((value / max) * 100) / 100);
}

/** Decode an ArrayBuffer and compute its peak bins. Decode errors propagate to the caller. */
export async function peaksFromArrayBuffer(arrayBuffer, bins = 48) {
  if (!arrayBuffer) return [];
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return [];
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return peaksFromAudioBuffer(decoded, bins);
  } finally {
    await ctx.close?.();
  }
}

/** Decode a Blob and compute its peak bins. Returns [] (and warns) on failure. */
export async function peaksFromBlob(blob, bins = 48) {
  if (!blob?.size) return [];
  try {
    const arrayBuffer = await blob.arrayBuffer();
    return await peaksFromArrayBuffer(arrayBuffer, bins);
  } catch (err) {
    console.warn("[audioPeaks] Audio peak analysis failed:", err);
    return [];
  }
}
