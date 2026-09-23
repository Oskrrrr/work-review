export const CROSS_YEAR_PROJECTS_OPEN_KEY = 'work-review-cross-year-projects-open';

type BooleanStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): BooleanStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The first visit intentionally opens the cross-year project index so that
 * users can discover it. Once changed, the preference belongs to the local
 * installation rather than to an imported workbook.
 */
export function loadCrossYearProjectsOpen(storage: BooleanStorage | undefined = browserStorage()) {
  try {
    const saved = storage?.getItem(CROSS_YEAR_PROJECTS_OPEN_KEY);
    return saved === null || saved === undefined ? true : saved === 'true';
  } catch {
    return true;
  }
}

export function saveCrossYearProjectsOpen(open: boolean, storage: BooleanStorage | undefined = browserStorage()) {
  try {
    storage?.setItem(CROSS_YEAR_PROJECTS_OPEN_KEY, String(open));
  } catch {
    // A restricted browser context should not prevent the page from working.
  }
}
