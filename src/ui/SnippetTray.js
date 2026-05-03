/**
 * SnippetTray — Horizontal scrollable list of captured snippets.
 * Shows mini previews, play/delete buttons.
 */

import { AudioEngine } from '../engine/AudioEngine.js';

export class SnippetTray {
  constructor() {
    this.el = null;
    /** @type {Array} */
    this.snippets = [];
    this._onSnippetSelected = null;
  }

  /**
   * Set callback for snippet selection (for future Canvas drag-drop).
   */
  onSnippetSelected(fn) { this._onSnippetSelected = fn; }

  /**
   * Set callback for when a snippet is deleted from the tray.
   */
  onSnippetDeleted(fn) { this._onSnippetDeleted = fn; }

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
      const typeIcon = s.type === 'drum' ? '🥁' : s.type === 'audio' ? '🎤' : '🎵';
      const bars = Math.ceil(s.durationTicks / (480 * (s.timeSignature?.beats || 4)));
      const autoMeta = s.type === 'audio' ? 'Audio' : `${noteCount} notes · ${bars} bar${bars > 1 ? 's' : ''}`;
      const displayName = s.name || autoMeta;

      return `
        <div class="snippet-tray__item" data-id="${s.id}">
          <div class="snippet-tray__item-preview">
            ${this._renderMiniPreview(s)}
          </div>
          <div class="snippet-tray__item-info">
            <span class="snippet-tray__item-icon">${typeIcon}</span>
            <span class="snippet-tray__item-meta">${displayName}</span>
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

    // Bind item selection
    list.querySelectorAll('.snippet-tray__item').forEach(item => {
      item.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.snippet-tray__action-btn')) return;
        const id = item.dataset.id;
        const snippet = this.snippets.find(s => s.id === id);
        if (snippet && this._onSnippetSelected) {
          this._onSnippetSelected(snippet);
        }
        // Visual selection
        list.querySelectorAll('.snippet-tray__item').forEach(i => i.classList.remove('is-selected'));
        item.classList.add('is-selected');
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
      return `<svg width="${width}" height="${height}" style="display:block">
        <rect width="${width}" height="${height}" fill="var(--surface-3)" rx="3"/>
        <text x="${width/2}" y="${height/2 + 5}" text-anchor="middle" fill="var(--accent-light)" font-size="14">🎤</text>
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
}
