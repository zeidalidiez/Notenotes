/**
 * UndoManager — Command-pattern undo/redo stack.
 * Tracks all user actions for 50-step undo depth.
 */

const MAX_UNDO_DEPTH = 50;

export class UndoManager {
  constructor() {
    /** @type {Array<{type: string, undo: Function, redo: Function, description: string}>} */
    this._undoStack = [];
    /** @type {Array<{type: string, undo: Function, redo: Function, description: string}>} */
    this._redoStack = [];
    this._onChangeCallbacks = [];
  }

  /**
   * Register a callback fired whenever the undo/redo state changes.
   * @param {Function} fn
   * @returns {Function} Unsubscribe function
   */
  onChange(fn) {
    this._onChangeCallbacks.push(fn);
    return () => {
      const idx = this._onChangeCallbacks.indexOf(fn);
      if (idx !== -1) this._onChangeCallbacks.splice(idx, 1);
    };
  }

  _emitChange(operation) {
    for (const fn of this._onChangeCallbacks) fn(operation);
  }

  /**
   * Push a new action onto the undo stack.
   * Clears the redo stack (new branch).
   * @param {object} action - { type, undo: Function, redo: Function, description: string }
   */
  push(action) {
    this._undoStack.push(action);
    this._redoStack = []; // Clear redo on new action

    // Trim stack if over max depth
    if (this._undoStack.length > MAX_UNDO_DEPTH) {
      this._undoStack.shift();
    }

    this._emitChange('push');
  }

  /**
   * Undo the last action.
   * @returns {boolean} Whether an undo was performed
   */
  undo() {
    if (this._undoStack.length === 0) return false;
    const action = this._undoStack.pop();
    action.undo();
    this._redoStack.push(action);
    this._emitChange('undo');
    return true;
  }

  /**
   * Redo the last undone action.
   * @returns {boolean} Whether a redo was performed
   */
  redo() {
    if (this._redoStack.length === 0) return false;
    const action = this._redoStack.pop();
    action.redo();
    this._undoStack.push(action);
    this._emitChange('redo');
    return true;
  }

  /** Whether undo is available */
  get canUndo() { return this._undoStack.length > 0; }

  /** Whether redo is available */
  get canRedo() { return this._redoStack.length > 0; }

  /** Description of the next undoable action */
  get undoDescription() {
    if (!this.canUndo) return '';
    return this._undoStack[this._undoStack.length - 1].description;
  }

  /** Description of the next redoable action */
  get redoDescription() {
    if (!this.canRedo) return '';
    return this._redoStack[this._redoStack.length - 1].description;
  }

  /** Clear all history */
  clear() {
    this._undoStack = [];
    this._redoStack = [];
    this._emitChange('clear');
  }
}
