/**
 * Curated chord-pad recipes for scales where simple stacked scale-thirds are
 * not the most musical default.
 *
 * Semitones are relative to the project root, not the chord root.
 */

export const SCALE_CHORDS = {
  hungarianMinor: [
    { label: 'i', name: 'Minor home', semitones: [0, 3, 7] },
    { label: 'V', name: 'Major dominant', semitones: [7, 11, 14] },
    { label: 'bVI', name: 'Flat six major', semitones: [8, 11, 15] },
    { label: '#iv', name: 'Raised-four color', semitones: [6, 8, 11] },
    { label: 'vii', name: 'Leading-tone dim', semitones: [11, 14, 17] },
  ],
  hungarianMajor: [
    { label: 'I', name: 'Major home', semitones: [0, 4, 7] },
    { label: '#II', name: 'Raised-two color', semitones: [3, 6, 10] },
    { label: '#iv', name: 'Raised-four color', semitones: [6, 9, 12] },
    { label: 'V', name: 'Dominant', semitones: [7, 10, 15] },
    { label: 'bVII', name: 'Flat-seven major', semitones: [10, 15, 18] },
  ],
  romanianMinor: [
    { label: 'i', name: 'Minor home', semitones: [0, 3, 7] },
    { label: 'IV', name: 'Raised-four major', semitones: [6, 9, 14] },
    { label: 'V', name: 'Dominant', semitones: [7, 10, 14] },
    { label: 'bVII', name: 'Flat-seven major', semitones: [10, 14, 17] },
  ],
  doubleHarmonic: [
    { label: 'I', name: 'Major home', semitones: [0, 4, 7] },
    { label: 'bII', name: 'Flat-two major', semitones: [1, 5, 8] },
    { label: 'iv', name: 'Minor four', semitones: [5, 8, 12] },
    { label: 'V', name: 'Major dominant', semitones: [7, 11, 14] },
    { label: 'bVI+', name: 'Flat-six augmented', semitones: [8, 12, 16] },
  ],
  phrygianDominant: [
    { label: 'I', name: 'Major home', semitones: [0, 4, 7] },
    { label: 'bII', name: 'Flat-two major', semitones: [1, 5, 8] },
    { label: 'iv', name: 'Minor four', semitones: [5, 8, 12] },
    { label: 'v', name: 'Flat-seven color', semitones: [7, 10, 13] },
    { label: 'bVII', name: 'Flat-seven major', semitones: [10, 13, 17] },
  ],
  neapolitanMinor: [
    { label: 'i', name: 'Minor home', semitones: [0, 3, 7] },
    { label: 'bII', name: 'Flat-two major', semitones: [1, 5, 8] },
    { label: 'iv', name: 'Minor four', semitones: [5, 8, 11] },
    { label: 'V', name: 'Major dominant', semitones: [7, 11, 13] },
  ],
  hirajoshi: [
    { label: 'i', name: 'Open home', semitones: [0, 7] },
    { label: 'i+b6', name: 'Minor flat-six', semitones: [0, 3, 8] },
    { label: '2-5', name: 'Suspended wedge', semitones: [2, 7, 15] },
    { label: 'b3-5', name: 'Minor fifth', semitones: [3, 7, 14] },
  ],
  inScale: [
    { label: '1-5', name: 'Open home', semitones: [0, 7] },
    { label: 'b2-5', name: 'Flat-two tension', semitones: [1, 7, 12] },
    { label: '4-b6', name: 'Fourth flat-six', semitones: [5, 8, 12] },
    { label: 'b6-1', name: 'Flat-six return', semitones: [8, 12, 17] },
  ],
  iwato: [
    { label: '1-b5', name: 'Tritone home', semitones: [0, 6] },
    { label: 'b2-b7', name: 'Flat-two flat-seven', semitones: [1, 10, 12] },
    { label: '4-b5', name: 'Fourth tritone', semitones: [5, 6, 12] },
    { label: 'b7-1', name: 'Flat-seven return', semitones: [10, 12, 17] },
  ],
  marwa: [
    { label: 'I', name: 'Major home', semitones: [0, 4, 7] },
    { label: 'bII', name: 'Flat-two color', semitones: [1, 6, 11] },
    { label: '#IV', name: 'Raised-four color', semitones: [6, 11, 16] },
    { label: 'V', name: 'Dominant', semitones: [7, 11, 14] },
  ],
  purvi: [
    { label: 'I', name: 'Major home', semitones: [0, 4, 7] },
    { label: 'bII', name: 'Flat-two color', semitones: [1, 6, 8] },
    { label: '#IV', name: 'Raised-four color', semitones: [6, 8, 11] },
    { label: 'V', name: 'Dominant', semitones: [7, 11, 13] },
  ],
  todi: [
    { label: 'i', name: 'Minor home', semitones: [0, 3, 7] },
    { label: 'bII', name: 'Flat-two color', semitones: [1, 6, 11] },
    { label: '#iv', name: 'Raised-four color', semitones: [6, 8, 11] },
    { label: 'V', name: 'Dominant pull', semitones: [7, 11, 13] },
  ],
};

export function scaleChordRecipes(scaleName) {
  return SCALE_CHORDS[scaleName] || null;
}
