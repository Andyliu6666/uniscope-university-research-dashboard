import { useEffect, useState } from 'react';

const key = 'uniscope-compare';
const storage = () => (typeof window === 'undefined' ? undefined : window.localStorage);
export const useComparison = () => {
  const [slugs, setSlugs] = useState<string[]>(
    () => JSON.parse(storage()?.getItem(key) ?? '[]') as string[],
  );
  useEffect(() => storage()?.setItem(key, JSON.stringify(slugs)), [slugs]);
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
