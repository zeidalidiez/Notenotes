# Sound-design idea bank

> Discussion material, not an implementation plan. Tone controls, clip Tone,
> Modern and FM synth families, sampled instruments, and four-zone Height Velocity
> are already shipped. Check the app and [`../roadmap.md`](../roadmap.md) before
> turning an older idea below into work.

## Sound Shaping Ideas For Notenotes

Goal: let people shape sound in ways that feel playful, visual, and approachable, without requiring synth vocabulary like oscillator, filter, envelope, LFO, or modulation matrix.

### 1. Sound Colors

Let each patch expose a small palette of “sound colors” instead of technical parameters.

Examples:

- Bright
- Warm
- Fuzzy
- Hollow
- Glassy
- Soft
- Sharp
- Wobbly
- Tiny
- Huge

Users could paint notes or pads with sound colors, similar to beat colors. The engine maps those colors to filter, drive, envelope, detune, chorus, or bitcrush behind the scenes.

Possible UI:

- color swatches beside the scale pads
- hold a swatch, then tap notes
- gamepad face buttons cycle colors
- shoulder buttons shift octave, triggers shift “sound color intensity”

### 2. Gesture Pads

Instead of a synth panel, use an XY pad with friendly labels.

Example mappings:

- left/right: dark to bright
- down/up: dry to dreamy
- center: natural
- corners: extreme character

Gamepad mapping:

- left stick controls current sound gesture
- right stick controls pitch/mod expression
- clicking stick resets to center

This keeps the controller idea consistent with pad input.

### 3. Mood Morphing

Each instrument could have 3-5 mood points rather than knobs.

Example for a chiptune synth:

- Happy
- Nervous
- Brave
- Sleepy
- Broken

Users drag between moods or select them with the D-pad. The synth interpolates internal parameters.

This could make sound design feel like choosing emotional direction instead of programming a synth.

### 4. Note Shapes

Let users choose shapes that affect note articulation.

Examples:

- Dot: short pluck
- Line: sustained
- Ramp: swelling
- Spike: sharp attack
- Wave: tremolo/vibrato
- Block: compressed/arcade

These could appear visually in snippets and piano roll notes.

Possible use:

- selected note shape applies to newly recorded notes
- edit mode lets users change note shape
- controller buttons cycle shape while playing

### 5. Texture Layers

Each synth patch could have a simple texture layer slider or selector.

Examples:

- Clean
- Dust
- Tape
- Spark
- Static
- Crunch
- Air

Internally this could map to noise, bitcrush, subtle pitch drift, chorus, or filtering.

This would give character without exposing a technical effects rack.

### 6. Beat-Reactive Sound

Tie sound shaping to beat colors and meter position.

Examples:

- beat 1 is strongest/brighter
- offbeats are softer/darker
- selected beat colors alter timbre
- 5/4 and 3/4 patterns can feel different without the user editing automation

This makes time signature and beat color more musically meaningful.

### 7. Draw Your Tone

Let users draw a small curve that controls tone over the snippet.

Friendly labels:

- Brightness path
- Wobble path
- Fuzz path
- Space path

This could be an automation lane, but presented like drawing a melody contour.

Controller version:

- record stick movement while holding a pad
- the movement becomes a visible sound path

### 8. Sound Seeds

Offer a “surprise me, but nearby” button for patches.

Rules:

- never randomize into unusable silence or ear-piercing volume
- keep patch volume normalized
- preserve the basic role: lead stays lead, bass stays bass, pad stays pad
- let users lock traits, such as “keep fuzzy” or “keep bright”

This could be great for nontechnical users.

### 9. Instrument Characters

Instead of a list of patch names only, instruments could have characters/roles.

Examples:

- Tiny Hero
- Basement Bass
- Phone Ghost
- Sleepy Star
- Broken Robot
- Pocket Choir

Each character exposes 2-3 approachable controls:

- mood
- texture
- size

This keeps the app playful without becoming a toy.

### 10. Clip-Level Sound Tags

Let snippets carry sound tags that affect playback.

Examples:

- “underwater”
- “far away”
- “angry”
- “sparkly”
- “old radio”
- “dreamy”

Tags could be applied to a whole snippet from the tray or canvas. This lets users remix the same melodic idea without editing every note.

### 11. Pressure Without Pressure

Since many users will not have velocity-sensitive input, simulate expression from interaction style.

Examples:

- quick tap: sharper sound
- long hold: warmer/sustained sound
- repeated taps: more grit
- stick distance from center: stronger expression
- trigger pressure on gamepad: intensity

This keeps expressive control accessible on keyboard, touch, mouse, and controller.

### 12. Safe Advanced Mode

Offer a hidden or optional “advanced” page for users who do want synth controls.

Keep the main UI friendly, but allow:

- oscillator type
- second oscillator blend
- filter
- envelope
- LFO
- drive
- delay/reverb

Important: advanced edits should still feed back into friendly labels like Bright, Fuzzy, Short, Dreamy.

## Strong Candidates For Next Feature Pass

Best ideas to prototype first:

1. Sound Colors
2. Gesture Pad
3. Note Shapes
4. Texture Layers
5. Sound Seeds

These fit the existing Notenotes philosophy and are likely achievable without turning the app into a conventional DAW.
