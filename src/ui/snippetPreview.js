/**
 * snippetPreview — Shared mini-preview SVG for snippet tiles.
 *
 * Originally lived as `SnippetTray._renderMiniPreview()`. Extracted so the
 * Inspect file-explorer browser can reuse the exact same visual without
 * divergence. Output is byte-identical to the previous inline implementation.
 */

/**
 * Render a tiny SVG preview of a snippet.
 *
 * @param {object} snippet - MIDI / drum / audio snippet.
 * @param {object} [options]
 * @param {number} [options.width=80]
 * @param {number} [options.height=28]
 * @returns {string} Inline SVG markup.
 */
export function renderSnippetPreviewSVG(snippet, { width = 80, height = 28 } = {}) {
  if (snippet.type === 'audio') {
    const peaks = Array.isArray(snippet.audioPeaks) ? snippet.audioPeaks : [];
    let bars = '';
    if (peaks.length) {
      peaks.forEach((peak, i) => {
        const x = 4 + i * ((width - 8) / peaks.length);
        const h = Math.max(1, Math.min(1, peak || 0) * (height - 8));
        const y = height / 2 - h / 2;
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="1.5" height="${h.toFixed(1)}" rx="0.75" fill="var(--accent-light)" opacity="0.75"/>`;
      });
    } else {
      bars = `<line x1="8" y1="${height / 2}" x2="${width - 8}" y2="${height / 2}" stroke="var(--accent-light)" opacity="0.7"/><text x="${width/2}" y="${height/2 + 4}" text-anchor="middle" fill="var(--accent-light)" font-size="8">LINE</text>`;
    }
    return `<svg width="${width}" height="${height}" style="display:block">
      <rect width="${width}" height="${height}" fill="var(--surface-3)" rx="3"/>
      ${bars}
    </svg>`;
  }

  const notes = snippet.notes || [];
  const hits = snippet.hits || [];

  if (notes.length === 0 && hits.length === 0) {
    return `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="var(--surface-3)" rx="3"/></svg>`;
  }

  let svgContent = '';
  const duration = snippet.durationTicks || 1;

  if (notes.length > 0) {
    // Find pitch range
    const pitches = notes.map(n => n.pitch);
    const minPitch = Math.min(...pitches);
    const maxPitch = Math.max(...pitches);
    const pitchRange = Math.max(1, maxPitch - minPitch);

    notes.forEach(n => {
      const x = (n.startTick / duration) * width;
      const w = Math.max(2, (n.durationTick / duration) * width);
      const y = height - ((n.pitch - minPitch) / pitchRange) * (height - 4) - 2;
      svgContent += `<rect x="${x}" y="${y}" width="${w}" height="3" rx="1" fill="var(--accent)" opacity="0.8"/>`;
    });
  }

  if (hits.length > 0) {
    hits.forEach(h => {
      const x = (h.startTick / duration) * width;
      const y = h.type === 'kick' ? height - 6 : h.type === 'snare' || h.type === 'clap' ? height / 2 : 4;
      svgContent += `<circle cx="${x}" cy="${y}" r="2" fill="var(--accent-light)" opacity="0.7"/>`;
    });
  }

  return `<svg width="${width}" height="${height}" style="display:block">
    <rect width="${width}" height="${height}" fill="var(--surface-3)" rx="3"/>
    ${svgContent}
  </svg>`;
}
