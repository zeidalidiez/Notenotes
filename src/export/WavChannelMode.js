export const WAV_CHANNEL_MODES = ['auto', 'mono', 'stereo'];

export function normalizeWavChannelMode(mode, fallback = 'auto') {
  const value = String(mode || '').toLowerCase();
  if (WAV_CHANNEL_MODES.includes(value)) return value;
  return WAV_CHANNEL_MODES.includes(fallback) ? fallback : 'auto';
}
