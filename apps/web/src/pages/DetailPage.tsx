import { useQuery } from '@tanstack/react-query';
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
import { formatCostAmount, formatCostContext, primaryCost } from '../costs.js';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
export function DetailPage() {
  const { slug = '' } = useParams();
  const {
    data: university,
    isPending,
    error,
  } = useQuery({ queryKey: ['university', slug], queryFn: () => fetchUniversity(slug) });
  const { data: admissions, isPending: admissionsPending } = useQuery({
    queryKey: ['university-admissions', slug],
    queryFn: () => fetchUniversityAdmissions(slug),
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
          <a className="primary-link" href={university.website} target="_blank" rel="noreferrer">
            {university.website.startsWith('https://ror.org/')
              ? 'Open registry profile'
              : 'Official website'}{' '}
            <ArrowUpRight size={17} />
          </a>
        </div>
        <div className="verified-stamp">
          <CheckCircle2 />
          <strong>Source-backed profile</strong>
          <span>
            {new Date(university.updatedAt).toLocaleDateString('en-US', {
              month: 'short',
              year: 'numeric',
            })}
          </span>
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
          <span>Typical IB minimum</span>
          <strong>{university.ibTypicalMin ?? 'Varies'}</strong>
        </div>
      </section>
      <AdmissionsSection data={admissions} pending={admissionsPending} />
      <CostsSection data={admissions} pending={admissionsPending} />
      <CoverageSection university={university} data={admissions} pending={admissionsPending} />
      <div className="detail-grid">
        <section className="panel">
          <p className="kicker">Programs</p>
          <h2>Areas to explore</h2>
          {university.programs.map((program) => (
            <div className="list-row" key={`${program.name}-${program.level}`}>
              <div>
                <strong>{program.name}</strong>
                <span>{program.field}</span>
              </div>
              <span className="country-pill">{program.level}</span>
            </div>
          ))}
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

function AdmissionsSection({
  data,
  pending,
}: {
  data: Awaited<ReturnType<typeof fetchUniversityAdmissions>> | undefined;
  pending: boolean;
}) {
  if (pending)
    return (
      <section className="panel admissions-panel">
        <p className="kicker">Admissions</p>
        <h2>Loading official admissions data…</h2>
      </section>
    );
  if (!data)
    return (
      <section className="panel admissions-panel">
        <p className="kicker">Admissions</p>
        <h2>Admissions data</h2>
        <p className="muted">Not yet researched or not reported by the selected official source.</p>
      </section>
    );

  const profile = data.profiles[0];
  if (!profile)
    return (
      <section className="panel admissions-panel">
        <p className="kicker">Research data</p>
        <h2>Admissions data</h2>
        <p className="muted">
          A first-year admissions profile is not reported for this institution. Enrollment details
          are shown below when available.
        </p>
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
    <section className="panel admissions-panel">
      <p className="kicker">Admissions · {profile.academicYear}</p>
      <h2>First-year undergraduate admissions</h2>
      <p className="muted">
        {profile.openAdmission === false
          ? 'Official IPEDS data for first-time, degree/certificate-seeking undergraduates at a non-open-admission institution.'
          : 'Official source-backed admissions profile.'}
      </p>
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
          <h3>Admission considerations</h3>
          {profile.requirements.map((requirement) => (
            <div className="list-row" key={`${requirement.category}-${requirement.requirementKey}`}>
              <div>
                <strong>{requirement.label}</strong>
                <span>{requirement.details ?? 'Official consideration policy'}</span>
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
  data,
  pending,
}: {
  university: Awaited<ReturnType<typeof fetchUniversity>>;
  data: Awaited<ReturnType<typeof fetchUniversityAdmissions>> | undefined;
  pending: boolean;
}) {
  const requirementCount =
    data?.profiles.reduce(
      (total, profile) => total + profile.requirements.length + profile.qualifications.length,
      0,
    ) ?? 0;
  const enrollmentYears = new Set(data?.enrollment.map((row) => row.academicYear)).size;
  const rows = [
    {
      label: 'Identity & location',
      value: `${university.sources.length} source${university.sources.length === 1 ? '' : 's'}`,
    },
    {
      label: 'Admissions profiles',
      value: pending
        ? 'Loading…'
        : data?.profiles.length
          ? `${data.profiles.length} official profile${data.profiles.length === 1 ? '' : 's'}`
          : 'Not reported',
    },
    {
      label: 'Requirements & qualifications',
      value: pending ? 'Loading…' : requirementCount ? String(requirementCount) : 'Not reported',
    },
    {
      label: 'Enrollment',
      value: pending
        ? 'Loading…'
        : data?.enrollment.length
          ? `${data.enrollment.length} views · ${enrollmentYears} year${enrollmentYears === 1 ? '' : 's'}`
          : 'Not reported',
    },
    {
      label: 'Costs',
      value: pending
        ? 'Loading…'
        : data?.costs.length
          ? `${data.costs.length} reported facts`
          : 'Not reported',
    },
    { label: 'Programs listed', value: String(university.programs.length) },
    { label: 'Deadlines listed', value: String(university.deadlines.length) },
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
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
      <p className="muted coverage-note">
        ROR and Wikidata establish an identity, but they do not publish application requirements or
        tuition. Missing fields stay empty until a contributor adds a current official source.
      </p>
    </section>
  );
}
