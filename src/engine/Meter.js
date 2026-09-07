/**
 * Meter helpers for project-level timing.
 *
 * Phase 1 keeps playback behavior identical for the existing x/4 meters while
 * introducing the richer meter shape needed for compound/asymmetric/free modes.
 */

export const DEFAULT_METER_ID = '4/4';

export const METER_PRESETS = {
  '2/4': {
    type: 'metered',
    id: '2/4',
    numerator: 2,
    denominator: 4,
    pulse: 'quarter',
    pulseCount: 2,
    grouping: [1, 1],
    feelName: 'March',
  },
  '3/4': {
    type: 'metered',
    id: '3/4',
    numerator: 3,
    denominator: 4,
    pulse: 'quarter',
    pulseCount: 3,
    grouping: [1, 1, 1],
    feelName: 'Waltz',
  },
  '4/4': {
    type: 'metered',
    id: '4/4',
    numerator: 4,
    denominator: 4,
    pulse: 'quarter',
    pulseCount: 4,
    grouping: [1, 1, 1, 1],
    feelName: 'Standard',
  },
  '5/4': {
    type: 'metered',
    id: '5/4',
    numerator: 5,
    denominator: 4,
    pulse: 'quarter',
    pulseCount: 5,
    grouping: [1, 1, 1, 1, 1],
    feelName: 'Odd 5',
  },
  '6/8': {
    type: 'metered',
    id: '6/8',
    numerator: 6,
    denominator: 8,
    pulse: 'dotted-quarter',
    pulseCount: 2,
    grouping: [3, 3],
    feelName: 'Ballad',
  },
  '9/8': {
    type: 'metered',
    id: '9/8',
    numerator: 9,
    denominator: 8,
    pulse: 'dotted-quarter',
    pulseCount: 3,
    grouping: [3, 3, 3],
    feelName: 'Jig',
  },
  '12/8': {
    type: 'metered',
    id: '12/8',
    numerator: 12,
    denominator: 8,
    pulse: 'dotted-quarter',
    pulseCount: 4,
    grouping: [3, 3, 3, 3],
    feelName: 'Slow Ballad',
  },
  '5/8': {
    type: 'metered',
    id: '5/8',
    numerator: 5,
    denominator: 8,
    pulse: 'eighth',
    pulseCount: 2,
    grouping: [2, 3],
    feelName: 'Asymmetric',
  },
  '7/8': {
    type: 'metered',
    id: '7/8',
    numerator: 7,
    denominator: 8,
    pulse: 'eighth',
    pulseCount: 3,
    grouping: [2, 2, 3],
    feelName: 'Asymmetric',
  },
  free: {
    type: 'free',
    id: 'free',
    feelName: 'Free',
  },
};

export const METER_PICKER_IDS = ['2/4', '3/4', '4/4', '5/4', '6/8', '9/8', '12/8', '5/8', '7/8'];

export const ALLOWED_GROUPINGS = {
  '5/8': [[2, 3], [3, 2]],
  '7/8': [[2, 2, 3], [2, 3, 2], [3, 2, 2]],
};

function cloneMeter(meter) {
  return JSON.parse(JSON.stringify(meter));
}

export function meterId(meter) {
  if (!meter) return DEFAULT_METER_ID;
  if (typeof meter === 'string') return meter;
  if (meter.id) return meter.id;
  if (meter.type === 'free') return 'free';
  if (Number.isFinite(meter.numerator) && Number.isFinite(meter.denominator)) {
    return `${meter.numerator}/${meter.denominator}`;
  }
  if (Number.isFinite(meter.beats) && Number.isFinite(meter.subdivision)) {
    return `${meter.beats}/${meter.subdivision}`;
  }
  return DEFAULT_METER_ID;
}

