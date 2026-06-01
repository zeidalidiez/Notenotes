export const DEFAULT_VELOCITY_RESPONSE = {
  filter: 0,
  drive: 0,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeVelocityResponse(response = null) {
  if (!response || typeof response !== 'object') return { ...DEFAULT_VELOCITY_RESPONSE };
  return {
    filter: clamp(Number(response.filter) || 0, 0, 1),
    drive: clamp(Number(response.drive) || 0, 0, 0.3),
  };
}

export function velocityAdjustedFilterFrequency(baseFrequency, velocity = 0.8, response = null) {
  const amount = normalizeVelocityResponse(response).filter;
  if (amount <= 0) return baseFrequency;
  const v = clamp(Number(velocity) || 0, 0, 1.25);
  const offset = clamp((v - 0.5) * 1.8 * amount, -0.65, 1.1);
  return clamp(baseFrequency * (1 + offset), 40, 19000);
}

export function velocityAdjustedDrive(baseDrive = 0, velocity = 0.8, response = null) {
  const amount = normalizeVelocityResponse(response).drive;
  const drive = Number(baseDrive) || 0;
  if (amount <= 0) return drive;
  const v = clamp(Number(velocity) || 0, 0, 1.25);
  const hardHit = Math.max(0, (v - 0.5) * 2);
  return clamp(drive + amount * hardHit, 0, 0.95);
}
