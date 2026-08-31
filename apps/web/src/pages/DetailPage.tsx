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
          <span>Annual tuition</span>
          <strong>
            {university.annualTuitionUsd
              ? money.format(university.annualTuitionUsd)
              : 'Check source'}
          </strong>
        </div>
        <div>
          <span>Typical IB minimum</span>
          <strong>{university.ibTypicalMin ?? 'Varies'}</strong>
        </div>
        <div>
          <span>Student body</span>
          <strong>{university.studentCount?.toLocaleString() ?? 'Not published'}</strong>
        </div>
      </section>
      <AdmissionsSection data={admissions} pending={admissionsPending} />
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
  const profile = data?.profiles[0];
  if (!data || !profile)
    return (
      <section className="panel admissions-panel">
        <p className="kicker">Admissions</p>
        <h2>Admissions data</h2>
        <p className="muted">Not yet researched or not reported by the selected official source.</p>
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
      {data.costs.length > 0 && (
        <div className="admissions-subsection">
          <h3>Reported costs</h3>
          {data.costs.slice(0, 6).map((cost) => (
            <div
              className="list-row"
              key={`${cost.category}-${cost.residency}-${cost.period}-${cost.scenario}`}
            >
              <div>
                <strong>{cost.category.replaceAll('_', ' ')}</strong>
                <span>
                  {cost.residency.replaceAll('_', ' ')} · {cost.scenario.replaceAll('_', ' ')} ·{' '}
                  {cost.academicYear}
                </span>
              </div>
              <span className="country-pill">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: cost.currency,
                  maximumFractionDigits: 0,
                }).format(cost.amount)}
              </span>
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

function AdmissionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="admission-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
