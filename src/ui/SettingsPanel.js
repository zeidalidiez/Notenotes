/**
 * SettingsPanel — Slide-out panel for app-wide settings.
 * Includes quantization, metronome settings, project management,
 * version history, and sheet music export.
 */

import { QuantizeGrid } from '../engine/Quantizer.js';
import { SheetMusicView } from '../export/SheetMusicView.js';
import { showToast } from './Toast.js';

export class SettingsPanel {
  /**
   * @param {object} deps - { transport, metronome, quantizer, store, project }
   */
  constructor(deps) {
    this.transport = deps.transport;
    this.metronome = deps.metronome;
    this.quantizer = deps.quantizer;
    this.store = deps.store;
    this.project = deps.project;
    this.el = null;
    this._isOpen = false;
    this._sheetMusicView = null;
    this._activeSection = 'settings'; // 'settings' | 'sheet' | 'history'
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'settings-panel';
    this.el.id = 'settings-panel';

    this.el.innerHTML = `
      <div class="settings-panel__overlay" id="settings-overlay"></div>
      <div class="settings-panel__drawer" id="settings-drawer">
        <div class="settings-panel__header">
          <h2 class="settings-panel__title">Settings</h2>
          <button class="btn btn--icon btn--ghost settings-panel__close" id="settings-close" aria-label="Close settings">✕</button>
        </div>
        <div class="settings-panel__tabs">
          <button class="settings-panel__tab is-active" data-section="settings">⚙️ Settings</button>
          <button class="settings-panel__tab" data-section="sheet">🎼 Sheet Music</button>
          <button class="settings-panel__tab" data-section="history">📋 History</button>
        </div>
        <div class="settings-panel__body" id="settings-body">
          ${this._renderSettingsSection()}
        </div>
      </div>
    `;

    this._bindEvents();
    return this.el;
  }

  _renderSettingsSection() {
    const q = this.project?.settings?.quantize || 0;
    const metVol = this.project?.settings?.metronomeVolume ?? 0.5;
    const masterVol = this.project?.settings?.masterVolume ?? 0.8;

    return `
      <div class="settings-section" id="section-settings">
        <div class="settings-group">
          <h3 class="settings-group__title">Project</h3>
          <div class="settings-row">
            <label class="settings-label">Name</label>
            <input class="settings-input" id="setting-project-name" type="text" value="${this.project?.name || 'Untitled'}" aria-label="Project name"/>
          </div>
          <div class="settings-row">
            <label class="settings-label">BPM</label>
            <input class="settings-input settings-input--sm" id="setting-bpm" type="number" min="40" max="240" value="${this.transport?.bpm || 120}" aria-label="BPM"/>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Quantization</h3>
          <div class="settings-row">
            <label class="settings-label">Grid</label>
            <select class="settings-select" id="setting-quantize" aria-label="Quantize grid">
              <option value="0" ${q === 0 ? 'selected' : ''}>Free (OFF)</option>
              <option value="1" ${q === 1 ? 'selected' : ''}>1/4 Note</option>
              <option value="2" ${q === 2 ? 'selected' : ''}>1/8 Note</option>
              <option value="3" ${q === 3 ? 'selected' : ''}>1/16 Note</option>
              <option value="4" ${q === 4 ? 'selected' : ''}>1/4 Triplet</option>
              <option value="5" ${q === 5 ? 'selected' : ''}>1/8 Triplet</option>
              <option value="6" ${q === 6 ? 'selected' : ''}>1/32 Note</option>
            </select>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Metronome</h3>
          <div class="settings-row">
            <label class="settings-label">Volume</label>
            <input class="settings-range" id="setting-met-vol" type="range" min="0" max="100" value="${Math.round(metVol * 100)}" aria-label="Metronome volume"/>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Master</h3>
          <div class="settings-row">
            <label class="settings-label">Volume</label>
            <input class="settings-range" id="setting-master-vol" type="range" min="0" max="100" value="${Math.round(masterVol * 100)}" aria-label="Master volume"/>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Scale Board</h3>
          <div class="settings-row">
            <label class="settings-label">Number of Pads (<span id="setting-pads-display">${this.project?.settings?.scalePadsCount || 7}</span>)</label>
            <input class="settings-range" id="setting-pads-count" type="range" min="1" max="16" value="${this.project?.settings?.scalePadsCount || 7}" aria-label="Scale board pads count"/>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Time Signature Visualizer</h3>
          <div class="settings-row" style="justify-content: flex-start; gap: 10px;">
            <input type="checkbox" id="setting-vis-enabled" ${this.project?.settings?.visualizerEnabled ? 'checked' : ''} />
            <label class="settings-label" for="setting-vis-enabled">Enable background visualizer</label>
          </div>
          <div class="settings-row">
            <label class="settings-label">Beat Colors</label>
            <div style="display: flex; gap: 4px;">
              ${(this.project?.settings?.beatColors || ['#1e1e2e', '#2a2a3e', '#1e1e2e', '#2a2a3e']).map((c, i) => 
                `<input type="color" class="setting-vis-color" data-index="${i}" value="${c}" aria-label="Beat ${i+1} color" style="width: 24px; height: 24px; padding: 0; border: none; border-radius: 4px;" />`
              ).join('')}
            </div>
          </div>
        </div>
        <div class="settings-row" style="margin-top: var(--space-xl); justify-content: center;">
          <button class="btn btn--primary" id="setting-save-btn" style="width: 100%;">Save & Close</button>
        </div>
      </div>
    `;
  }

