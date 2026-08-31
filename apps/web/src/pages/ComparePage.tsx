import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchUniversity, fetchUniversityAdmissions } from '../api.js';
import { useComparison } from '../store.js';

export function ComparePage() {
  const comparison = useComparison();
  const queries = useQueries({
    queries: comparison.slugs.map((slug) => ({
      queryKey: ['university', slug],
      queryFn: () => fetchUniversity(slug),
    })),
  });
  const admissionsQueries = useQueries({
    queries: comparison.slugs.map((slug) => ({
      queryKey: ['university-admissions', slug],
      queryFn: () => fetchUniversityAdmissions(slug),
    })),
  });
  const items = queries.flatMap((query) => (query.data ? [query.data] : []));
  const admissionsBySlug = new Map(
    comparison.slugs.map((slug, index) => [slug, admissionsQueries[index]?.data]),
  );
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
  type ComparisonItem = (typeof items)[number];
  type AdmissionsData = Awaited<ReturnType<typeof fetchUniversityAdmissions>> | undefined;
  const rows: Array<{
    label: string;
    read: (item: ComparisonItem, admissions: AdmissionsData) => string;
  }> = [
    { label: 'Location', read: (i) => `${i.city}, ${i.country}` },
    { label: 'Institution', read: (i) => i.institutionType },
    {
      label: 'Annual tuition (USD)',
      read: (i) => i.annualTuitionUsd?.toLocaleString() ?? 'Not published',
    },
    { label: 'Typical IB minimum', read: (i) => String(i.ibTypicalMin ?? 'Varies') },
    {
      label: 'Student body (profile)',
      read: (i) => i.studentCount?.toLocaleString() ?? 'Not published',
    },
    {
      label: 'Official fall enrollment',
      read: (_, admissions) => {
        const row = admissions?.enrollment.find(
          (item) => item.population === 'total' && item.attendanceStatus === 'all',
        );
        return row ? `${row.studentCount.toLocaleString()} (${row.academicYear})` : 'Not reported';
      },
    },
    {
      label: 'Official applicants',
      read: (_, admissions) => {
        const profile = admissions?.profiles[0];
        const row = profile?.counts.find(
          (item) => item.population === 'all' && item.metric === 'applicants',
        );
        return row?.value.toLocaleString() ?? 'Not reported';
      },
    },
    {
      label: 'Official acceptance rate',
      read: (_, admissions) => {
        const counts = admissions?.profiles[0]?.counts.filter((item) => item.population === 'all');
        const applicants = counts?.find((item) => item.metric === 'applicants')?.value;
        const admitted = counts?.find((item) => item.metric === 'admitted')?.value;
        return applicants && admitted !== undefined
          ? `${((admitted / applicants) * 100).toFixed(1)}%`
          : 'Not reported';
      },
    },
    { label: 'Programs listed', read: (i) => String(i.programs.length) },
  ];
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
            {rows.map(({ label, read }) => (
              <tr key={label}>
                <th>{label}</th>
                {items.map((item) => (
                  <td key={item.id}>{read(item, admissionsBySlug.get(item.slug))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