export function normalizeMeter(input) {
  if (!input) return cloneMeter(METER_PRESETS[DEFAULT_METER_ID]);
  if (typeof input === 'string') {
    return cloneMeter(METER_PRESETS[input] || METER_PRESETS[DEFAULT_METER_ID]);
  }
  if (input.type === 'free') return cloneMeter(METER_PRESETS.free);

  const id = meterId(input);
  const preset = METER_PRESETS[id] || METER_PRESETS[DEFAULT_METER_ID];
  const normalized = cloneMeter(preset);

  if (input.type === 'metered' && Array.isArray(input.grouping)) {
    const groupingTotal = input.grouping.reduce((sum, value) => sum + Number(value || 0), 0);
    if (input.grouping.every(value => Number.isInteger(value) && value > 0)
      && groupingTotal === normalized.numerator) {
      normalized.grouping = input.grouping.map(value => Number(value));
      normalized.pulseCount = normalized.grouping.length;
    }
  }

  return normalized;
}

export function meterToTimeSignature(input) {
  const meter = normalizeMeter(input);
  if (meter.type === 'free') return { beats: 4, subdivision: 4 };
  return { beats: meter.numerator, subdivision: meter.denominator };
}

export function beatUnitTicks(input, ticksPerQuarter = 480) {
  const meter = normalizeMeter(input);
  if (meter.type === 'free') return ticksPerQuarter;
  return ticksPerQuarter * (4 / meter.denominator);
}

export function ticksPerBarForMeter(input, ticksPerQuarter = 480) {
  const meter = normalizeMeter(input);
  if (meter.type === 'free') return ticksPerQuarter * 4;
  return beatUnitTicks(meter, ticksPerQuarter) * meter.numerator;
}

export function pulseTicksForMeter(input, ticksPerQuarter = 480) {
  const meter = normalizeMeter(input);
  if (meter.type === 'free') return ticksPerQuarter;
  if (!Array.isArray(meter.grouping) || !meter.grouping.length) {
    return beatUnitTicks(meter, ticksPerQuarter);
  }
  return meter.grouping.map(group => beatUnitTicks(meter, ticksPerQuarter) * group);
}

export function pulseCountForMeter(input) {
  const meter = normalizeMeter(input);
  if (meter.type === 'free') return 0;
  return Math.max(1, meter.pulseCount || meter.grouping?.length || meter.numerator || 4);
}

export function pulseForTick(input, tick, ticksPerQuarter = 480) {
  const meter = normalizeMeter(input);
  if (meter.type === 'free') return 0;
  const barTicks = ticksPerBarForMeter(meter, ticksPerQuarter);
  const relative = ((tick % barTicks) + barTicks) % barTicks;
  const pulses = pulseTicksForMeter(meter, ticksPerQuarter);
  let cursor = 0;
  for (let i = 0; i < pulses.length; i += 1) {
    const next = cursor + pulses[i];
    if (relative >= cursor && relative < next) return i;
    cursor = next;
  }
  return Math.max(0, pulses.length - 1);
}

export function meterLabel(input) {
  const meter = normalizeMeter(input);
  if (meter.type === 'free') return 'Free';
  return `${meter.numerator}/${meter.denominator}`;
}

export function barDurationSeconds(input, bpm = 120) {
  const meter = normalizeMeter(input);
  if (meter.type === 'free') return null;
  return (60 / Math.max(1, bpm)) * pulseCountForMeter(meter);
}

export function secondsPerTickForMeter(input, bpm = 120, ticksPerQuarter = 480) {
  const meter = normalizeMeter(input);
  if (meter.type === 'free') return 60 / Math.max(1, bpm) / ticksPerQuarter;
  const barTicks = ticksPerBarForMeter(meter, ticksPerQuarter);
  const secondsPerBar = (60 / Math.max(1, bpm)) * pulseCountForMeter(meter);
  return secondsPerBar / Math.max(1, barTicks);
}

export function quarterBpmForMeter(input, bpm = 120) {
  const meter = normalizeMeter(input);
  if (meter.type === 'free') return bpm;
  const barTicks = ticksPerBarForMeter(meter, 480);
  const pulses = Math.max(1, pulseCountForMeter(meter));
  return Math.max(1, bpm) * (barTicks / (pulses * 480));
}

export function subBeatsForPulse(input, pulseIndex = 0) {
  const meter = normalizeMeter(input);
  if (meter.type === 'free') return null;
  return meter.grouping[pulseIndex] ?? 1;
}
