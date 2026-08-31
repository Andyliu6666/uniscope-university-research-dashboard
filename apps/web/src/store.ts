import { useEffect, useState } from 'react';

const key = 'uniscope-compare';
const storage = () => (typeof window === 'undefined' ? undefined : window.localStorage);

export const readStoredComparison = (value: string | null | undefined) => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, 3);
  } catch {
    // A browser extension, an old release, or manual localStorage edits can
    // leave invalid JSON behind. The shortlist should recover gracefully.
    return [];
  }
};

export const useComparison = () => {
  const [slugs, setSlugs] = useState<string[]>(() => readStoredComparison(storage()?.getItem(key)));
  useEffect(() => {
    try {
      storage()?.setItem(key, JSON.stringify(slugs));
    } catch {
      // Comparison is a convenience feature; a restricted browser storage
      // context must not prevent the rest of the site from rendering.
    }
  }, [slugs]);
  const toggle = (slug: string) =>
    setSlugs((current) =>
      current.includes(slug)
        ? current.filter((item) => item !== slug)
        : current.length < 3
          ? [...current, slug]
          : current,
    );
  return { slugs, toggle, clear: () => setSlugs([]) };
};
