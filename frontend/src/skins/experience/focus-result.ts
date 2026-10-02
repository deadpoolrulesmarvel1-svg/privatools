/**
 * Move focus to what a run produced, but only when nothing else holds it.
 *
 * By the time a result appears, the control that started the run is gone or
 * disabled, so focus has fallen back to the page. If something still holds
 * focus, the visitor moved on while the run worked (into the search dialog,
 * a field, a link) and keeps their place: taking focus then would lose their
 * keystrokes, or pull it out of an open modal.
 */
export function focusIfIdle(target: HTMLElement | null | undefined): void {
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return;
    target?.focus();
}
