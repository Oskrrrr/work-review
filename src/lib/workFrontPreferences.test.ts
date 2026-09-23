import { describe, expect, it } from 'vitest';
import { CROSS_YEAR_PROJECTS_OPEN_KEY, loadCrossYearProjectsOpen, saveCrossYearProjectsOpen } from './workFrontPreferences';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('cross-year project index preference', () => {
  it('defaults to expanded and persists a collapse choice', () => {
    const local = storage();
    expect(loadCrossYearProjectsOpen(local)).toBe(true);
    saveCrossYearProjectsOpen(false, local);
    expect(loadCrossYearProjectsOpen(local)).toBe(false);
    expect(local.getItem(CROSS_YEAR_PROJECTS_OPEN_KEY)).toBe('false');
  });

  it('restores an expanded choice after it was saved', () => {
    const local = storage();
    saveCrossYearProjectsOpen(false, local);
    saveCrossYearProjectsOpen(true, local);
    expect(loadCrossYearProjectsOpen(local)).toBe(true);
  });
});
