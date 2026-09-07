/** Restore shared snippet identity after JSON/backup round trips. */
export function normalizeProjectSnippets(project) {
  if (!project) return;
  project.snippets ??= [];
  project.tracks ??= [];
  const byId = new Map();
  const variants = new Map();
  const signatures = new WeakMap();
  const signature = (snippet) => {
    if (!signatures.has(snippet)) {
      const { id, ...content } = snippet;
      signatures.set(snippet, JSON.stringify(content));
    }
    return signatures.get(snippet);
  };
  for (const snippet of project.snippets) {
    snippet.id ||= crypto.randomUUID();
    if (byId.has(snippet.id)) snippet.id = crypto.randomUUID();
    byId.set(snippet.id, snippet);
  }
  for (const track of project.tracks) {
    for (const clip of track.clips || []) {
      const embedded = clip.snippet;
      const id = embedded?.id || clip.snippetId;
      let source = byId.get(id);
      if (!embedded) {
        if (source) clip.snippet = source;
        continue;
      }
      if (source && source !== embedded && signature(source) !== signature(embedded)) {
        // Older projects could edit the embedded clip independently of its
        // library entry. Preserve that take as a separate reusable snippet.
        const siblings = variants.get(id) || [];
        source = siblings.find(candidate => signature(candidate) === signature(embedded));
        if (!source) {
          source = { ...embedded, id: crypto.randomUUID() };
          siblings.push(source);
          variants.set(id, siblings);
          project.snippets.push(source);
          byId.set(source.id, source);
        }
      } else if (!source) {
        source = embedded;
        source.id ||= id || crypto.randomUUID();
        project.snippets.push(source);
        byId.set(source.id, source);
      }
      clip.snippet = source;
      clip.snippetId = source.id;
    }
  }
}
