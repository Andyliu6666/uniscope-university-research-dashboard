import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  MapPin,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { fetchUniversity, fetchUniversityAdmissions } from '../api.js';
import { IbRequirementsSection } from '../components/IbRequirementsSection.js';
import { formatCostAmount, formatCostContext, primaryCost } from '../costs.js';
import { coverageLevelCopy, coverageSourceTierLabel, coverageStatusLabel } from '../coverage.js';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
export function DetailPage() {
  const { slug = '' } = useParams();
  const [admissionsPageState, setAdmissionsPage] = useState({ slug, page: 1 });
  const admissionsPage = admissionsPageState.slug === slug ? admissionsPageState.page : 1;
  const {
    data: university,
    isPending,
    error,
  } = useQuery({ queryKey: ['university', slug], queryFn: () => fetchUniversity(slug) });
  const {
    data: admissions,
    isPending: admissionsPending,
    error: admissionsError,
    refetch: refetchAdmissions,
  } = useQuery({
    queryKey: ['university-admissions', slug, admissionsPage],
    queryFn: () => fetchUniversityAdmissions(slug, { page: admissionsPage, pageSize: 20 }),
    enabled: Boolean(slug),
  });
  const reportedCost = university ? primaryCost(university.costs) : undefined;
  if (isPending) return <div className="page-loading">Loading research profile…</div>;
  if (error || !university)
    return (
      <div className="empty page">
        <h2>Profile not found</h2>
        <Link to="/">Return to explore</Link>
      </div>
    );
  const primaryWebsite = university.officialWebsite ?? university.website;
  const primaryWebsiteIsRegistry = primaryWebsite.startsWith('https://ror.org/');
  const coverageCopy = coverageLevelCopy[university.coverage.level];
  const officialLinks = [
    { label: 'Admissions', url: university.admissionsUrl },
    { label: 'Financial aid', url: university.financialAidUrl },
    { label: 'Net price', url: university.netPriceUrl },
  ]
    .filter((item): item is { label: string; url: string } => Boolean(item.url))
    .filter(
      (item, index, all) =>
        item.url !== primaryWebsite &&
        all.findIndex((candidate) => candidate.url === item.url) === index,
    );
  return (
    <div className="detail-page">
      <Link to="/" className="back">
        <ArrowLeft size={17} /> Back to explore
      </Link>
      <header className="detail-hero">
        <div>
          <p className="eyebrow">
            <MapPin size={14} />
            {university.city}, {university.country}
          </p>
          <h1>{university.name}</h1>
          <p>{university.summary}</p>
          <div className="detail-actions">
            <a className="primary-link" href={primaryWebsite} target="_blank" rel="noreferrer">
              {primaryWebsiteIsRegistry ? 'Open registry profile' : 'Official website'}{' '}
              <ArrowUpRight size={17} />
            </a>
            {officialLinks.map((item) => (
              <a
                className="secondary-link"
                href={item.url}
                target="_blank"
                rel="noreferrer"
                key={item.url}
              >
                {item.label} <ArrowUpRight size={15} />
              </a>
            ))}
          </div>
        </div>
        <div className={`verified-stamp coverage-stamp-${university.coverage.level}`}>
          <CheckCircle2 />
          <strong>{coverageCopy.label}</strong>
          <span>{coverageCopy.detail}</span>
          <small>
            Updated{' '}
            {new Date(university.updatedAt).toLocaleDateString('en-US', {
              month: 'short',
              year: 'numeric',
            })}
          </small>
        </div>
      </header>
      <section className="metric-strip">
        <div>
          <span>Institution</span>
          <strong>{university.institutionType}</strong>
        </div>
        <div>
          <span>Student body</span>
          <strong>{university.studentCount?.toLocaleString() ?? 'Not published'}</strong>
        </div>
        <div>
          <span>Established</span>
          <strong>{university.establishedYear ?? 'Not published'}</strong>
        </div>
        <div>
          <span>
            {reportedCost && university.annualTuitionUsd === null
              ? 'Reported cost'
              : 'Annual tuition'}
          </span>
          <strong>
            {university.annualTuitionUsd !== null
              ? money.format(university.annualTuitionUsd)
              : reportedCost
                ? formatCostAmount(reportedCost)
                : 'Check source'}
          </strong>
          {reportedCost && university.annualTuitionUsd === null && (
            <small className="cost-context" title={formatCostContext(reportedCost)}>
              {formatCostContext(reportedCost)}
            </small>
          )}
        </div>
        <div>
          <span>IB entry requirements</span>
          <strong>
            <a href="#ib-requirements">View by program</a>
          </strong>
        </div>
      </section>
      <InstitutionFactsSection university={university} />
      <ResearchSection profile={university.researchProfile} />
      <AdmissionsSection
        data={admissions}
        pending={admissionsPending}
        failed={Boolean(admissionsError)}
        onRetry={() => {
          void refetchAdmissions();
        }}
        onPageChange={(page) => setAdmissionsPage({ slug, page })}
      />
      <CostsSection data={admissions} pending={admissionsPending} />
      <CoverageSection university={university} />
      <IbRequirementsSection key={slug} slug={slug} />
      <div className="detail-grid">
        <section className="panel">
          <p className="kicker">Programs</p>
          <h2>Areas to explore</h2>
          {university.programs.length > 0 && (
            <p>
              <a href="#ib-requirements">
                Search {university.programs.length.toLocaleString()} catalog entries and their IB
                requirements above ↗
              </a>
            </p>
          )}
          {university.programs.length === 0 && (
            <p className="muted empty-list-copy">
              No verified program catalog has been added for this institution yet.
            </p>
          )}
        </section>
        <section className="panel">
          <p className="kicker">Deadlines</p>
          <h2>Dates on your radar</h2>
          {university.deadlines.map((deadline) => (
            <div className="list-row" key={`${deadline.label}-${deadline.date}`}>
              <CalendarDays />
              <div>
                <strong>{deadline.label}</strong>
                <span>{deadline.applicantType} applicants</span>
              </div>
              <time>
                {new Date(`${deadline.date}T00:00:00`).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </time>
            </div>
          ))}
          {university.deadlines.length === 0 && (
            <p className="muted empty-list-copy">
              No current application deadline has been verified for this institution yet.
            </p>
          )}
        </section>
      </div>
      <section className="sources panel">
        <p className="kicker">Evidence</p>
        <h2>Sources & data dates</h2>
        <p>
          These links are the basis for this profile. Details can change, so confirm before
          applying.
        </p>
        {university.sources.map((source) => (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="source-row"
            key={source.url}
          >
            <div>
              <ExternalLink />
              <span>
                <strong>{source.title}</strong>
                <small>
                  {source.category} · source dated{' '}
                  {new Date(source.verifiedAt).toLocaleDateString()}
                </small>
              </span>
            </div>
            <ArrowUpRight />
          </a>
        ))}
      </section>
    </div>
  );
}

type ResearchProfile = NonNullable<Awaited<ReturnType<typeof fetchUniversity>>['researchProfile']>;

type UniversityProfile = Awaited<ReturnType<typeof fetchUniversity>>;

const continentNames: Record<string, string> = {
  AF: 'Africa',
  AN: 'Antarctica',
  AS: 'Asia',
  EU: 'Europe',
  NA: 'North America',
  OC: 'Oceania',
  SA: 'South America',
};

function InstitutionFactsSection({ university }: { university: UniversityProfile }) {
  const address = [
    university.addressLine,
    university.city,
    university.region,
    university.postalCode,
    university.country,
  ]
    .filter((part, index, all): part is string => Boolean(part && all.indexOf(part) === index))
    .join(', ');
  const levels = [
    university.offersUndergraduate ? 'Undergraduate' : null,
    university.offersGraduate ? 'Graduate' : null,
  ].filter(Boolean);
  const latitude = typeof university.latitude === 'number' ? university.latitude : null;
  const longitude = typeof university.longitude === 'number' ? university.longitude : null;
  const coordinates =
    latitude !== null && longitude !== null
      ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
      : null;
  const mapUrl = coordinates
    ? `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`
    : null;
  const facts = [
    { label: 'Verified location', value: address || 'Not published' },
    {
      label: 'Country / continent',
      value: [
        university.countryCode
          ? `${university.country} (${university.countryCode})`
          : university.country,
        university.continentCode
          ? (continentNames[university.continentCode] ?? university.continentCode)
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    },
    {
      label: 'Ownership',
      value: university.ownership?.replaceAll('_', ' ') ?? 'Not published',
    },
    {
      label: 'Operating status',
      value: university.operatingStatus ?? 'Not published',
    },
    {
      label: 'Study levels',
      value: levels.length > 0 ? levels.join(' and ') : 'Not published',
    },
    {
      label: 'Highest award',
      value: university.highestAwardLevel ?? 'Not published',
    },
    {
      label: 'Academic calendar',
      value: university.academicCalendar ?? 'Not published',
    },
  ];

  return (
    <section className="panel institution-facts-panel">
      <div className="subsection-heading">
        <div>
          <p className="kicker">Institution profile</p>
          <h2>Verified identity and core facts</h2>
          <p className="muted">
            Registry and government facts are kept separate from application requirements. Missing
            values are shown explicitly instead of being guessed.
          </p>
        </div>
        {university.wikipediaUrl && (
          <a
            href={university.wikipediaUrl}
            target="_blank"
            rel="noreferrer"
            className="source-inline"
          >
            Background article <ArrowUpRight size={15} />
          </a>
        )}
      </div>
      <div className="institution-facts-grid">
        {facts.map((fact) => (
          <div className="institution-fact" key={fact.label}>
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
          </div>
        ))}
      </div>
      {(university.phone || mapUrl) && (
        <div className="institution-contact-row">
          {university.phone && <a href={`tel:${university.phone}`}>Phone: {university.phone}</a>}
          {mapUrl && (
            <a href={mapUrl} target="_blank" rel="noreferrer">
              Map coordinates: {coordinates} <ArrowUpRight size={14} />
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function ResearchSection({ profile }: { profile: ResearchProfile | null }) {
  if (!profile) return null;
  const metrics = [
    { label: 'Works associated', value: profile.worksCount.toLocaleString() },
    { label: 'Citations received', value: profile.citedByCount.toLocaleString() },
    { label: 'h-index', value: profile.hIndex.toLocaleString() },
    { label: 'i10-index', value: profile.i10Index.toLocaleString() },
    {
      label: '2-year mean citedness',
      value:
        profile.twoYearMeanCitedness === null
          ? 'Not reported'
          : profile.twoYearMeanCitedness.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            }),
    },
  ];
  return (
    <section className="panel research-panel">
      <div className="subsection-heading">
        <div>
          <p className="kicker">Independent research context</p>
          <h2>OpenAlex research activity</h2>
          <p className="muted">
            Bibliometric totals currently associated with this institution by OpenAlex. They are not
            a university ranking, a measure of teaching quality, or admissions information.
          </p>
        </div>
        <a href={profile.profileUrl} target="_blank" rel="noreferrer" className="source-inline">
          View OpenAlex record <ArrowUpRight size={15} />
        </a>
      </div>
      <div className="research-metrics-grid">
        {metrics.map((metric) => (
          <div className="research-metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>
      <p className="research-note">
        OpenAlex status: {profile.status}. Source updated{' '}
        {new Date(profile.sourceUpdatedAt).toLocaleDateString()}. Counts depend on OpenAlex's work
        and affiliation metadata and can change as records are corrected.
      </p>
    </section>
  );
}

export function AdmissionsSection({
  data,
  pending,
  failed = false,
  onPageChange,
  onRetry,
}: {
  data: Awaited<ReturnType<typeof fetchUniversityAdmissions>> | undefined;
  pending: boolean;
  failed?: boolean;
  onPageChange?: (page: number) => void;
  onRetry?: () => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  // IB-only profiles retain their dedicated programme browser below.
  const profiles =
    data?.profiles
      .filter(
        (item) =>
          item.counts.length > 0 || item.requirements.length > 0 || item.testScores.length > 0,
      )
      .sort((a, b) => {
        const priority = (item: typeof a) =>
          (item.programId ? 20 : 0) +
          (item.entryType === 'first_year' ? 0 : 10) +
          (item.level === 'undergraduate'
            ? 0
            : item.level === 'all'
              ? 1
              : item.level === 'graduate'
                ? 2
                : 3);
        return (
          priority(a) - priority(b) ||
          b.academicYear.localeCompare(a.academicYear) ||
          a.id.localeCompare(b.id)
        );
      }) ?? [];
  const profile = profiles.find((item) => item.id === selectedId) ?? profiles[0];
  const pagination = data && onPageChange && data.pagination.totalPages > 1 && (
    <nav className="pagination" aria-label="Admissions pages">
      <button
        type="button"
        disabled={data.pagination.page <= 1}
        onClick={() => onPageChange(data.pagination.page - 1)}
      >
        Previous admissions page
      </button>
      <span>
        Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total}{' '}
        profiles including IB-only scopes
      </span>
      <button
        type="button"
        disabled={data.pagination.page >= data.pagination.totalPages}
        onClick={() => onPageChange(data.pagination.page + 1)}
      >
        Next admissions page
      </button>
    </nav>
  );
  if (pending)
    return (
      <section className="panel admissions-panel">
        <p className="kicker">Admissions</p>
        <h2>Loading official admissions data…</h2>
      </section>
    );
  if (failed)
    return (
      <section className="panel admissions-panel" id="admissions-requirements">
        <p className="kicker">Admissions</p>
        <h2>Admissions data could not be loaded</h2>
        <p role="alert">
          Check your connection and reload. This error does not mean the school has no requirements.
        </p>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            Retry admissions request
          </button>
        )}
      </section>
    );
  if (!data)
    return (
      <section className="panel admissions-panel" id="admissions-requirements">
        <p className="kicker">Admissions</p>
        <h2>Admissions data</h2>
        <p className="muted">Not yet researched or not reported by the selected official source.</p>
      </section>
    );

  if (!profile)
    return (
      <section className="panel admissions-panel">
        <p className="kicker">Research data</p>
        <h2>Admissions data</h2>
        <p className="muted">
          General admissions requirements and statistics have not been verified on this page. IB
          requirements are shown in their own section below; enrollment details are shown when
          available.
        </p>
        {pagination}
        <EnrollmentSection rows={data.enrollment} source={findEnrollmentSource(data.sources)} />
      </section>
    );

  const total = new Map(
    profile.counts
      .filter((item) => item.population === 'all')
      .map((item) => [item.metric, item.value]),
  );
  const applicants = total.get('applicants');
  const admitted = total.get('admitted');
  const enrolled = total.get('enrolled');
  const acceptanceRate =
    applicants && applicants > 0 && admitted !== undefined
      ? `${((admitted / applicants) * 100).toFixed(1)}%`
      : 'Not reported';
  const yieldRate =
    admitted && admitted > 0 && enrolled !== undefined
      ? `${((enrolled / admitted) * 100).toFixed(1)}%`
      : 'Not reported';
  return (
    <section className="panel admissions-panel" id="admissions-requirements">
      <p className="kicker">Admissions · {profile.academicYear}</p>
      <h2>Admissions requirements & application</h2>
      <p className="muted">
        {profiles.length} general admission scopes on this page. Select a scope to view its
        requirements; this count does not mean the institution is fully researched.
      </p>
      {pagination}
      <label htmlFor="admissions-scope">Choose admission scope</label>
      <select
        id="admissions-scope"
        value={profile.id}
        onChange={(event) => setSelectedId(event.target.value)}
      >
        {profiles.map((item) => (
          <option key={item.id} value={item.id}>
            {item.programId ? (item.programName ?? 'Programme-specific') : 'University-wide'} ·{' '}
            {item.level.replaceAll('_', ' ')} ·{' '}
            {item.academicYear === 'unspecified' ? 'Year not specified' : item.academicYear} ·{' '}
            {item.intakeTerm} intake · {item.entryType.replaceAll('_', ' ')} ·{' '}
            {item.applicantType === 'all' ? 'All applicants' : item.applicantType}
          </option>
        ))}
      </select>
      <p className="muted">
        {profile.programId
          ? 'Programme-specific requirements.'
          : 'Shared university requirements are recorded once, not copied to every programme.'}{' '}
        Only the selected year, applicant group and entry route are shown. Undated information is
        not a confirmed current-year offer.
      </p>
      {profile.notes && <p className="muted">{profile.notes}</p>}
      {profile.applicationUrl && (
        <a href={profile.applicationUrl} target="_blank" rel="noreferrer">
          Official application page ↗
        </a>
      )}
      {profile.counts.length > 0 && (
        <div className="admissions-grid">
          <AdmissionMetric
            label="Applicants"
            value={applicants?.toLocaleString() ?? 'Not reported'}
          />
          <AdmissionMetric label="Admitted" value={admitted?.toLocaleString() ?? 'Not reported'} />
          <AdmissionMetric label="Enrolled" value={enrolled?.toLocaleString() ?? 'Not reported'} />
          <AdmissionMetric label="Acceptance rate" value={acceptanceRate} />
          <AdmissionMetric label="Yield rate" value={yieldRate} />
        </div>
      )}
      <EnrollmentSection rows={data.enrollment} source={findEnrollmentSource(data.sources)} />
      {profile.testScores.length > 0 && (
        <div className="admissions-subsection">
          <h3>Standardized test profile</h3>
          {profile.testScores.map((score) => (
            <div className="list-row" key={`${score.testName}-${score.section}-${score.context}`}>
              <div>
                <strong>
                  {score.testName} · {score.section}
                </strong>
                <span>
                  {score.percentile25 !== null && score.percentile75 !== null
                    ? `25th–75th percentile: ${score.percentile25}–${score.percentile75}`
                    : 'Percentile range not reported'}
                </span>
              </div>
              <span className="country-pill">
                {score.submittersPercent !== null
                  ? `${score.submittersPercent}% submitted`
                  : 'Submission rate n/a'}
              </span>
            </div>
          ))}
        </div>
      )}
      {profile.requirements.length > 0 && (
        <div className="admissions-subsection">
          <h3>Requirements and selection policies</h3>
          {profile.requirements.map((requirement) => (
            <div className="list-row" key={`${requirement.category}-${requirement.requirementKey}`}>
              <div>
                <strong>{requirement.label}</strong>
                <span>{requirement.details ?? 'Official consideration policy'}</span>
                <a
                  href={(requirement.source ?? profile.source).url}
                  target="_blank"
                  rel="noreferrer"
                  className="source-inline"
                >
                  {(requirement.source ?? profile.source).title} · checked{' '}
                  {requirement.verifiedAt.slice(0, 10)} ↗
                </a>
              </div>
              <span className="country-pill">{requirement.status.replaceAll('_', ' ')}</span>
            </div>
          ))}
        </div>
      )}
      <a href={profile.source.url} target="_blank" rel="noreferrer" className="source-inline">
        Verify this dataset at {profile.source.publisher ?? profile.source.title}{' '}
        <ArrowUpRight size={15} />
      </a>
    </section>
  );
}

function CostsSection({
  data,
  pending,
}: {
  data: Awaited<ReturnType<typeof fetchUniversityAdmissions>> | undefined;
  pending: boolean;
}) {
  if (pending || !data?.costs.length) return null;
  const visibleCosts = data.costs.slice(0, 12);
  return (
    <section className="panel costs-panel">
      <div className="subsection-heading">
        <div>
          <p className="kicker">Costs</p>
          <h2>Reported cost snapshots</h2>
          <p className="muted">
            Official values are shown without currency conversion or combining separate scenarios.
            Each row keeps its level, residency, period, scenario, and academic year.
          </p>
        </div>
        <span className="country-pill">{data.costs.length} facts</span>
      </div>
      <div className="cost-list">
        {visibleCosts.map((cost) => (
          <div
            className="list-row cost-row"
            key={`${cost.level}-${cost.residency}-${cost.category}-${cost.period}-${cost.scenario}-${cost.source.url}`}
          >
            <div>
              <strong>{formatCostAmount(cost)}</strong>
              <span>{formatCostContext(cost)}</span>
            </div>
            <a
              href={cost.source.url}
              target="_blank"
              rel="noreferrer"
              className="cost-source"
              title={`Verify ${cost.source.title}`}
            >
              Verify <ArrowUpRight size={14} />
            </a>
          </div>
        ))}
      </div>
      {data.costs.length > visibleCosts.length && (
        <p className="muted costs-more">
          Showing the first {visibleCosts.length} of {data.costs.length} reported facts. Use the
          source links above to review the complete official dataset.
        </p>
      )}
    </section>
  );
}

type EnrollmentRow = Awaited<ReturnType<typeof fetchUniversityAdmissions>>['enrollment'][number];
type EnrollmentSource = Awaited<ReturnType<typeof fetchUniversityAdmissions>>['sources'][number];

const findEnrollmentSource = (sources: EnrollmentSource[]) =>
  sources.find((source) => source.datasetVersion?.toUpperCase() === 'EF2024A');

const enrollmentSummaryRows: Array<{
  key: string;
  label: string;
  match: (row: EnrollmentRow) => boolean;
}> = [
  {
    key: 'all-students',
    label: 'All students',
    match: (row) => row.population === 'total',
  },
  {
    key: 'undergraduate',
    label: 'Undergraduate',
    match: (row) => row.population === 'undergraduate',
  },
  {
    key: 'graduate',
    label: 'Graduate',
    match: (row) => row.population === 'graduate',
  },
  {
    key: 'full-time',
    label: 'Full-time students',
    match: (row) => row.population === 'full_time_total',
  },
  {
    key: 'part-time',
    label: 'Part-time students',
    match: (row) => row.population === 'part_time_total',
  },
  {
    key: 'full-time-undergraduate',
    label: 'Full-time undergraduate',
    match: (row) => row.population === 'full_time_undergraduate',
  },
  {
    key: 'part-time-undergraduate',
    label: 'Part-time undergraduate',
    match: (row) => row.population === 'part_time_undergraduate',
  },
  {
    key: 'full-time-graduate',
    label: 'Full-time graduate',
    match: (row) => row.population === 'full_time_graduate',
  },
  {
    key: 'part-time-graduate',
    label: 'Part-time graduate',
    match: (row) => row.population === 'part_time_graduate',
  },
];

function EnrollmentSection({
  rows,
  source,
}: {
  rows: EnrollmentRow[];
  source: EnrollmentSource | undefined;
}) {
  const academicYears = [...new Set(rows.map((row) => row.academicYear))].sort((a, b) =>
    b.localeCompare(a),
  );
  const academicYear = academicYears[0];
  const yearRows = academicYear ? rows.filter((row) => row.academicYear === academicYear) : [];
  const summaries = enrollmentSummaryRows.flatMap(({ key, label, match }) => {
    const row = yearRows.find(match);
    return row ? [{ key, label, row }] : [];
  });
  if (summaries.length === 0) return null;

  return (
    <div className="admissions-subsection enrollment-section">
      <div className="subsection-heading">
        <div>
          <h3>Fall enrollment snapshot</h3>
          <p className="muted">
            {academicYear ? `Academic year ${academicYear}. ` : ''}
            Counts are shown exactly as reported by the official source.
          </p>
        </div>
        {source && (
          <a href={source.url} target="_blank" rel="noreferrer" className="source-inline">
            Verify source <ArrowUpRight size={15} />
          </a>
        )}
      </div>
      <div className="enrollment-table-wrap">
        <table className="enrollment-table">
          <thead>
            <tr>
              <th scope="col">Population</th>
              <th scope="col">Attendance</th>
              <th scope="col">Students</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map(({ key, label, row }) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>{formatAttendance(row.attendanceStatus)}</td>
                <td>{row.studentCount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="enrollment-note">
        Note: these official categories overlap. Undergraduate, graduate, full-time, and part-time
        figures are separate reported views—not values to add together.
      </p>
    </div>
  );
}

const formatAttendance = (status: EnrollmentRow['attendanceStatus']) => {
  if (status === 'full_time') return 'Full-time';
  if (status === 'part_time') return 'Part-time';
  return 'All attendance statuses';
};

function AdmissionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="admission-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CoverageSection({
  university,
}: {
  university: Awaited<ReturnType<typeof fetchUniversity>>;
}) {
  const dimensions = university.coverage.dimensions;
  const rows = [
    {
      label: 'Identity & location',
      dimension: dimensions.identity,
    },
    {
      label: 'Core institution facts',
      dimension: dimensions.core,
    },
    {
      label: 'Programs',
      dimension: dimensions.programs,
    },
    {
      label: 'Admissions & requirements',
      dimension: dimensions.admissions,
    },
    {
      label: 'Deadlines',
      dimension: dimensions.deadlines,
    },
    {
      label: 'Enrollment',
      dimension: dimensions.enrollment,
    },
    {
      label: 'Costs',
      dimension: dimensions.costs,
    },
    {
      label: 'Financial aid',
      dimension: dimensions.financialAid,
    },
  ];
  return (
    <section className="panel coverage-panel">
      <div className="subsection-heading">
        <div>
          <p className="kicker">Data coverage</p>
          <h2>What is verified for this profile</h2>
        </div>
        <Link className="source-inline" to="/contribute">
          Add official details <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="coverage-grid">
        {rows.map((row) => (
          <div className="coverage-item" key={row.label}>
            <span>{row.label}</span>
            <strong className={`coverage-status-${row.dimension.status}`}>
              {coverageStatusLabel[row.dimension.status]}
            </strong>
            <small>
              {row.dimension.factCount} structured fact
              {row.dimension.factCount === 1 ? '' : 's'}
            </small>
            <small>{coverageSourceTierLabel[row.dimension.sourceTier]}</small>
          </div>
        ))}
      </div>
      <p className="muted coverage-note">
        ROR and Wikidata can verify an institution's identity, but identity evidence alone is never
        counted as a complete profile. “Verified” dimensions require structured facts linked to a
        current official institution or government source.
      </p>
    </section>
  );
}
