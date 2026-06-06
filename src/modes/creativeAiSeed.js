/**
 * creativeAiSeed — CreativeMode feature extracted for size; composed back onto
 * CreativeMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { buildAIInstrumentInfo, mapCreativeInstrumentToAi } from '../ai/AIInstrumentContext.js';
import { showToast } from '../ui/Toast.js';
import { INSTRUMENTS } from './creativeConstants.js';

export const CreativeAiSeedMixin = {
  /**
   * Map CreativeMode's instrument enum to the AI's smaller surface.
   * Controller is treated as scaleboard for AI purposes — it uses the same
   * scale-locked pad primitive. Mic returns null because the AI does not
   * generate audio (intentional scope limit).
   */
  _mapInstrumentToAi(creativeInstrumentId) {
    return mapCreativeInstrumentToAi(creativeInstrumentId);
  },

  /**
   * Tell the AIController what instrument it should write events for, plus
   * the runtime context the prompt needs (scale, root, pad count for scale-
   * locked, etc.).
   */
  _buildAIInstrumentInfo() {
    return buildAIInstrumentInfo(this.activeInstrument, { scaleBoard: this.scaleBoard });
  },

  /**
   * Handle an AI-seeded snippet. Mirrors the post-recording flow but tags
   * the snippet for the tray badge and uses an AI-flavored toast.
   */
  _onAISnippetCreated(snippet) {
    if (!snippet) return;
    this.snippetTray.addSnippet(snippet);
    if (this.project) {
      if (!Array.isArray(this.project.snippets)) this.project.snippets = [];
      this.project.snippets.push(snippet);
      this.store?.scheduleAutoSave(this.project);
    }
    window.dispatchEvent(new CustomEvent('project-snippets-changed', { detail: { snippetId: snippet.id, action: 'created' } }));
    const eventCount = (snippet.notes?.length || 0) + (snippet.hits?.length || 0);
    showToast(`Snippet seeded (${eventCount} event${eventCount === 1 ? '' : 's'})`);
  },

  _syncAISeedButtonVisibility() {
    const btn = this.el?.querySelector('#ai-seed-button');
    if (!btn) return;
    const id = this.activeInstrument;
    const showInPatchSelector =
      id === INSTRUMENTS.SCALEBOARD || id === INSTRUMENTS.PIANO || id === INSTRUMENTS.CONTROLLER;
    const disabled = id === INSTRUMENTS.CONTROLLER;
    btn.style.display = showInPatchSelector ? '' : 'none';
    btn.disabled = disabled;
    btn.title = disabled ? 'AI Seed is not available from Controller setup' : 'Seed a snippet with AI';
    btn.setAttribute('aria-disabled', String(disabled));
  },

  _isAISeedAvailable() {
    const id = this.activeInstrument;
    if (id === INSTRUMENTS.SCALEBOARD && this.scaleBoard?.padMode === 'voices') {
      return { available: false, reason: 'voices-mode' };
    }
    if (!this._aiCanGenerateForInstrument(id)) {
      return { available: false, reason: 'unsupported-instrument' };
    }
    return { available: true };
  },

  _aiCanGenerateForInstrument(creativeInstrumentId) {
    return creativeInstrumentId === INSTRUMENTS.SCALEBOARD
      || creativeInstrumentId === INSTRUMENTS.PIANO
      || creativeInstrumentId === INSTRUMENTS.KIT;
  },

  _toggleAISeedPopover(anchor, buttonEl = null) {
    this.aiSeedPopover?.toggle(anchor, buttonEl);
  },

  _closeAISeedPopover() {
    this.aiSeedPopover?.close();
  },
};
