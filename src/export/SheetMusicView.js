/**
 * SheetMusicView — Renders sheet music from snippets using abcjs.
 * Supports export as SVG image and ABC text download.
 */

import abcjs from 'abcjs';
import 'abcjs/abcjs-audio.css';
import { snippetToABC, projectToABC } from './ABCConverter.js';
import { showToast } from '../ui/Toast.js';

export class SheetMusicView {
  constructor(project) {
    this.project = project;
    this.el = null;
    this._currentSnippetId = null;
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'sheet-music';
    this.el.id = 'sheet-music';

    this.el.innerHTML = `
      <div class="sheet-music__toolbar">
        <div class="sheet-music__toolbar-group">
          <span class="sheet-music__toolbar-label">Snippet</span>
          <select class="sheet-music__select" id="sm-snippet-select" aria-label="Select snippet">
            ${this._renderSnippetOptions()}
          </select>
        </div>
        <div class="sheet-music__toolbar-spacer"></div>
        <div class="sheet-music__toolbar-group">
          <button class="btn btn--ghost sheet-music__export-btn" id="sm-export-svg" aria-label="Export as SVG">
            Export SVG
          </button>
          <button class="btn btn--ghost sheet-music__export-btn" id="sm-export-abc" aria-label="Export as ABC">
            Export ABC
          </button>
        </div>
      </div>
      <div class="sheet-music__container" id="sm-container">
        <div class="sheet-music__render" id="sm-render"></div>
      </div>
      <div class="sheet-music__abc-preview">
        <pre class="sheet-music__abc-text" id="sm-abc-text"></pre>
      </div>
    `;

    this._bindEvents();

    if (!this._currentSnippetId) {
      const first = (this.project?.snippets || []).find(s => s.type !== 'audio');
      if (first) this._currentSnippetId = first.id;
    }
    this._renderSheet();

    return this.el;
  }

  _renderSnippetOptions() {
    const snippets = (this.project?.snippets || []).filter(s => s.type !== 'audio');
    if (snippets.length === 0) {
      return '<option value="">No snippets yet</option>';
    }
    return snippets.map((s) => {
      const count = (s.notes?.length || 0) + (s.hits?.length || 0);
      const icon = s.type === 'drum' ? '🥁 ' : '';
      return `<option value="${s.id}">${icon}${s.name || 'Snippet'} (${count} events)</option>`;
    }).join('');
  }

  _renderSheet() {
    const renderEl = this.el.querySelector('#sm-render');
    const abcTextEl = this.el.querySelector('#sm-abc-text');
    const snippets = (this.project?.snippets || []).filter(s => s.type !== 'audio');

    const snippet = snippets.find(s => s.id === this._currentSnippetId);
    if (!snippet) {
      renderEl.innerHTML = '<div class="sheet-music__empty">Record some MIDI notes in Creative Mode to see sheet music here</div>';
      abcTextEl.textContent = '';
      return;
    }

    const abc = snippetToABC(snippet, {
      title: `${this.project?.name || 'Sketch'} - ${snippet.name || 'Snippet'}`
    });

    // Render with abcjs
    try {
      abcjs.renderAbc(renderEl, abc, {
        responsive: 'resize',
        staffwidth: 700,
        paddingtop: 10,
        paddingbottom: 10,
        paddingleft: 10,
        paddingright: 10,
        foregroundColor: '#c8c8c8',
      });
    } catch (err) {
      console.warn('[SheetMusic] Render error:', err);
      renderEl.innerHTML = '<div class="sheet-music__empty">Could not render this snippet</div>';
    }

    // Show ABC text
    abcTextEl.textContent = abc;
  }

  _bindEvents() {
    // Snippet selector
    this.el.querySelector('#sm-snippet-select')?.addEventListener('change', (e) => {
      this._currentSnippetId = e.target.value;
      this._renderSheet();
    });

    // Export SVG
    this.el.querySelector('#sm-export-svg')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._exportSVG();
    });

    // Export ABC text
    this.el.querySelector('#sm-export-abc')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._exportABC();
    });
  }

  _exportSVG() {
    const renderEl = this.el.querySelector('#sm-render');
    const svg = renderEl.querySelector('svg');
    if (!svg) {
      showToast('No sheet music to export');
      return;
    }

    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    const snippet = (this.project?.snippets || []).find(s => s.id === this._currentSnippetId);
    a.download = `${snippet?.name || 'snippet'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('SVG exported!');
  }

  _exportABC() {
    const snippets = (this.project?.snippets || []).filter(s => s.type !== 'audio');
    if (snippets.length === 0) {
      showToast('No MIDI snippets to export');
      return;
    }

    const abc = projectToABC(this.project);
    const blob = new Blob([abc], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.project?.name || 'notenotes'}-sheet.abc`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('ABC file exported!');
  }

  /** Refresh when snippets change */
  refresh() {
    const select = this.el?.querySelector('#sm-snippet-select');
    if (select) {
      select.innerHTML = this._renderSnippetOptions();
    }
    this._renderSheet();
  }
}
