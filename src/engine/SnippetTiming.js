function positiveInt(value, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function eventEndTick(event, fallbackDurationTicks) {
  const start = Math.max(0, Math.round(Number(event?.startTick) || 0));
  const duration = positiveInt(event?.durationTick, fallbackDurationTicks);
  return start + duration;
}

/**
 * Returns the last audible tick implied by MIDI notes or drum hits.
 *
 * Drum hits do not carry duration, so the caller's current grid size is used
 * as a conservative display width for one hit.
 */
export function snippetContentEndTick(snippet = {}, fallbackEventTicks = 120) {
  const fallback = positiveInt(fallbackEventTicks, 120);
  let end = 0;
  for (const events of [snippet?.notes, snippet?.hits]) {
    if (!Array.isArray(events)) continue;
    for (const event of events) end = Math.max(end, eventEndTick(event, fallback));
  }
  return end;
}

/**
 * Inspect should show enough grid for the selected snippet and content, but it
 * should not force several empty bars. The floor is one bar in the current
 * meter, then the duration snaps up to the active edit grid.
 */
export function inspectDisplayDurationTicks(snippet = {}, options = {}) {
  const ticksPerBar = positiveInt(options.ticksPerBar, 1920);
  const gridTicks = positiveInt(options.gridTicks, 120);
  const storedDuration = positiveInt(snippet?.durationTicks, 0);
  const contentEnd = snippetContentEndTick(snippet, gridTicks);
  const wanted = Math.max(ticksPerBar, storedDuration, contentEnd);
  return Math.ceil(wanted / gridTicks) * gridTicks;
}
