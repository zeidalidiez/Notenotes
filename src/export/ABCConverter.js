/**
 * ABCConverter — Converts snippet MIDI data to ABC notation.
 * ABC is a lightweight text-based music notation format
 * that abcjs can render into sheet music.
 */

import { midiToNoteName } from '../engine/MusicTheory.js';

/**
 * ABC note name mapping from MIDI.
 * ABC uses: C D E F G A B for octave 4 (middle C),
 * c d e f g a b for octave 5,
 * C, D, etc. for octave 3, C,, for octave 2
 */
function midiToABC(midi) {
  const noteNames = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const accidentals = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]; // which are sharps
  const noteIdx = midi % 12;
  const octave = Math.floor(midi / 12) - 1;

  // Map chromatic note to diatonic + accidental
  const chromaticToNote = [
    { note: 'C', acc: '' },
    { note: '^C', acc: '' },   // C#
    { note: 'D', acc: '' },
    { note: '^D', acc: '' },   // D# / Eb
    { note: 'E', acc: '' },
    { note: 'F', acc: '' },
    { note: '^F', acc: '' },   // F#
    { note: 'G', acc: '' },
    { note: '^G', acc: '' },   // G#
    { note: 'A', acc: '' },
    { note: '^A', acc: '' },   // A# / Bb
    { note: 'B', acc: '' },
  ];

  let { note } = chromaticToNote[noteIdx];

  // Handle octave
  if (octave === 5) {
    // Lowercase for octave 5
    note = note.replace(/([A-G])/, (m) => m.toLowerCase());
  } else if (octave === 6) {
    note = note.replace(/([A-G])/, (m) => m.toLowerCase()) + "'";
  } else if (octave === 7) {
    note = note.replace(/([A-G])/, (m) => m.toLowerCase()) + "''";
  } else if (octave === 3) {
    note = note + ',';
  } else if (octave === 2) {
    note = note + ',,';
  }
  // octave 4 = uppercase, no modifier (default)

  return note;
}

/**
 * Convert note duration in ticks to ABC duration.
 * In ABC, default note = 1/8 note.
 * @param {number} ticks - Duration in ticks (480 = quarter note)
 * @param {number} ticksPerBeat - Ticks per beat (default 480)
 * @returns {string} ABC duration suffix
 */
function ticksToABCDuration(ticks, ticksPerBeat = 480) {
  const eighthNote = ticksPerBeat / 2; // 240 ticks = 1/8 note
  const ratio = ticks / eighthNote;

  if (ratio <= 0.5) return '/2';        // 1/16
  if (ratio <= 0.75) return '/';         // dotted 1/16 ~ 1/8
  if (ratio <= 1) return '';             // 1/8 (default)
  if (ratio <= 1.5) return '3/2';       // dotted 1/8
  if (ratio <= 2) return '2';           // 1/4
  if (ratio <= 3) return '3';           // dotted 1/4
  if (ratio <= 4) return '4';           // 1/2
  if (ratio <= 6) return '6';           // dotted 1/2
  if (ratio <= 8) return '8';           // whole
  return String(Math.round(ratio));
}

/**
 * Convert a snippet to ABC notation string.
 * @param {object} snippet - Snippet with notes array
 * @param {object} [options] - Override options
 * @returns {string} ABC notation
 */
