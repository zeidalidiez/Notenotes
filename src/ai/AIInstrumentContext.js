export function mapCreativeInstrumentToAi(creativeInstrumentId) {
  switch (creativeInstrumentId) {
    case 'scaleboard':
    case 'controller':
      return 'scaleboard';
    case 'piano':
      return 'piano';
    case 'kit':
      return 'kit';
    case 'mic':
    default:
      return 'scaleboard';
  }
}

export function buildAIInstrumentInfo(creativeInstrumentId, { scaleBoard } = {}) {
  const aiInstrument = mapCreativeInstrumentToAi(creativeInstrumentId);
  const info = {
    instrument: aiInstrument,
    scaleName: scaleBoard?.scaleName || 'major',
    rootNote: scaleBoard?.rootNote || 'C',
    octave: scaleBoard?.octave || 4,
  };
  if (aiInstrument === 'scaleboard') {
    info.padCount = scaleBoard?._notes?.length || 7;
  }
  return info;
}
