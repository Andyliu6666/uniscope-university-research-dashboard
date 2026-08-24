import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchUniversity } from '../api.js';
import { useComparison } from '../store.js';

export function ComparePage() {
  const comparison = useComparison();
  const queries = useQueries({
    queries: comparison.slugs.map((slug) => ({
      queryKey: ['university', slug],
      queryFn: () => fetchUniversity(slug),
    })),
  });
  const items = queries.flatMap((query) => (query.data ? [query.data] : []));
  if (!comparison.slugs.length)
    return (
      <div className="empty page">
        <p className="kicker">Comparison</p>
        <h1>Your shortlist is empty</h1>
        <p>Add universities from the explore page to see their key facts side by side.</p>
        <Link className="primary-link" to="/">
          Explore universities
        </Link>
      </div>
    );
  const rows = [
    ['Location', (i: (typeof items)[number]) => `${i.city}, ${i.country}`],
    ['Institution', (i: (typeof items)[number]) => i.institutionType],
    [
      'Annual tuition (USD)',
      (i: (typeof items)[number]) => i.annualTuitionUsd?.toLocaleString() ?? 'Not published',
    ],
    ['Typical IB minimum', (i: (typeof items)[number]) => String(i.ibTypicalMin ?? 'Varies')],
    [
      'Student body',
      (i: (typeof items)[number]) => i.studentCount?.toLocaleString() ?? 'Not published',
    ],
    ['Programs listed', (i: (typeof items)[number]) => String(i.programs.length)],
  ] as const;
  return (
    <div className="compare-page">
      <div className="section-heading">
        <div>
          <p className="kicker">Side by side</p>
          <h1>Compare your shortlist</h1>
          <p>
            Use this as a starting point, then confirm every application decision at the source.
          </p>
        </div>
        <button type="button" onClick={comparison.clear}>
          Clear all
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Measure</th>
              {items.map((item) => (
                <th key={item.id}>
                  <Link to={`/universities/${item.slug}`}>{item.name}</Link>
                  <button type="button" onClick={() => comparison.toggle(item.slug)}>
                    Remove
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, read]) => (
              <tr key={label}>
                <th>{label}</th>
                {items.map((item) => (
                  <td key={item.id}>{read(item)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
