import { useQuery } from '@tanstack/react-query';
import { Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchUniversities } from '../api.js';
import { UniversityCard } from '../components/UniversityCard.js';
import { useComparison } from '../store.js';

export function ExplorePage() {
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const comparison = useComparison();
  const query = {
    q,
    country: country || undefined,
    type: (type as 'public' | 'private') || undefined,
    page,
    pageSize: 6,
  };
  const { data, isPending, error } = useQuery({
    queryKey: ['universities', query],
    queryFn: () => fetchUniversities(query),
  });
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">
            <Sparkles size={15} /> Student-built. Source-first.
          </p>
          <h1>
            Find a university that fits <em>your</em> future.
          </h1>
          <p>
            Research admissions, costs, programs, and deadlines in one calm workspace. Every profile
            shows when and where its facts were checked.
          </p>
          <div className="hero-search">
            <Search size={20} />
            <input
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setPage(1);
              }}
              placeholder="Search by university, city, or country"
              aria-label="Search universities"
            />
          </div>
          <div className="trust-row">
            <span>Official sources prioritized</span>
            <span>•</span>
            <span>Data, not rankings</span>
            <span>•</span>
            <span>Free and open source</span>
          </div>
        </div>
        <div className="hero-aside">
          <p className="mini-label">Your research flow</p>
          <ol>
            <li>
              <strong>01</strong> Discover options
            </li>
            <li>
              <strong>02</strong> Verify the details
            </li>
            <li>
              <strong>03</strong> Compare what matters
            </li>
          </ol>
        </div>
      </section>
      <section className="explore">
        <div className="section-heading">
          <div>
            <p className="kicker">Explore the database</p>
            <h2>Universities, clearly compared</h2>
          </div>
          <p>{data?.pagination.total ?? '—'} verified profiles</p>
        </div>
        <div className="filters">
          <SlidersHorizontal size={18} />
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setPage(1);
            }}
            aria-label="Country"
          >
            <option value="">All countries</option>
            {data?.countries.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
            aria-label="Institution type"
          >
            <option value="">Public & private</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setQ('');
              setCountry('');
              setType('');
              setPage(1);
            }}
          >
            Reset
          </button>
        </div>
        {error ? (
          <div className="notice error">
            Could not reach the research database. Check that the API and database are running.
          </div>
        ) : null}
        {isPending ? (
          <div className="card-grid">
            {[1, 2, 3].map((item) => (
              <div className="uni-card skeleton" key={item} />
            ))}
          </div>
        ) : data?.items.length ? (
          <div className="card-grid">
            {data.items.map((item) => (
              <UniversityCard
                key={item.id}
                university={item}
                compared={comparison.slugs.includes(item.slug)}
                onCompare={() => comparison.toggle(item.slug)}
              />
            ))}
          </div>
        ) : (
          <div className="empty">
            <h3>No matching universities</h3>
            <p>Try a broader search or clear the filters.</p>
          </div>
        )}
        {data && data.pagination.totalPages > 1 ? (
          <div className="pagination">
            <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {data.pagination.totalPages}
            </span>
            <button
              type="button"
              disabled={page === data.pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </section>
      {comparison.slugs.length > 0 ? (
        <aside className="compare-tray">
          <div>
            <strong>{comparison.slugs.length}/3 selected</strong>
            <span>Add up to three universities</span>
          </div>
          <Link to="/compare">Compare now</Link>
        </aside>
      ) : null}
    </>
  );
}
