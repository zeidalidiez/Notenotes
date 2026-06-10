/**
 * SnippetTray — Horizontal scrollable list of captured snippets.
 * Shows mini previews, play/delete buttons.
 */

import { AudioEngine } from '../engine/AudioEngine.js';
import { ticksPerBarForMeter } from '../engine/Meter.js';
import { renderToneBadges, toneBadgeItemsForSnippet } from './ToneBadges.js';
import { icon } from './icons.js';
import { renderSnippetPreviewSVG } from './snippetPreview.js';

export class SnippetTray {
  constructor() {
    this.el = null;
    /** @type {Array} */
    this.snippets = [];
    this._onSnippetSelected = null;
    this._onSnippetShare = null;
    this._snippetUsageProvider = null;
    this._collapsed = typeof window !== 'undefined'
      ? window.matchMedia?.('(max-width: 700px)')?.matches ?? false
      : false;
  }

  /**
   * Set callback for snippet selection (for future Canvas drag-drop).
   */
  onSnippetSelected(fn) { this._onSnippetSelected = fn; }

  /**
   * Set callback for when a snippet is deleted from the tray.
   */
  onSnippetDeleted(fn) { this._onSnippetDeleted = fn; }

  /**
   * Set callback for when a snippet's "Share link" action is used. The host
   * builds the URL and copies it. Audio snippets are not offered a share button.
   */
  onSnippetShare(fn) { this._onSnippetShare = fn; }

  setSnippetUsageProvider(fn) {
    this._snippetUsageProvider = fn;
    if (this.el) this._renderSnippets();
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = `snippet-tray${this._collapsed ? ' is-collapsed' : ''}`;
    this.el.id = 'snippet-tray';

    this.el.innerHTML = `
      <button class="snippet-tray__header" id="snippet-tray-toggle" type="button" aria-expanded="${this._collapsed ? 'false' : 'true'}">
        <span class="snippet-tray__title">Snippets</span>
        <span class="snippet-tray__count" id="snippet-count">0</span>
      </button>
      <div class="snippet-tray__list" id="snippet-list">
        <div class="snippet-tray__empty" id="snippet-empty">
          Record a loop to capture snippets
        </div>
      </div>
    `;
    this.el.querySelector('#snippet-tray-toggle')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._toggleCollapsed();
    });
    this.el.querySelector('#snippet-tray-toggle')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this._toggleCollapsed();
    });

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
    const toggle = this.el.querySelector('#snippet-tray-toggle');
    count.textContent = this.snippets.length;
    if (toggle) toggle.setAttribute('aria-expanded', this._collapsed ? 'false' : 'true');

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
            ${renderSnippetPreviewSVG(s)}
          </div>
          <div class="snippet-tray__item-info">
            <span class="snippet-tray__item-icon snippet-tray__item-icon--${s.type || 'midi'}">${typeIcon}</span>
            <span class="snippet-tray__item-meta">${this._escapeHtml(displayName)}</span>
            ${aiBadge}
            ${badge}
            ${toneBadges}
          </div>
          <div class="snippet-tray__item-actions">
            ${s.type === 'audio' ? '' : `<button class="snippet-tray__action-btn snippet-tray__share-btn" data-share="${s.id}" aria-label="Copy share link" title="Copy a link that shares this snippet">${icon('share', { size: 14 })}</button>`}
            <button class="snippet-tray__action-btn snippet-tray__delete-btn" data-delete="${s.id}" aria-label="Delete snippet" title="Delete">${icon('x', { size: 14 })}</button>
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

    // Bind share buttons
    list.querySelectorAll('.snippet-tray__share-btn').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const snippet = this.snippets.find(s => s.id === btn.dataset.share);
        if (snippet && this._onSnippetShare) this._onSnippetShare(snippet);
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

  _toggleCollapsed() {
    this._collapsed = !this._collapsed;
    this.el?.classList.toggle('is-collapsed', this._collapsed);
    this.el?.querySelector('#snippet-tray-toggle')?.setAttribute('aria-expanded', this._collapsed ? 'false' : 'true');
  }

  /**
   * Render a tiny SVG preview of the snippet's notes.
   * @deprecated Use `renderSnippetPreviewSVG` from `./snippetPreview.js` directly.
   * Kept as a thin wrapper so older callers (if any) continue to work.
   */
  _renderMiniPreview(snippet) {
    return renderSnippetPreviewSVG(snippet);
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
