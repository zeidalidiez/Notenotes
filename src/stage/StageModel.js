import { midiToNoteName } from '../engine/MusicTheory.js';

export const STAGE_TRACK_LIMIT = 20;

export function stageIntensityForUnits(units = 0) {
  const value = Math.max(0, Number(units) || 0);
  if (value >= 4) {
    return { units: value, tier: 'sustain', opacity: 1, weight: 1, glow: 1 };
  }
  if (value >= 2) {
    return { units: value, tier: 'bright', opacity: 0.9, weight: 0.78, glow: 0.7 };
  }
  if (value >= 1) {
    return { units: value, tier: 'solid', opacity: 0.72, weight: 0.55, glow: 0.38 };
  }
  return { units: value, tier: 'spark', opacity: 0.35, weight: 0.28, glow: 0.12 };
}

export function stageTracksForCanvas(tracks = [], { maxTracks = STAGE_TRACK_LIMIT } = {}) {
  const limit = Math.max(1, Math.floor(Number(maxTracks) || STAGE_TRACK_LIMIT));
  const hasSolo = tracks.some(track => track?.solo && !track?.muted);
  return tracks
    .filter(track => track && !track.muted)
    .filter(track => !hasSolo || track.solo)
    .slice(0, limit)
    .map((track, index) => ({
      id: track.id || `track-${index}`,
      index,
      name: track.name || `Track ${index + 1}`,
      color: track.color || '#7bd88f',
      type: track.type || 'midi',
      sourceTrack: track,
    }));
}

export function stageUnitTicksForMeter(transportOrMeter = {}, fallbackTicks = 480) {
  const ticksPerPulse = Number(transportOrMeter?.ticksPerPulse);
  if (Number.isFinite(ticksPerPulse) && ticksPerPulse > 0) return ticksPerPulse;
  const ticksPerBeat = Number(transportOrMeter?.ticksPerBeat);
  if (Number.isFinite(ticksPerBeat) && ticksPerBeat > 0) return ticksPerBeat;
  return fallbackTicks;
}

function eventIntensity(startTick, endTick, unitTicks) {
  const duration = Math.max(1, Number(endTick) - Number(startTick));
  const units = duration / Math.max(1, Number(unitTicks) || 480);
  return stageIntensityForUnits(units);
}

function clipStartTick(clip, ticksPerBar) {
  return Math.max(0, Math.round((Number(clip?.startBar) || 0) * ticksPerBar));
}

function clipDurationTick(clip, snippet, ticksPerBar) {
  const explicitBars = Number(clip?.durationBars);
  if (Number.isFinite(explicitBars) && explicitBars > 0) {
    return Math.max(1, Math.round(explicitBars * ticksPerBar));
  }
  const snippetTicks = Number(snippet?.durationTicks);
  if (Number.isFinite(snippetTicks) && snippetTicks > 0) return Math.max(1, Math.round(snippetTicks));
  return ticksPerBar;
}

export function stageEventsForCanvasTracks(tracks = [], options = {}) {
  const ticksPerBar = Math.max(1, Number(options.ticksPerBar) || 1920);
  const unitTicks = Math.max(1, Number(options.unitTicks) || 480);
  const lanes = stageTracksForCanvas(tracks, options);
  const events = [];

  lanes.forEach((laneInfo, laneIndex) => {
    const track = laneInfo.sourceTrack || {};
    for (const clip of (track.clips || [])) {
      const snippet = clip?.snippet || {};
      const clipTick = clipStartTick(clip, ticksPerBar);
      const fallbackDuration = clipDurationTick(clip, snippet, ticksPerBar);
      const color = laneInfo.color;
      const source = laneInfo.id;

      for (const note of (snippet.notes || [])) {
        const startTick = clipTick + Math.max(0, Math.round(Number(note.startTick) || 0));
        const duration = Math.max(1, Math.round(Number(note.durationTicks) || unitTicks));
        const endTick = startTick + duration;
        events.push({
          id: `${source}:note:${events.length}`,
          type: 'note',
          source,
          lane: laneIndex,
          pitch: Number(note.midi),
          startTick,
          endTick,
          durationTick: duration,
          velocity: Math.max(0, Math.min(1, Number(note.velocity) || 0.8)),
          color,
          accentColor: color,
          label: midiToNoteName(note.midi)?.display || String(note.midi),
          intensity: eventIntensity(startTick, endTick, unitTicks),
        });
      }

      for (const hit of (snippet.hits || [])) {
        const startTick = clipTick + Math.max(0, Math.round(Number(hit.startTick) || 0));
        const duration = Math.max(1, Math.round(Number(hit.durationTicks) || unitTicks * 0.25));
        const endTick = startTick + duration;
        const label = hit.drum || hit.drumName || hit.hitType || 'Hit';
        events.push({
          id: `${source}:hit:${events.length}`,
          type: 'hit',
          source,
          drum: label,
          lane: laneIndex,
          startTick,
          endTick,
          durationTick: duration,
          velocity: Math.max(0, Math.min(1, Number(hit.velocity) || 0.9)),
          color,
          accentColor: color,
          label,
          intensity: eventIntensity(startTick, endTick, unitTicks),
        });
      }

      if (snippet.type === 'audio' || (!snippet.notes?.length && !snippet.hits?.length && track.type === 'audio')) {
        const startTick = clipTick;
        const endTick = startTick + fallbackDuration;
        events.push({
          id: `${source}:clip:${events.length}`,
          type: 'clip',
          source,
          lane: laneIndex,
          startTick,
          endTick,
          durationTick: fallbackDuration,
          velocity: 0.75,
          color,
          accentColor: color,
          label: 'Audio',
          intensity: eventIntensity(startTick, endTick, unitTicks),
        });
      }
    }
  });

  return events.sort((a, b) => a.startTick - b.startTick || a.lane - b.lane);
}
