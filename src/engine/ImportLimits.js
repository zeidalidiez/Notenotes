// Ten minutes at the fastest supported compound-meter tempo (360 quarters/min).
// Bound both individual durations and summed ends before allocating editor grids.
export const MAX_IMPORTED_TICKS = 480 * 360 * 10;
export const MAX_IMPORTED_BARS = MAX_IMPORTED_TICKS / 480;
