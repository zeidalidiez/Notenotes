/**
 * scaleBoardVoice — ScaleBoard voice/syllable pad feature (state, rendering,
 * event binding, voice pad press/release).
 *
 * Split out of ScaleBoard for size and composed back via Object.assign.
 * Bodies unchanged.
 */

import { syllabify, extractPlayableSyllables, sanitizePhraseInput } from './voice/syllabify.js';

export const ScaleBoardVoiceMixin = {
  setVoiceEngine(voiceEngine) {
    this.voiceEngine = voiceEngine;
    if (this.el) this._refreshVoiceUi();
  },

  _loadVoiceStateFromProject() {
    const phrase = (this._project?.settings?.voicePhrase ?? '');
    this._voicePhrase = typeof phrase === 'string' ? phrase : '';
    this._recomputeVoiceTokens();
  },

  _persistVoicePhrase() {
    if (!this._project) return;
    if (!this._project.settings) this._project.settings = {};
    this._project.settings.voicePhrase = this._voicePhrase;
    if (this.onVoicePhraseChanged) this.onVoicePhraseChanged(this._voicePhrase);
  },

  _recomputeVoiceTokens() {
    if (!this.voiceEngine) {
      this._voiceTokens = [];
      this._playableSyllables = [];
      this._phrasePointer = 0;
      return;
    }
    const ids = this.voiceEngine.getAvailableSyllableIds();
    const bank = new Set(ids);
    this._voiceTokens = syllabify(this._voicePhrase, bank);
    this._playableSyllables = extractPlayableSyllables(this._voiceTokens);
    if (this._phrasePointer >= this._playableSyllables.length) {
      this._phrasePointer = 0;
    }
  },

  _renderVoiceRow() {
    if (this.padMode !== 'voices' || !this.voiceEngine) return '';
    const pointerHint = this._playableSyllables.length === 0
      ? 'Experimental robot voice. Type supported sounds below. Empty phrase = pads sing "ah".'
      : `Experimental robot voice: pads advance through ${this._playableSyllables.length} token${this._playableSyllables.length === 1 ? '' : 's'}.`;
    const tokensHtml = this._renderVoiceTokens();
    return `
      <div class="scaleboard__voice-row" id="sb-voice-row">
        <div class="scaleboard__voice-input-wrap">
          <label class="scaleboard__label" for="sb-voice-phrase">Phrase</label>
          <input
            class="scaleboard__voice-input"
            id="sb-voice-phrase"
            type="text"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            placeholder="supported sounds: ah eh ee oh oo ai oi au ei h n m l s t la lee lo ma mee mo na no ha sa ta"
            value="${this._escapeAttr(this._voicePhrase || '')}"
            aria-label="Voice phrase"
          />
          <button class="btn btn--sm btn--ghost scaleboard__voice-rewind" id="sb-voice-rewind" aria-label="Rewind phrase to start" title="Rewind to start">↻</button>
        </div>
        <div class="scaleboard__voice-tokens" id="sb-voice-tokens" aria-live="polite">${tokensHtml}</div>
        <div class="scaleboard__voice-hint">${pointerHint}</div>
      </div>
    `;
  },

  _renderVoiceTokens() {
    if (!this._voiceTokens || this._voiceTokens.length === 0) {
      if (!this.voiceEngine) return '';
      // Show a default-cycle hint when phrase is empty.
      return '<span class="voice-token voice-token--hint">(experimental robot voice — empty phrase sings "ah")</span>';
    }
    let validIndex = 0;
    const parts = this._voiceTokens.map((tok) => {
      if (tok.isWhitespace) return `<span class="voice-token-gap">·</span>`;
      const isCurrent = tok.valid && validIndex === this._phrasePointer;
      const cls = [
        'voice-token',
        tok.valid ? 'voice-token--valid' : 'voice-token--invalid',
        isCurrent ? 'is-current' : '',
      ].filter(Boolean).join(' ');
      const html = `<span class="${cls}" title="${tok.valid ? 'Will play: ' + this._escapeAttr(tok.text) : 'No match: ' + this._escapeAttr(tok.text) + '. Add a space or change the spelling.'}">${this._escapeHtml(tok.text)}</span>`;
      if (tok.valid) validIndex++;
      return html;
    });
    return parts.join('');
  },

  _previewSyllableForPad(_padIndex) {
    if (!this.voiceEngine) return null;
    if (this._playableSyllables.length === 0) return 'ah';
    const idx = this._phrasePointer % this._playableSyllables.length;
    return this._playableSyllables[idx];
  },

  _refreshVoiceUi() {
    if (!this.el) return;
    const row = this.el.querySelector('#sb-voice-row');
    if (this.padMode === 'voices') {
      if (!row) {
        // Re-render entire layout to insert the row
        this._refreshLayout();
        return;
      }
      const tokens = row.querySelector('#sb-voice-tokens');
      if (tokens) tokens.innerHTML = this._renderVoiceTokens();
      const hint = row.querySelector('.scaleboard__voice-hint');
      if (hint) {
        hint.textContent = this._playableSyllables.length === 0
          ? 'Experimental robot voice. Type supported sounds below. Empty phrase = pads sing "ah".'
          : `Experimental robot voice: pads advance through ${this._playableSyllables.length} token${this._playableSyllables.length === 1 ? '' : 's'}.`;
      }
    } else if (row) {
      row.remove();
    }
  },

  _bindVoiceEvents() {
    if (this.padMode !== 'voices') return;
    const input = this.el.querySelector('#sb-voice-phrase');
    if (input) {
      input.addEventListener('input', (e) => {
        // Sanitize to ASCII letters/spaces/apostrophes/hyphens.
        const sanitized = sanitizePhraseInput(e.target.value);
        if (sanitized !== e.target.value) {
          // Preserve cursor position approximately.
          const pos = input.selectionStart;
          input.value = sanitized;
          if (typeof pos === 'number') {
            const next = Math.max(0, Math.min(sanitized.length, pos - (e.target.value.length - sanitized.length)));
            try { input.setSelectionRange(next, next); } catch (_) {}
          }
        }
        this._voicePhrase = sanitized;
        this._phrasePointer = 0;

        // Debounce token recomputation.
        if (this._voiceInputDebounce) clearTimeout(this._voiceInputDebounce);
        this._voiceInputDebounce = setTimeout(() => {
          this._recomputeVoiceTokens();
          this._persistVoicePhrase();
          this._refreshVoiceUi();
          this._refreshPadsSoft();
        }, 60);
      });
    }
    const rewind = this.el.querySelector('#sb-voice-rewind');
    if (rewind) {
      rewind.addEventListener('click', (e) => {
        e.preventDefault();
        this._phrasePointer = 0;
        this._refreshVoiceUi();
        this._refreshPadsSoft();
      });
    }
  },

  _pressVoicePad(index, midi) {
    // Choose syllable: from the parsed phrase, or fall back to "ah" when phrase
    // is empty / has no playable syllables. Empty-phrase fallback gives users
    // immediate feedback without forcing them to type first.
    let syllable;
    if (this._playableSyllables.length === 0) {
      syllable = this.voiceEngine.hasSyllable('ah') ? 'ah' : (this.voiceEngine.getAvailableSyllableIds()[0] || null);
    } else {
      const ptr = this._phrasePointer % this._playableSyllables.length;
      syllable = this._playableSyllables[ptr];
      this._phrasePointer = (ptr + 1) % this._playableSyllables.length;
    }
    if (syllable) {
      if (this._onBeforeNoteOn) this._onBeforeNoteOn();
      this.voiceEngine.singSyllable(syllable, midi, 0.85);
      this._lastVoiceMidiByPad.set(index, midi);
      // Preserve voice intent for recorded snippets; playback/export routing is
      // a follow-up so old synth playback still has a clean data path.
      const voiceInfo = this.voiceEngine.getVoiceInfo?.();
      if (this._onNoteOn) {
        this._onNoteOn(midi, 0.85, {
          voice: {
            mode: 'voice-sketch',
            voiceId: voiceInfo?.id || this.project?.settings?.voiceId || 'english-base',
            syllableId: syllable,
          },
        });
      }
    }
    // Update token highlight + pad preview.
    this._refreshVoiceUi();
    this._refreshPadsSoft();
  },

  _releaseVoicePad(index) {
    const midi = this._lastVoiceMidiByPad.get(index);
    if (midi !== undefined && this.voiceEngine) {
      this.voiceEngine.releaseSyllable(midi);
      if (this._onNoteOff) this._onNoteOff(midi);
      this._lastVoiceMidiByPad.delete(index);
    }
  },
};
