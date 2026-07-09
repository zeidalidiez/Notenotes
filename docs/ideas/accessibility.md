# Accessibility Brainstorming for Notenotes

> Discussion material, not an implementation plan. Tremor Filter, Dwell Play,
> `?tremor=1` / `?dwell=1` profiles, Step Play, reduced-motion handling, and
> accessible palettes are already shipped. The remaining ideas should extend those
> paths and be checked against the current app before implementation.

This document outlines ideas for increasing accessibility and approachability in Notenotes, specifically catering to disabled individuals, neurodivergent users, and beginners intimidated by traditional music theory.


Zeids note: A big takeaway here I think is that some accessibility features should be able to be turned on via URL by parameters like ?tremor=1 or such because clicking a checkbox for a user with such a disability may be unrealistic and we can instead open the right build for them somehow, or set up the build so that it can be built in this way? advise please. 

## 1. Motor & Physical Accessibility
* **Tremor / Bounce Filtering:** For users with motor control issues (e.g., Parkinson's), accidental double-taps are common. A setting for "Pad Debounce" or "Tremor Filter" would ignore rapid, unintentional re-triggers of the same pad within a set millisecond window.
* **Dwell Control (Hover to Play):** For users who use head-trackers or eye-trackers and cannot easily "click", a mode where hovering over a pad for a set time (e.g., 400ms) triggers the note.
* **Accessibility Switch Integration:** Expand the existing Gamepad support (many adaptive controllers use the gamepad API). Add a "Stepper" mode: one button steps through a pre-written chord progression or melody, allowing someone with a single-switch device to play a song with rhythm and expression.
Zeid's Note on this: I think this could be a good instrument like the voice sketch where we can have some sort of stepper that users can play with one button that causes each button press to go through a list of notes the user entered. help me elaborate please.
* **Sticky Modifiers / Latch Mode:** Ensure that any action requiring holding a button (like shifting octaves while playing) can be toggled to a "latch" state so users don't have to hold multiple keys at once. Zeids note: I don't know about this, advise please.


## 2. Sensory & Neurodivergent Support (Autism / ADHD / SPD)
* **Low-Stimulation Mode:** While pulsing beat colors and visualizers are great for some, they can cause sensory overload for others. A single "Low Stim" or "Focus" toggle that disables all animations, background pulsing, and flash effects, leaving a purely static, high-contrast UI. (Zeids note I think this is already handled by not turning on the optional mode, but evaluate the benefit of adding another option like a low color mode that one could access maybe as another /?sensory=1 modifier like the debug menu?)
* **Synesthesia & Shapes (Not Just Color):** Relying only on color for degrees/beats excludes color-blind users. Combine color with geometry. For example, the Tonic/Home chord could always be a Circle, the Dominant a Triangle, etc. When a note plays, its shape ripples outward.
* **Haptic Metronome & Feedback:** Use the **Web Vibration API** (on mobile) or Gamepad Rumble API. Instead of a clicking metronome (which can be auditorily overwhelming), the user *feels* the beat through their hands. Low notes or kick drums could have a heavy rumble, while high notes have a sharp, light tap.

## 3. Cognitive & "Intimidation-Free" Features
* **Mood-Based Notation:** Instead of labeling scales "Phrygian Dominant" or "Mixolydian," give them emotional aliases that users can toggle on: "Spooky," "Heroic," "Dreamy," "Desert."  Zeids note: Maybe this can be a mode that can be enabled that uses these descriptions instead, but not as a default. 
* **Icon/Emoji Mode for Pads:** Replace interval numbers (1, b3, 5) with sequential icons (Animals, Weather, Shapes). For a beginner, remembering to "Play the Sun, then the Cloud, then the Lightning" is vastly more approachable than "Play I - IV - V." Zeids note: I like the idea of visuals, but not emojis, never emojis. Help elaborate this and flesh it out. 
* **The "Safety Net" Canvas:** When dragging snippets onto the Canvas, offer a "Magnetic Harmony" toggle. If a user drags a snippet that clashes horribly with the track above it, the app gently highlights the clash and offers a one-click "Make it Fit" button that transposes it to the nearest safe notes. (I don't like this one I think, unless you can sell it to me better - Zeid)

## 4. Auditory Accessibility (Deaf / Hard of Hearing)
* **Rich Visual Textures for "Tone":** Since the app uses Tone sliders (Crush, Wobble, Drive), make the sound visually tangible. When "Drive" is turned up, the edges of the playing pads could look jagged or fuzzy. When "Wobble" is up, the pads literally wobble on screen. This allows a user who is hard of hearing to *see* the texture they are applying to the sound.
* **Visual Peaking & Dynamics:** Expand the existing waveform previews so the size of the note block or the brightness of the pad directly correlates to the velocity/volume.
