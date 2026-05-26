/**
 * SnippetTray — Horizontal scrollable list of captured snippets.
 * Shows mini previews, play/delete buttons.
 */

import { AudioEngine } from '../engine/AudioEngine.js';
import { ticksPerBarForMeter } from '../engine/Meter.js';
import { renderToneBadges, toneBadgeItemsForSnippet } from './ToneBadges.js';

export class SnippetTray {
  constructor() {
    this.el = null;
    /** @type {Array} */
    this.snippets = [];
    this._onSnippetSelected = null;
    this._snippetUsageProvider = null;
  }

  /**
   * Set callback for snippet selection (for future Canvas drag-drop).
   */
  onSnippetSelected(fn) { this._onSnippetSelected = fn; }

  /**
   * Set callback for when a snippet is deleted from the tray.
   */
  onSnippetDeleted(fn) { this._onSnippetDeleted = fn; }

  setSnippetUsageProvider(fn) {
    this._snippetUsageProvider = fn;
    if (this.el) this._renderSnippets();
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'snippet-tray';
    this.el.id = 'snippet-tray';

    this.el.innerHTML = `
      <div class="snippet-tray__header">
        <span class="snippet-tray__title">Snippets</span>
        <span class="snippet-tray__count" id="snippet-count">0</span>
      </div>
      <div class="snippet-tray__list" id="snippet-list">
        <div class="snippet-tray__empty" id="snippet-empty">
          Record a loop to capture snippets
        </div>
      </div>
    `;

    return this.el;
  }

  /**
   * Add a snippet to the tray.
   * @param {object} snippet
   */
  addSnippet(snippet) {
    this.snippets.push(snippet);
    this._renderSnippets();
  }

  /**
   * Remove a snippet by ID.
   * @param {string} id
   */
  removeSnippet(id) {
    const usage = this._snippetUsageProvider?.(id);
    if (usage?.blocked) {
      usage.onBlocked?.(usage);
      return;
    }
    const snippet = this.snippets.find(s => s.id === id);
    const name = String(snippet?.name || 'this snippet').slice(0, 80);
    if (!window.confirm(`Delete "${name}"? This also removes it from Canvas.`)) return;

    this.snippets = this.snippets.filter(s => s.id !== id);
    this._renderSnippets();
    if (this._onSnippetDeleted) {
      this._onSnippetDeleted(id);
    }
  }

  _renderSnippets() {
    const list = this.el.querySelector('#snippet-list');
    const count = this.el.querySelector('#snippet-count');
    count.textContent = this.snippets.length;

    if (this.snippets.length === 0) {
      list.innerHTML = `<div class="snippet-tray__empty" id="snippet-empty">
        Record a loop to capture snippets
      </div>`;
      return;
    }

    list.innerHTML = this.snippets.map((s, i) => {
      const noteCount = (s.notes?.length || 0) + (s.hits?.length || 0);
      const typeIcon = s.type === 'drum' ? 'DRUM' : s.type === 'audio' ? 'LINE' : 'MIDI';
      const bars = Math.ceil(s.durationTicks / ticksPerBarForMeter(s.meter || s.timeSignature, 480));
      const autoMeta = s.type === 'audio' ? 'Audio' : `${noteCount} notes · ${bars} bar${bars > 1 ? 's' : ''}`;
      const displayName = s.name || autoMeta;
      const usage = this._snippetUsageProvider?.(s.id);
      const badge = usage?.label
        ? `<span class="snippet-tray__badge" title="${this._escapeAttr(usage.title || usage.label)}">${this._escapeHtml(usage.label)}</span>`
        : '';
      // AI-seeded snippets get a small badge so the user can see at a glance
      // which were generated. Hovering surfaces the original prompt.
      const aiBadge = s.aiSeeded
        ? `<span class="snippet-tray__badge snippet-tray__badge--ai" title="${this._escapeAttr(s.aiPrompt || 'AI-seeded snippet')}">AI</span>`
        : '';
      const toneBadges = renderToneBadges(toneBadgeItemsForSnippet(s), 'snippet-tray__tone-badges tone-badges');

      return `
        <div class="snippet-tray__item ${s.aiSeeded ? 'is-ai-seeded' : ''}" data-id="${s.id}" draggable="true">
          <div class="snippet-tray__item-preview">
            ${this._renderMiniPreview(s)}
          </div>
          <div class="snippet-tray__item-info">
            <span class="snippet-tray__item-icon snippet-tray__item-icon--${s.type || 'midi'}">${typeIcon}</span>
            <span class="snippet-tray__item-meta">${displayName}</span>
            ${aiBadge}
            ${badge}
            ${toneBadges}
          </div>
          <div class="snippet-tray__item-actions">
            <button class="snippet-tray__action-btn snippet-tray__delete-btn" data-delete="${s.id}" aria-label="Delete snippet" title="Delete">✕</button>
          </div>
        </div>
      `;
    }).join('');

    // Bind delete buttons
    list.querySelectorAll('.snippet-tray__delete-btn').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.removeSnippet(btn.dataset.delete);
      });
    });

    // Bind item selection (tap only — drag is native HTML5)
    list.querySelectorAll('.snippet-tray__item').forEach(item => {
      let startX = 0, startY = 0;

      item.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.snippet-tray__action-btn')) return;
        startX = e.clientX;
        startY = e.clientY;
      });

      item.addEventListener('pointerup', (e) => {
        if (e.target.closest('.snippet-tray__action-btn')) return;
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        if (dx < 5 && dy < 5) {
          const id = item.dataset.id;
          const snippet = this.snippets.find(s => s.id === id);
          if (snippet && this._onSnippetSelected) {
            this._onSnippetSelected(snippet);
          }
          list.querySelectorAll('.snippet-tray__item').forEach(i => i.classList.remove('is-selected'));
          item.classList.add('is-selected');
        }
      });

      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/snippet-id', item.dataset.id);
      });
    });
  }

  /**
   * Render a tiny SVG preview of the snippet's notes.
   */
  _renderMiniPreview(snippet) {
    const width = 80;
    const height = 28;

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

  _escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  _escapeAttr(value = '') {
    return this._escapeHtml(value).replace(/"/g, '&quot;');
  }
}
