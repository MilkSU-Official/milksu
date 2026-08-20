/**
 * A Chinese IME confirms its candidate with the same Enter (and dismisses it with
 * the same Escape) that a form uses to submit, and the event still reports
 * `key: 'Enter'`. Commit handlers must let those keys through untouched, or the
 * candidate confirmation submits a half-typed value.
 *
 * `keyCode === 229` covers platforms and input methods that do not set
 * `isComposing` on the keydown.
 */
export function isComposingKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}
