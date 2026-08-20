import { ArrowUpRight, MapPin, Scale } from 'lucide-react';
import type { University } from '@urd/shared';
import { Link } from 'react-router-dom';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
export function UniversityCard({
  university,
  compared,
  onCompare,
}: {
  university: University;
  compared: boolean;
  onCompare: () => void;
}) {
  return (
    <article className="uni-card">
      <div className="card-top">
        <span className="country-pill">{university.country}</span>
        <button
          className={compared ? 'compare-button selected' : 'compare-button'}
          onClick={onCompare}
          aria-pressed={compared}
        >
          <Scale size={15} />
          {compared ? 'Added' : 'Compare'}
        </button>
      </div>
      <div>
        <p className="eyebrow">
          <MapPin size={14} />
          {university.city} · {university.institutionType}
        </p>
        <h2>{university.name}</h2>
        <p className="summary">{university.summary}</p>
      </div>
      <dl className="quick-stats">
        <div>
          <dt>Tuition / yr</dt>
          <dd>
            {university.annualTuitionUsd
              ? money.format(university.annualTuitionUsd)
              : 'Check source'}
          </dd>
        </div>
        <div>
          <dt>Typical IB</dt>
          <dd>{university.ibTypicalMin ?? 'Varies'}</dd>
        </div>
        <div>
          <dt>Programs</dt>
          <dd>{university.programs.length}</dd>
        </div>
      </dl>
      <Link className="card-link" to={`/universities/${university.slug}`}>
        View research profile <ArrowUpRight size={17} />
      </Link>
    </article>
  );
}
