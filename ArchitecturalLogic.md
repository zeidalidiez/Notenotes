# Notenotes Architectural Logic

Notenotes takes a very deliberate approach to state management and separation of concerns. Because it is a real-time audio application, its architecture prioritizes low-latency timing over modern web development conveniences. 

Here is how the app organizes its logic, state, and responsibilities:

## 1. No Framework (Vanilla JS)
The most important architectural decision is that **there is no framework** (no React, Vue, or Svelte). 
* **Why?** Web Audio scheduling requires absolute, predictable timing. The "re-render cycles" and virtual DOM diffing of modern frameworks introduce micro-stutters (jitter) that ruin rhythmic timing.
* **How it works:** Every component is an ES Module class that owns its own DOM element (`this.el`). It explicitly builds the DOM in a `render()` method and manually adds/removes event listeners.

## 2. Separation of Concerns (The Module Graph)
The app divides responsibilities into strict directories:

* **`engine/` (The Core):** Pure logic, math, and Web Audio. It knows nothing about the DOM or the UI.
  * `Transport.js` handles the clock and scheduling.
  * `AudioEngine.js` is the Web Audio singleton.
  * `MusicTheory.js` and `Meter.js` are pure utility math functions.
* **`instruments/` (Sound & Input):** Classes like `ScaleBoard` and `SketchKit` that translate user input (clicks, touch, gamepad) into audio instructions (via `WebAudioSynth` or `AudioEngine`).
* **`modes/` (Macro UI):** The three main screens (`CreativeMode`, `CanvasMode`, `EditMode`). These act as sub-orchestrators. For instance, `CreativeMode` wires the recording manager to the instruments and the snippet tray.
* **`ui/` (Micro UI):** Dumb presentation components (`TransportBar`, `SettingsPanel`). They render state and fire callbacks/events when clicked, but they don't contain core audio logic.
* **`data/` (Persistence):** `ProjectStore.js` handles all IndexedDB operations.
* **`main.js` (The Orchestrator):** The brain of the app. It instantiates all the singletons, loads the database, and injects dependencies into the UI modes. Since there is no global event bus like Redux, `main.js` manually wires components together (e.g., telling the Transport to tell the LoopProgress bar to move).

## 3. State Management (The `project` Object)
State is not kept in a global store like Redux; instead, it lives in a giant JSON tree called the `project` object.

* **Top-Down Flow:** When the app loads, `main.js` pulls the `project` from IndexedDB and injects it downward via setters (e.g., `this.creativeMode.project = this.project`). When a component receives the new project state, it re-renders itself.
* **Shared References (Intentional Mutation):** When a user drags a snippet onto the Canvas, the track clip stores a direct reference to that snippet in `project.snippets`. If you open the piano roll (`EditMode`) and change a note, it mutates that array in place. Because everything references the same object, the Canvas instantly reflects the change without needing a complex state-syncing mechanism.
* **Auto-Save:** Instead of dispatching state actions, any time a component modifies the project (like changing a setting or moving a clip), it relies on a debounced auto-save. `ProjectStore.scheduleAutoSave(this.project)` waits 2 seconds, sanitizes the object, and writes it to IndexedDB while taking a snapshot for the Undo history.

## 4. Decoupling Visual State from Audio State
This is crucial for performance. The UI and the audio engine run on two different "clocks."

* **Audio Clock (The Lookahead Scheduler):** `Transport.js` runs a `setInterval` loop every 25ms. It looks 100ms into the future and tells the `AudioContext` to schedule notes at exact hardware times.
* **Visual Clock:** Visual elements like the moving playhead (`LoopProgress`), the background beat color pulses, or the recording meters do not wait for the audio engine. They run on `requestAnimationFrame` (usually 60 or 120 times a second), asking the `Transport` what the current time is, and drawing the visuals smoothly.

By keeping the heavy lifting of UI rendering completely separated from the audio scheduling loop, the app ensures that even if the browser stutters while drawing the screen, the music stays perfectly on beat.
