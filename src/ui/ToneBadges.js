const TONE_BADGE_LABELS = {
  crush: 'CR',
  echo: 'EC',
  space: 'SP',
  wobble: 'WB',
  drive: 'DR',
  noise: 'NO',
};

const TONE_BADGE_TITLES = {
  crush: 'Crush',
  echo: 'Echo',
  space: 'Space',
  wobble: 'Wobble',
  drive: 'Drive',
  noise: 'Noise',
};

function isActiveTrait(traits, id) {
  const trait = traits?.[id];
  return trait?.enabled !== false && (Number(trait?.amount) || 0) > 0;
}

export function toneBadgeItemsFromSources(sources = []) {
  const validSources = sources.filter(Boolean);
  return Object.entries(TONE_BADGE_LABELS)
    .filter(([id]) => validSources.some(traits => isActiveTrait(traits, id)))
    .map(([id, label]) => ({
      id,
      label,
      title: TONE_BADGE_TITLES[id] || id,
    }));
}

export function toneBadgeItemsForSnippet(snippet) {
  if (!snippet) return [];
  return toneBadgeItemsFromSources([
    snippet.soundTraits || {},
    ...(snippet.notes || []).map(note => note.soundTraits || {}),
    ...(snippet.hits || []).map(hit => hit.soundTraits || {}),
  ]);
}

export function toneBadgeItemsForClip(clip) {
  if (!clip) return [];
  return toneBadgeItemsFromSources([
    clip.soundTraits || clip.snippet?.soundTraits || {},
    ...(clip.snippet?.notes || []).map(note => note.soundTraits || {}),
    ...(clip.snippet?.hits || []).map(hit => hit.soundTraits || {}),
  ]);
}

export function renderToneBadges(items = [], className = 'tone-badges') {
  if (!items.length) return '';
  const badges = items
    .map(item => `<span title="${escapeAttr(item.title)}">${escapeHtml(item.label)}</span>`)
    .join('');
  return `<span class="${className}" aria-label="Tone effects: ${escapeAttr(items.map(item => item.title).join(', '))}">${badges}</span>`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value = '') {
  return escapeHtml(value).replace(/"/g, '&quot;');
}
