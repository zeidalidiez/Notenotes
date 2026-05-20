const POLL_INTERVAL = 30;

export const BINDABLE_GAMEPAD_BUTTONS = new Set([0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15]);

export const GAMEPAD_BUTTON_LABELS = {
  0: { short: 'A', label: 'A', detail: 'Face Button Bottom' },
  1: { short: 'B', label: 'B', detail: 'Face Button Right' },
  2: { short: 'X', label: 'X', detail: 'Face Button Left' },
  3: { short: 'Y', label: 'Y', detail: 'Face Button Top' },
  4: { short: 'LB', label: 'Left Bumper', detail: 'Left Bumper' },
  5: { short: 'RB', label: 'Right Bumper', detail: 'Right Bumper' },
  6: { short: 'LT', label: 'Left Trigger', detail: 'Tone / Trigger Note Modifier' },
  7: { short: 'RT', label: 'Right Trigger', detail: 'Tone / Trigger Note Modifier' },
  8: { short: 'Back', label: 'Back', detail: 'Back / Select' },
  9: { short: 'Start', label: 'Start', detail: 'Start / Menu' },
  10: { short: 'LS', label: 'Left Stick Press', detail: 'Left Stick Press' },
  11: { short: 'RS', label: 'Right Stick Press', detail: 'Right Stick Press' },
  12: { short: 'D-Up', label: 'D-pad Up', detail: 'D-pad Up' },
  13: { short: 'D-Down', label: 'D-pad Down', detail: 'D-pad Down' },
  14: { short: 'D-Left', label: 'D-pad Left', detail: 'D-pad Left' },
  15: { short: 'D-Right', label: 'D-pad Right', detail: 'D-pad Right' },
};

export function gamepadButtonInfo(index) {
  return GAMEPAD_BUTTON_LABELS[index] || {
    short: `B${index}`,
    label: `Button ${index}`,
    detail: `Button ${index}`,
  };
}

export class GamepadInputManager {
  constructor() {
    this._animFrame = null;
    this._lastPoll = 0;
    this._gamepadIndex = -1;
    this._prevButtons = new Set();
    this._currentButtons = new Set();
    this._heldBindableButton = null;
    this._subscribers = {
      state: new Set(),
      buttonDown: new Set(),
      buttonUp: new Set(),
      buttons: new Set(),
      triggers: new Set(),
      axes: new Set(),
    };
    this._lastState = { connected: false, label: 'No controller detected' };
  }

  start() {
    if (this._animFrame) return;
    const poll = () => {
      this._animFrame = requestAnimationFrame(poll);
      const now = performance.now();
      if (now - this._lastPoll < POLL_INTERVAL) return;
      this._lastPoll = now;
      this._poll();
    };
    this._animFrame = requestAnimationFrame(poll);
  }

  stop() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    this._animFrame = null;
  }

  on(event, fn) {
    this._subscribers[event]?.add(fn);
    return () => this._subscribers[event]?.delete(fn);
  }

  heldBindableButton() {
    return this._heldBindableButton;
  }

  state() {
    return { ...this._lastState };
  }

  _emit(event, payload) {
    this._subscribers[event]?.forEach(fn => {
      try { fn(payload); } catch (err) { console.warn('[GamepadInputManager] subscriber failed:', err); }
    });
  }

  _setState(next) {
    if (next.connected === this._lastState.connected && next.label === this._lastState.label) return;
    this._lastState = next;
    this._emit('state', { ...next });
  }

  _poll() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;

    if (this._gamepadIndex >= 0) pad = gamepads[this._gamepadIndex];
    if (!pad) {
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          pad = gamepads[i];
          this._gamepadIndex = i;
          break;
        }
      }
    }

    if (!pad) {
      this._currentButtons = new Set();
      this._prevButtons = new Set();
      this._heldBindableButton = null;
      this._setState({ connected: false, label: 'No controller detected' });
      this._emit('buttons', { current: this._currentButtons, heldBindableButton: null });
      return;
    }

    this._setState({ connected: true, label: 'Controller connected' });

    const currentButtons = new Set();
    for (let i = 0; i < pad.buttons.length; i++) {
      if (pad.buttons[i]?.pressed) currentButtons.add(i);
    }

    const newlyPressed = [...currentButtons].filter(b => !this._prevButtons.has(b));
    const newlyReleased = [...this._prevButtons].filter(b => !currentButtons.has(b));

    this._currentButtons = currentButtons;
    this._heldBindableButton = [...currentButtons].find(index => BINDABLE_GAMEPAD_BUTTONS.has(index)) ?? null;

    newlyPressed.forEach(index => this._emit('buttonDown', { index, info: gamepadButtonInfo(index), bindable: BINDABLE_GAMEPAD_BUTTONS.has(index) }));
    newlyReleased.forEach(index => this._emit('buttonUp', { index, info: gamepadButtonInfo(index), bindable: BINDABLE_GAMEPAD_BUTTONS.has(index) }));
    this._emit('buttons', { current: currentButtons, heldBindableButton: this._heldBindableButton });
    this._emit('triggers', { buttons: pad.buttons, axes: pad.axes || [] });
    this._emit('axes', { axes: pad.axes || [] });

    this._prevButtons = currentButtons;
  }
}