  _renderSheetSection() {
    return `<div class="settings-section" id="section-sheet"></div>`;
  }

  _renderHistorySection() {
    return `
      <div class="settings-section" id="section-history">
        <div class="settings-group">
          <h3 class="settings-group__title">Version History</h3>
          <p class="settings-desc">Restore to a previous save (up to 5 versions kept).</p>
          <div id="version-list" class="version-list">
            <div class="version-list__loading">Loading versions...</div>
          </div>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    // Overlay close
    this.el.querySelector('#settings-overlay')?.addEventListener('pointerdown', () => this.close());
    this.el.querySelector('#settings-close')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.close();
    });

    // Section tabs
    this.el.querySelectorAll('.settings-panel__tab').forEach(tab => {
      tab.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._switchSection(tab.dataset.section);
      });
    });
  }

  _bindSettingsEvents() {
    const body = this.el.querySelector('#settings-body');

    // Project name
    body.querySelector('#setting-project-name')?.addEventListener('change', (e) => {
      if (this.project) {
        this.project.name = e.target.value;
        this.store?.scheduleAutoSave(this.project);
        showToast('Project name updated');
      }
    });

    // BPM
    body.querySelector('#setting-bpm')?.addEventListener('change', (e) => {
      const bpm = parseInt(e.target.value, 10);
      if (bpm >= 40 && bpm <= 240) {
        this.transport.bpm = bpm;
        if (this.project) {
          this.project.bpm = bpm;
          this.store?.scheduleAutoSave(this.project);
        }
        showToast(`BPM: ${bpm}`);
      }
    });

    // Quantize
    body.querySelector('#setting-quantize')?.addEventListener('change', (e) => {
      const grid = parseInt(e.target.value, 10);
      this.quantizer?.setGrid(grid);
      if (this.project) {
        this.project.settings.quantize = grid;
        this.store?.scheduleAutoSave(this.project);
      }
    });

    // Metronome volume
    body.querySelector('#setting-met-vol')?.addEventListener('input', (e) => {
      const vol = parseInt(e.target.value, 10) / 100;
      if (this.metronome) this.metronome.volume = vol;
      if (this.project) this.project.settings.metronomeVolume = vol;
    });

      // Master volume
      body.querySelector('#setting-master-vol')?.addEventListener('input', (e) => {
        const vol = parseInt(e.target.value, 10) / 100;
        const engine = this.transport?.engine;
        if (engine?.masterGain) {
          engine.masterGain.gain.setTargetAtTime(vol, engine.currentTime, 0.01);
        }
        if (this.project) this.project.settings.masterVolume = vol;
      });

      // Scale pads count
      body.querySelector('#setting-pads-count')?.addEventListener('input', (e) => {
        let count = parseInt(e.target.value, 10);
        if (isNaN(count) || count < 1) count = 7;
        if (count > 16) count = 16;
        
        const display = body.querySelector('#setting-pads-display');
        if (display) display.textContent = count;

        if (this.project) {
          this.project.settings.scalePadsCount = count;
          this.store?.scheduleAutoSave(this.project);
          // Trigger event for ScaleBoard to update
          window.dispatchEvent(new CustomEvent('settings-pads-changed', { detail: { count } }));
        }
      });

      // Visualizer toggle
      body.querySelector('#setting-vis-enabled')?.addEventListener('change', (e) => {
        if (this.project) {
          this.project.settings.visualizerEnabled = e.target.checked;
          this.store?.scheduleAutoSave(this.project);
          if (!e.target.checked) document.documentElement.style.removeProperty('--surface-0');
        }
      });

      // Visualizer colors
      body.querySelectorAll('.setting-vis-color').forEach(input => {
        input.addEventListener('input', (e) => {
          if (this.project) {
            const idx = parseInt(e.target.dataset.index, 10);
            if (!this.project.settings.beatColors) {
              this.project.settings.beatColors = ['#1e1e2e', '#2a2a3e', '#1e1e2e', '#2a2a3e'];
            }
            this.project.settings.beatColors[idx] = e.target.value;
            this.store?.scheduleAutoSave(this.project);
          }
        });
      });

      // Save & Close button
      body.querySelector('#setting-save-btn')?.addEventListener('click', () => {
        this.close();
      });
    }

  _switchSection(section) {
    this._activeSection = section;

    // Update tab visuals
    this.el.querySelectorAll('.settings-panel__tab').forEach(t => {
      t.classList.toggle('is-active', t.dataset.section === section);
    });

    const body = this.el.querySelector('#settings-body');

    switch (section) {
      case 'settings':
        body.innerHTML = this._renderSettingsSection();
        this._bindSettingsEvents();
        break;

      case 'sheet':
        body.innerHTML = this._renderSheetSection();
        this._sheetMusicView = new SheetMusicView(this.project);
        body.querySelector('#section-sheet')?.appendChild(this._sheetMusicView.render());
        break;

      case 'history':
        body.innerHTML = this._renderHistorySection();
        this._loadVersionHistory();
        break;
    }
  }

  async _loadVersionHistory() {
    if (!this.project || !this.store) return;
    const listEl = this.el.querySelector('#version-list');
    if (!listEl) return;

    try {
      const versions = await this.store.getVersions(this.project.id);
      if (versions.length === 0) {
        listEl.innerHTML = '<div class="version-list__empty">No saved versions yet</div>';
        return;
      }

      listEl.innerHTML = versions.map(v => {
        const date = new Date(v.timestamp);
        const timeStr = date.toLocaleString();
        return `
          <div class="version-list__item" data-version-id="${v.versionId}">
            <div class="version-list__info">
              <span class="version-list__time">${timeStr}</span>
              <span class="version-list__meta">${v.bpm} BPM</span>
            </div>
            <button class="btn btn--ghost version-list__restore" data-version-id="${v.versionId}">Restore</button>
          </div>
        `;
      }).join('');

      // Bind restore buttons
      listEl.querySelectorAll('.version-list__restore').forEach(btn => {
        btn.addEventListener('pointerdown', async (e) => {
          e.preventDefault();
          const vid = parseInt(btn.dataset.versionId, 10);
          if (confirm('Restore this version? Current changes will be saved first.')) {
            await this.store.save(this.project);
            const restored = await this.store.restoreVersion(vid);
            showToast('Version restored! Reload to apply.');
            // Force reload to apply
            setTimeout(() => window.location.reload(), 500);
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = '<div class="version-list__empty">Error loading versions</div>';
      console.error('[Settings] Version history error:', err);
    }
  }

  open() {
    this._isOpen = true;
    this.el.classList.add('is-open');
    this._switchSection(this._activeSection);
  }

  close() {
    this._isOpen = false;
    this.el.classList.remove('is-open');
  }

  toggle() {
    if (this._isOpen) this.close();
    else this.open();
  }
}
