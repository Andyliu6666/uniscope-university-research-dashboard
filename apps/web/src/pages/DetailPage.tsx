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
import { fetchUniversity } from '../api.js';

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
            Official website <ArrowUpRight size={17} />
          </a>
        </div>
        <div className="verified-stamp">
          <CheckCircle2 />
          <strong>Source checked</strong>
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
        <h2>Sources & verification</h2>
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
                  {source.category} · checked {new Date(source.verifiedAt).toLocaleDateString()}
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
