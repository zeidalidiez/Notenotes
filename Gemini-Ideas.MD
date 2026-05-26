# Accessibility Brainstorming for Notenotes

This document outlines ideas for increasing accessibility and approachability in Notenotes, specifically catering to disabled individuals, neurodivergent users, and beginners intimidated by traditional music theory.

## 1. Motor & Physical Accessibility
* **Tremor / Bounce Filtering:** For users with motor control issues (e.g., Parkinson's), accidental double-taps are common. A setting for "Pad Debounce" or "Tremor Filter" would ignore rapid, unintentional re-triggers of the same pad within a set millisecond window.
* **Dwell Control (Hover to Play):** For users who use head-trackers or eye-trackers and cannot easily "click", a mode where hovering over a pad for a set time (e.g., 400ms) triggers the note.
* **Accessibility Switch Integration:** Expand the existing Gamepad support (many adaptive controllers use the gamepad API). Add a "Stepper" mode: one button steps through a pre-written chord progression or melody, allowing someone with a single-switch device to play a song with rhythm and expression.
* **Sticky Modifiers / Latch Mode:** Ensure that any action requiring holding a button (like shifting octaves while playing) can be toggled to a "latch" state so users don't have to hold multiple keys at once.

## 2. Sensory & Neurodivergent Support (Autism / ADHD / SPD)
* **Low-Stimulation Mode:** While pulsing beat colors and visualizers are great for some, they can cause sensory overload for others. A single "Low Stim" or "Focus" toggle that disables all animations, background pulsing, and flash effects, leaving a purely static, high-contrast UI.
* **Synesthesia & Shapes (Not Just Color):** Relying only on color for degrees/beats excludes color-blind users. Combine color with geometry. For example, the Tonic/Home chord could always be a Circle, the Dominant a Triangle, etc. When a note plays, its shape ripples outward.
* **Haptic Metronome & Feedback:** Use the **Web Vibration API** (on mobile) or Gamepad Rumble API. Instead of a clicking metronome (which can be auditorily overwhelming), the user *feels* the beat through their hands. Low notes or kick drums could have a heavy rumble, while high notes have a sharp, light tap.

## 3. Cognitive & "Intimidation-Free" Features
* **Mood-Based Notation:** Instead of labeling scales "Phrygian Dominant" or "Mixolydian," give them emotional aliases that users can toggle on: "Spooky," "Heroic," "Dreamy," "Desert." 
* **Icon/Emoji Mode for Pads:** Replace interval numbers (1, b3, 5) with sequential icons (Animals, Weather, Shapes). For a beginner, remembering to "Play the Sun, then the Cloud, then the Lightning" is vastly more approachable than "Play I - IV - V."
* **The "Safety Net" Canvas:** When dragging snippets onto the Canvas, offer a "Magnetic Harmony" toggle. If a user drags a snippet that clashes horribly with the track above it, the app gently highlights the clash and offers a one-click "Make it Fit" button that transposes it to the nearest safe notes.

## 4. Auditory Accessibility (Deaf / Hard of Hearing)
* **Rich Visual Textures for "Tone":** Since the app uses Tone sliders (Crush, Wobble, Drive), make the sound visually tangible. When "Drive" is turned up, the edges of the playing pads could look jagged or fuzzy. When "Wobble" is up, the pads literally wobble on screen. This allows a user who is hard of hearing to *see* the texture they are applying to the sound.
* **Visual Peaking & Dynamics:** Expand the existing waveform previews so the size of the note block or the brightness of the pad directly correlates to the velocity/volume.
