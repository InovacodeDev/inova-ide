// NOTE: sidebar and chat components own some modals themselves, so the DOM is the only place
// that knows every open modal. Inactive chat tabs stay mounted with display: none, so hidden
// modals must not count.
export function openModalCount(): number {
  return Array.from(document.querySelectorAll('[aria-modal="true"]')).filter((modal) =>
    modal.checkVisibility(),
  ).length;
}