export function snippetToABC(snippet, options = {}) {
  const title = options.title || 'Notenotes Sketch';
  const bpm = snippet.bpm || 120;
  const timeSig = snippet.timeSignature || { beats: 4, subdivision: 4 };
  const ticksPerBeat = 480;
  const isDrum = snippet.type === 'drum';

  if (isDrum) {
    return _drumSnippetToABC(snippet, title, bpm, timeSig, ticksPerBeat);
  }

  const notes = [...(snippet.notes || [])].sort((a, b) => a.startTick - b.startTick);

  if (notes.length === 0) {
    return `X:1\nT:${title}\nM:${timeSig.beats}/${timeSig.subdivision}\nL:1/8\nQ:1/4=${bpm}\nK:C\nz8 |\n`;
  }

  // Build ABC body
  let body = '';
  let currentTick = 0;
  const ticksPerBar = ticksPerBeat * timeSig.beats;
  let noteInBar = 0;

  for (const note of notes) {
    // Insert rests for gaps
    if (note.startTick > currentTick) {
      const gapTicks = note.startTick - currentTick;
      const restDur = ticksToABCDuration(gapTicks, ticksPerBeat);
      body += `z${restDur} `;
    }

    // Convert note
    const abcNote = midiToABC(note.pitch);
    const abcDur = ticksToABCDuration(note.durationTick, ticksPerBeat);
    body += `${abcNote}${abcDur} `;

    currentTick = note.startTick + note.durationTick;
    noteInBar++;

    // Add bar lines
    if (currentTick > 0 && currentTick % ticksPerBar === 0) {
      body += '| ';
      noteInBar = 0;
    }
  }

  // Fill remaining with rest
  const duration = snippet.durationTicks || (ticksPerBar * 4);
  if (currentTick < duration) {
    const remaining = duration - currentTick;
    const restDur = ticksToABCDuration(remaining, ticksPerBeat);
    body += `z${restDur} |`;
  }

  // Assemble full ABC
  return [
    'X:1',
    `T:${title}`,
    `M:${timeSig.beats}/${timeSig.subdivision}`,
    'L:1/8',
    `Q:1/4=${bpm}`,
    'K:C',
    body.trim(),
  ].join('\n');
}

/**
 * Convert a drum snippet to ABC notation with percussion clef.
 */
function _drumSnippetToABC(snippet, title, bpm, timeSig, ticksPerBeat) {
  const hits = [...(snippet.hits || [])].sort((a, b) => a.startTick - b.startTick);

  const drumMap = {
    kick:   'B,,',
    snare:  'D,',
    clap:   'E,',
    hihat:  '^F,',
    cymbal: 'A,',
    tomlo:  'C,',
    tommid: 'F,',
    tomhi:  'G,',
    rim:    '^C,',
    shaker: '^G,',
  };

  if (hits.length === 0) {
    return `X:1\nT:${title}\nM:${timeSig.beats}/${timeSig.subdivision}\nL:1/8\nQ:1/4=${bpm}\nK:C clef=perc\nz8 |\n`;
  }

  let body = '';
  let currentTick = 0;
  const ticksPerBar = ticksPerBeat * timeSig.beats;

  for (const hit of hits) {
    if (hit.startTick > currentTick) {
      const gapTicks = hit.startTick - currentTick;
      const restDur = ticksToABCDuration(gapTicks, ticksPerBeat);
      body += `z${restDur} `;
    }

    const abcNote = drumMap[hit.type] || 'D,';
    body += `${abcNote} `;
    currentTick = hit.startTick;

    if (currentTick > 0 && currentTick % ticksPerBar === 0) {
      body += '| ';
    }
  }

  const duration = snippet.durationTicks || (ticksPerBar * 4);
  if (currentTick < duration) {
    const remaining = duration - currentTick;
    const restDur = ticksToABCDuration(remaining, ticksPerBeat);
    body += `z${restDur} |`;
  }

  return [
    'X:1',
    `T:${title} (Drums)`,
    `M:${timeSig.beats}/${timeSig.subdivision}`,
    'L:1/8',
    `Q:1/4=${bpm}`,
    'K:C clef=perc',
    body.trim(),
  ].join('\n');
}

/**
 * Convert all project snippets to a single ABC string.
 * @param {object} project
 * @returns {string}
 */
export function projectToABC(project) {
  if (!project?.snippets?.length) return '';

  return project.snippets
    .filter(s => s.type !== 'audio')
    .map((snippet, i) => {
      return snippetToABC(snippet, { title: `${project.name} - ${snippet.name || `Snippet ${i + 1}`}` });
    }).join('\n\n');
}
