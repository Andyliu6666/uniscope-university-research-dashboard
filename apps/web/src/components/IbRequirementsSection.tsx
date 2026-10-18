import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatIbTotal, type IbQuery, type IbRequirement } from '@urd/shared';
import { fetchUniversityIb } from '../api.js';

export function IbRequirementCard({ requirement }: { requirement: IbRequirement }) {
  return (
    <div className="ib-requirement">
      <strong>{formatIbTotal(requirement)}</strong>
      <p className="muted">
        {requirement.academicYear === 'unspecified'
          ? 'Entry year not stated by source'
          : `${requirement.academicYear} entry`}
        {' · '}
        {requirement.intakeTerm === 'unspecified' ? 'Term not specified' : requirement.intakeTerm}
        {' · '}
        {requirement.applicantContext}
      </p>
      {requirement.hlGrades.length > 0 && (
        <p>Higher Level grades: {requirement.hlGrades.join(', ')}</p>
      )}
      {requirement.subjectNotes && <p>{requirement.subjectNotes}</p>}
      {requirement.includesCorePoints !== null && (
        <p className="muted">
          {requirement.includesCorePoints
            ? 'Total includes core points.'
            : 'Total excludes core points.'}
        </p>
      )}
      <p>{requirement.conditions}</p>
      <a href={requirement.source.url} target="_blank" rel="noreferrer">
        Official requirement · checked {requirement.source.checkedOn} ↗
      </a>
    </div>
  );
}

export function IbRequirementsSection({ slug }: { slug: string }) {
  const [filters, setFilters] = useState<IbQuery>({
    q: '',
    entryType: 'first_year',
    level: 'undergraduate',
    page: 1,
    pageSize: 20,
  });
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['university-ib', slug, filters],
    queryFn: () => fetchUniversityIb(slug, filters),
  });
  const update = (values: Partial<IbQuery>) =>
    setFilters((current) => ({ ...current, ...values, page: 1 }));
  const data = query.data;
  useEffect(() => {
    if (window.location.hash === '#ib-requirements')
      document.getElementById('ib-requirements')?.scrollIntoView?.();
  }, []);
  return (
    <section className="panel ib-panel" id="ib-requirements" aria-labelledby="ib-heading">
      <p className="kicker">Programs & IB entry requirements</p>
      <h2 id="ib-heading">Find the requirements for your course</h2>
      <p>
        Compare the entry year, applicant route, IB total and Higher Level conditions. A published
        minimum permits consideration; it does not guarantee an offer.
      </p>
      <form
        className="ib-filters"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: search.trim() });
        }}
      >
        <label>
          Program name
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            type="search"
            maxLength={100}
            placeholder="Search this university’s programs"
          />
        </label>
        <label>
          Entry year
          <select
            value={filters.year ?? ''}
            onChange={(event) => update({ year: event.target.value || undefined })}
          >
            <option value="">All reviewed years</option>
            {[...new Set([...(data?.years ?? []), ...(filters.year ? [filters.year] : [])])].map(
              (year) => (
                <option key={year} value={year}>
                  {year === 'unspecified' ? 'Not stated by source' : year}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Applicant
          <select
            value={filters.applicantType ?? ''}
            onChange={(event) =>
              update({
                applicantType: (event.target.value || undefined) as IbQuery['applicantType'],
              })
            }
          >
            <option value="">All applicant categories</option>
            <option value="international">International</option>
            <option value="domestic">Domestic</option>
          </select>
        </label>
        <label>
          Study level
          <select
            value={filters.level}
            onChange={(event) => update({ level: event.target.value as IbQuery['level'] })}
          >
            <option value="undergraduate">Undergraduate / integrated masters</option>
            <option value="graduate">Postgraduate</option>
          </select>
        </label>
        <label>
          Entry route
          <select
            value={filters.entryType}
            onChange={(event) => update({ entryType: event.target.value as IbQuery['entryType'] })}
          >
            <option value="first_year">First year</option>
            <option value="transfer">Transfer</option>
            <option value="readmission">Readmission</option>
            <option value="other">Other</option>
          </select>
        </label>
        <button type="submit" className="primary-button">
          Search programs
        </button>
      </form>
      {query.isPending && <p role="status">Loading program requirements…</p>}
      {query.error && (
        <div role="alert">
          <p>IB requirements could not be loaded. {query.error.message}</p>
          <button type="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      )}
      {data && (
        <>
          <p className="ib-coverage" role="status">
            {data.coverage.programsWithReviewedIb.toLocaleString()} of{' '}
            {data.coverage.catalogPrograms.toLocaleString()} catalog entries have reviewed IB
            records for the selected year, applicant and entry route;{' '}
            {data.coverage.programsWithPublishedTotals.toLocaleString()} have a published total.
            Search does not change these university coverage counts.
          </p>
          <details className="ib-institution" open={data.institutionPolicies.length > 0}>
            <summary>University-wide IB policy ({data.institutionPolicies.length})</summary>
            <p>
              These are general entry rules. Program-specific requirements below must also be
              checked.
            </p>
            {data.institutionPolicies.map((requirement) => (
              <IbRequirementCard key={requirement.recordKey} requirement={requirement} />
            ))}
            {!data.institutionPolicies.length && (
              <p>No university-wide IB policy has been verified for these filters.</p>
            )}
          </details>
          {data.programs.map((program) => (
            <article className="ib-program" key={program.id}>
              <h3>{program.name}</h3>
              <p className="muted">
                {program.field} · {program.level}
                {program.catalogYear && program.catalogYear !== 'unspecified'
                  ? ` · Catalog year ${program.catalogYear}`
                  : ''}
              </p>
              {program.requirements.map((requirement) => (
                <IbRequirementCard key={requirement.recordKey} requirement={requirement} />
              ))}
              {!program.requirements.length && (
                <p className="muted">
                  {program.level === 'graduate'
                    ? 'This is a postgraduate program. Its prior-degree entry requirements have not been verified here.'
                    : 'Program-specific IB requirements have not been verified for these filters. A school-wide score must not be treated as this program’s cutoff.'}
                </p>
              )}
            </article>
          ))}
          {!data.programs.length && (
            <p>
              No catalog programs match these filters. This does not establish that the university
              offers no such programs.
            </p>
          )}
          {data.pagination.totalPages > 1 && (
            <nav className="ib-pagination" aria-label="IB program pages">
              <button
                type="button"
                disabled={filters.page <= 1}
                onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
              >
                Previous
              </button>
              <span>
                Page {filters.page} of {data.pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={filters.page >= data.pagination.totalPages}
                onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
