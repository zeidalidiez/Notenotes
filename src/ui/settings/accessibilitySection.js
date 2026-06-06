/**
 * accessibilitySection — SettingsPanel Accessibility tab (render + binding).
 *
 * Methods split out of SettingsPanel for size and composed back via
 * Object.assign. Bodies unchanged.
 */

import { showToast } from '../Toast.js';
import { ensureAccessibilitySettings } from '../AccessibilityProfiles.js';

export const AccessibilitySectionMixin = {
  _renderAccessibilitySection() {
    const accessibility = ensureAccessibilitySettings(this.project);
    const tremor = accessibility.tremorFilter;
    const dwell = accessibility.dwellPlay;
    return `
      <div class="settings-section" id="section-accessibility">
        <div class="settings-group">
          <h3 class="settings-group__title">Accessibility Profiles</h3>
          <p class="settings-desc">These settings change how Notenotes receives input. They can also be turned on from a shared link, such as <code>?tremor=1</code> or <code>?dwell=1</code>, so a user does not need to click through setup before the app becomes playable.</p>
          <div class="settings-row" style="justify-content: flex-start; gap: 10px;">
            <input type="checkbox" id="setting-tremor-enabled" ${tremor.enabled ? 'checked' : ''} />
            <label class="settings-label" for="setting-tremor-enabled">Tremor filter</label>
          </div>
          <p class="settings-desc">Ignores accidental rapid re-triggers of the same pad, key, or drum sound.</p>
          <div class="settings-row">
            <label class="settings-label">Tremor window (<span id="setting-tremor-display">${tremor.thresholdMs}</span> ms)</label>
            <input class="settings-range" id="setting-tremor-threshold" type="range" min="60" max="1000" step="10" value="${tremor.thresholdMs}" aria-label="Tremor filter threshold" />
          </div>
          <div class="settings-row" style="justify-content: flex-start; gap: 10px;">
            <input type="checkbox" id="setting-dwell-enabled" ${dwell.enabled ? 'checked' : ''} />
            <label class="settings-label" for="setting-dwell-enabled">Dwell play</label>
          </div>
          <p class="settings-desc">Hover over a playable pad, key, or drum sound until the dwell timer completes. Useful for head trackers, eye trackers, and users who can aim more easily than click.</p>
          <div class="settings-row">
            <label class="settings-label">Dwell time (<span id="setting-dwell-display">${dwell.thresholdMs}</span> ms)</label>
            <input class="settings-range" id="setting-dwell-threshold" type="range" min="150" max="2000" step="25" value="${dwell.thresholdMs}" aria-label="Dwell play threshold" />
          </div>
        </div>
      </div>
    `;
  },

  _bindAccessibilityEvents() {
    const body = this.el.querySelector('#settings-body');
    const accessibility = ensureAccessibilitySettings(this.project);
    const save = () => {
      this.store?.scheduleAutoSave(this.project);
      window.dispatchEvent(new CustomEvent('settings-accessibility-changed', { detail: accessibility }));
    };

    body.querySelector('#setting-tremor-enabled')?.addEventListener('change', (e) => {
      accessibility.tremorFilter.enabled = !!e.target.checked;
      save();
      showToast(accessibility.tremorFilter.enabled ? 'Tremor filter enabled' : 'Tremor filter off');
    });

    body.querySelector('#setting-tremor-threshold')?.addEventListener('input', (e) => {
      const ms = Math.max(60, Math.min(1000, parseInt(e.target.value, 10) || 180));
      accessibility.tremorFilter.thresholdMs = ms;
      body.querySelector('#setting-tremor-display')?.replaceChildren(String(ms));
      save();
    });

    body.querySelector('#setting-dwell-enabled')?.addEventListener('change', (e) => {
      accessibility.dwellPlay.enabled = !!e.target.checked;
      save();
      showToast(accessibility.dwellPlay.enabled ? 'Dwell play enabled' : 'Dwell play off');
    });

    body.querySelector('#setting-dwell-threshold')?.addEventListener('input', (e) => {
      const ms = Math.max(150, Math.min(2000, parseInt(e.target.value, 10) || 450));
      accessibility.dwellPlay.thresholdMs = ms;
      body.querySelector('#setting-dwell-display')?.replaceChildren(String(ms));
      save();
    });
  },
};
