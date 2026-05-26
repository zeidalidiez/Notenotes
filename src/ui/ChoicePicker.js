import './ChoicePicker.css';

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function matchesItem(item, query) {
  if (!query) return true;
  const haystack = [
    item.label,
    item.kicker,
    item.description,
    ...(item.tags || []),
  ].map(normalizeText).join(' ');
  return haystack.includes(query);
}

/**
 * Reusable categorized picker for creative lists that have outgrown native
 * select menus. It is intentionally DOM-native and inert until opened.
 */
export class ChoicePicker {
  constructor({
    title,
    groups = [],
    selectedValue = '',
    searchPlaceholder = 'Search...',
    onSelect = null,
  } = {}) {
    this.title = title || 'Choose';
    this.groups = groups;
    this.selectedValue = selectedValue;
    this.searchPlaceholder = searchPlaceholder;
    this.onSelect = onSelect;
    this.backdrop = null;
    this.el = null;
    this._activeGroupId = groups.find(group => (group.items || []).some(item => item.value === selectedValue))?.id || groups[0]?.id || '';
    this._query = '';
    this._onKeyDown = (event) => this._handleKeyDown(event);
  }

  open(anchor) {
    this.close();

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'choice-picker-backdrop';
    this.backdrop.addEventListener('pointerdown', () => this.close());

    this.el = document.createElement('div');
    this.el.className = 'choice-picker';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', this.title);
    this.el.addEventListener('pointerdown', (event) => event.stopPropagation());

    document.body.appendChild(this.backdrop);
    document.body.appendChild(this.el);
    document.addEventListener('keydown', this._onKeyDown);

    this._position(anchor);
    this._render({ focusSearch: true });
    requestAnimationFrame(() => this.el?.querySelector('.choice-picker__search')?.focus());
  }

  close() {
    document.removeEventListener('keydown', this._onKeyDown);
    this.backdrop?.remove();
    this.el?.remove();
    this.backdrop = null;
    this.el = null;
  }

  _position(anchor) {
    if (!anchor || window.matchMedia('(max-width: 640px)').matches) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(560, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = Math.min(rect.bottom + 8, window.innerHeight - 32);
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  _visibleGroups() {
    const query = normalizeText(this._query.trim());
    return this.groups
      .map(group => ({
        ...group,
        items: (group.items || []).filter(item => matchesItem(item, query)),
      }))
      .filter(group => group.items.length);
  }

  _render({ focusSearch = false } = {}) {
    if (!this.el) return;
    const visibleGroups = this._visibleGroups();
    if (!visibleGroups.some(group => group.id === this._activeGroupId)) {
      this._activeGroupId = visibleGroups[0]?.id || this.groups[0]?.id || '';
    }
    const listGroups = this._query.trim()
      ? visibleGroups
      : visibleGroups.filter(group => group.id === this._activeGroupId);

    this.el.innerHTML = `
      <div class="choice-picker__header">
        <h2 class="choice-picker__title">${this.title}</h2>
      </div>
      <input class="choice-picker__search" type="search" value="${this._escapeAttr(this._query)}" placeholder="${this._escapeAttr(this.searchPlaceholder)}" aria-label="${this._escapeAttr(this.searchPlaceholder)}">
      <div class="choice-picker__body">
        <div class="choice-picker__groups" role="tablist">
          ${visibleGroups.map(group => `
            <button class="btn btn--ghost choice-picker__group-tab${group.id === this._activeGroupId ? ' is-active' : ''}" type="button" data-group-id="${this._escapeAttr(group.id)}">
              ${this._escapeHtml(group.label)}
            </button>
          `).join('')}
        </div>
        <div class="choice-picker__list">
          ${listGroups.length ? listGroups.map(group => this._renderGroup(group)).join('') : '<div class="choice-picker__empty">No matches</div>'}
        </div>
      </div>
    `;

    const search = this.el.querySelector('.choice-picker__search');
    search?.addEventListener('input', (event) => {
      this._query = event.target.value;
      this._render({ focusSearch: true });
    });
    if (focusSearch) {
      requestAnimationFrame(() => {
        const nextSearch = this.el?.querySelector('.choice-picker__search');
        nextSearch?.focus();
        nextSearch?.setSelectionRange?.(nextSearch.value.length, nextSearch.value.length);
      });
    }

    this.el.querySelectorAll('.choice-picker__group-tab').forEach(button => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this._activeGroupId = button.dataset.groupId;
        this._query = '';
        this._render();
      });
    });

    this.el.querySelectorAll('.choice-picker__option').forEach(button => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const value = button.dataset.value;
        const item = this.groups.flatMap(group => group.items || []).find(candidate => candidate.value === value);
        this.selectedValue = value;
        this.onSelect?.(value, item);
        this.close();
      });
    });
  }

  _renderGroup(group) {
    return `
      <section class="choice-picker__group" data-group-section="${this._escapeAttr(group.id)}">
        <div class="choice-picker__group-title">${this._escapeHtml(group.label)}</div>
        ${(group.items || []).map(item => this._renderItem(item)).join('')}
      </section>
    `;
  }

  _renderItem(item) {
    const selected = item.value === this.selectedValue;
    return `
      <button class="choice-picker__option${selected ? ' is-selected' : ''}" type="button" data-value="${this._escapeAttr(item.value)}">
        <span class="choice-picker__option-main">
          <span class="choice-picker__option-label">${this._escapeHtml(item.label)}</span>
          ${item.kicker ? `<span class="choice-picker__option-kicker">${this._escapeHtml(item.kicker)}</span>` : ''}
          ${item.description ? `<span class="choice-picker__option-desc">${this._escapeHtml(item.description)}</span>` : ''}
        </span>
        ${selected ? '<span class="choice-picker__selected-mark" aria-hidden="true">Selected</span>' : ''}
      </button>
    `;
  }

  _handleKeyDown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.close();
  }

  _escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]);
  }

  _escapeAttr(value) {
    return this._escapeHtml(value);
  }
}
