/**
 * exportSection — SettingsPanel Export tab (MIDI/WAV export, render + binding).
 *
 * Methods split out of SettingsPanel for size and composed back via
 * Object.assign. Bodies unchanged.
 */

import { downloadBlob, projectToMidiBlob, safeFilename, snippetToMidiBlob } from '../../export/MidiExporter.js';
import { projectToWavBlob, snippetToWavBlob } from '../../export/WavExporter.js';
import { showToast } from '../Toast.js';
import { escapeAttr, escapeHtml } from '../../utils/html.js';

export const ExportSectionMixin = {
  _renderSheetSection() {
    const snippets = (this.project?.snippets || []).filter(s => s.type !== 'audio');
    const allSnippets = this.project?.snippets || [];
    const options = snippets.length
      ? snippets.map(s => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name || `${(s.notes?.length || 0) + (s.hits?.length || 0)} events`)}</option>`).join('')
      : '<option value="">No MIDI snippets yet</option>';
    const wavOptions = allSnippets.length
      ? allSnippets.map(s => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name || (s.type === 'audio' ? 'Audio in recording' : `${(s.notes?.length || 0) + (s.hits?.length || 0)} events`))}</option>`).join('')
      : '<option value="">No snippets yet</option>';

    return `
      <div class="settings-section" id="section-sheet">
        <div class="settings-group">
          <h3 class="settings-group__title">MIDI Export</h3>
          <p class="settings-desc">Export the whole Canvas arrangement or an individual MIDI/drum snippet as a standard .mid file.</p>
          <div class="settings-row">
            <label class="settings-label">Canvas</label>
            <button class="btn btn--ghost" id="export-canvas-midi" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Export MIDI</button>
          </div>
          <div class="settings-row">
            <label class="settings-label">Snippet</label>
            <select class="settings-select" id="export-snippet-select" aria-label="MIDI snippet to export">
              ${options}
            </select>
          </div>
          <div class="settings-row">
            <label class="settings-label"></label>
            <button class="btn btn--ghost" id="export-snippet-midi" style="font-size:0.75rem;min-height:30px;padding:2px 10px;" ${snippets.length ? '' : 'disabled'}>Export Snippet MIDI</button>
          </div>
        </div>
        <div class="settings-group">
          <h3 class="settings-group__title">Audio Export</h3>
          <p class="settings-desc">Export browser-rendered WAV files for a snippet or the whole Canvas. Tone settings are rendered into WAV. MP3 will need an optional encoder dependency later.</p>
          <div class="settings-row">
            <label class="settings-label">Canvas</label>
            <select class="settings-select" id="export-canvas-wav-channels" aria-label="Canvas WAV channel mode">
              <option value="stereo" selected>Stereo (pan)</option>
              <option value="mono">Mono</option>
            </select>
          </div>
          <div class="settings-row">
            <label class="settings-label"></label>
            <button class="btn btn--ghost" id="export-canvas-wav" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Export WAV</button>
          </div>
          <div class="settings-row">
            <label class="settings-label">Snippet</label>
            <select class="settings-select" id="export-snippet-wav-select" aria-label="WAV snippet to export">
              ${wavOptions}
            </select>
          </div>
          <div class="settings-row">
            <label class="settings-label">Channels</label>
            <select class="settings-select" id="export-snippet-wav-channels" aria-label="Snippet WAV channel mode">
              <option value="auto" selected>Auto</option>
              <option value="mono">Mono</option>
              <option value="stereo">Stereo</option>
            </select>
          </div>
          <div class="settings-row">
            <label class="settings-label"></label>
            <button class="btn btn--ghost" id="export-snippet-wav" style="font-size:0.75rem;min-height:30px;padding:2px 10px;" ${allSnippets.length ? '' : 'disabled'}>Export Snippet WAV</button>
          </div>
        </div>
        <div class="settings-group">
          <h3 class="settings-group__title">Sheet Music</h3>
          <div id="section-sheet-music"></div>
        </div>
      </div>`;
  },

  _bindExportEvents() {
    const body = this.el.querySelector('#settings-body');
    body.querySelector('#export-canvas-midi')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!this.project) return;
      const stats = { renderedEvents: 0, skippedMismatchedClips: 0 };
      const blob = projectToMidiBlob(this.project, { stats });
      if (!stats.renderedEvents) {
        showToast('No MIDI or drum Canvas clips to export');
        return;
      }
      downloadBlob(blob, safeFilename(`${this.project.name || 'notenotes'}-canvas`, 'mid'));
      showToast(stats.skippedMismatchedClips ? 'Canvas MIDI exported, skipped mismatched clips' : 'Canvas MIDI exported');
    });

    body.querySelector('#export-canvas-wav')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!this.project) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      showToast('Rendering Canvas WAV...');
      try {
        const stats = { skippedAudio: 0, skippedMismatchedClips: 0, renderedClips: 0 };
        const channelMode = body.querySelector('#export-canvas-wav-channels')?.value || 'stereo';
        const blob = await projectToWavBlob(this.project, { store: this.store, stats, channelMode });
        if (!stats.renderedClips) {
          showToast('No audible Canvas clips to export');
          return;
        }
        downloadBlob(blob, safeFilename(`${this.project.name || 'notenotes'}-canvas`, 'wav'));
        const skipped = [];
        if (stats.skippedAudio) skipped.push(`${stats.skippedAudio} unavailable audio clip${stats.skippedAudio === 1 ? '' : 's'}`);
        if (stats.skippedMismatchedClips) skipped.push(`${stats.skippedMismatchedClips} mismatched clip${stats.skippedMismatchedClips === 1 ? '' : 's'}`);
        showToast(skipped.length ? `Canvas WAV exported, skipped ${skipped.join(' and ')}` : 'Canvas WAV exported');
      } catch (err) {
        console.error('[Settings] Canvas WAV export failed:', err);
        showToast('Canvas WAV export failed');
      } finally {
        btn.disabled = false;
      }
    });

    body.querySelector('#export-snippet-midi')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const snippetId = body.querySelector('#export-snippet-select')?.value;
      const snippet = this.project?.snippets?.find(s => s.id === snippetId);
      if (!snippet) return;
      const stats = { renderedEvents: 0 };
      const blob = snippetToMidiBlob(snippet, this.project, { stats });
      if (!stats.renderedEvents) {
        showToast('Selected snippet has no MIDI events');
        return;
      }
      downloadBlob(blob, safeFilename(snippet.name || 'snippet', 'mid'));
      showToast('Snippet MIDI exported');
    });

    body.querySelector('#export-snippet-wav')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      const snippetId = body.querySelector('#export-snippet-wav-select')?.value;
      const snippet = this.project?.snippets?.find(s => s.id === snippetId);
      if (!snippet) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      showToast('Rendering snippet WAV...');
      try {
        const stats = { skippedAudio: 0 };
        const channelMode = body.querySelector('#export-snippet-wav-channels')?.value || 'auto';
        const blob = await snippetToWavBlob(snippet, this.project, { store: this.store, stats, channelMode });
        downloadBlob(blob, safeFilename(snippet.name || 'snippet', 'wav'));
        showToast(stats.skippedAudio ? 'Snippet WAV exported without unavailable audio' : 'Snippet WAV exported');
      } catch (err) {
        console.error('[Settings] Snippet WAV export failed:', err);
        showToast(err?.message || 'Snippet WAV export failed');
      } finally {
        btn.disabled = false;
      }
    });
  },
};
