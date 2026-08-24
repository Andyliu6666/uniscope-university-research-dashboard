import { useState, type FormEvent } from 'react';
import { CheckCircle2, Code2, FileJson, GitPullRequest } from 'lucide-react';
import { universityInputSchema } from '@urd/shared';
import { saveUniversity } from '../api.js';

const sample = `{
  "name": "Example University",
  "slug": "example-university",
  "country": "Canada",
  "city": "Toronto",
  "website": "https://example.edu",
  "summary": "A factual overview of at least forty characters.",
  "institutionType": "public",
  "studentCount": null,
  "acceptanceRate": null,
  "annualTuitionUsd": null,
  "ibTypicalMin": null,
  "featured": false,
  "programs": [],
  "deadlines": [],
  "sources": [{
    "title": "Official admissions page",
    "url": "https://example.edu/admissions",
    "category": "official",
    "verifiedAt": "2026-01-15T00:00:00.000Z"
  }]
}`;

export function ContributePage() {
  const [json, setJson] = useState(sample);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    try {
      const parsed = universityInputSchema.parse(JSON.parse(json));
      const result = await saveUniversity(parsed, key);
      setStatus(`Saved ${result.slug}. The profile is now available.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save the profile.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="contribute-page">
      <header>
        <p className="kicker">Open contribution</p>
        <h1>Better research is a group project.</h1>
        <p>
          Join for one correction or stay for a semester. The data model keeps contributions small,
          reviewable, and independent of the site’s code.
        </p>
      </header>
      <div className="steps">
        <div>
          <FileJson />
          <strong>1. Add the facts</strong>
          <span>Copy the example data file and fill one university record.</span>
        </div>
        <div>
          <CheckCircle2 />
          <strong>2. Cite official sources</strong>
          <span>Every profile needs at least one current HTTPS source.</span>
        </div>
        <div>
          <GitPullRequest />
          <strong>3. Open a review</strong>
          <span>A maintainer checks the evidence and imports the record.</span>
        </div>
      </div>
      <section className="contribute-grid">
        <div className="panel">
          <Code2 />
          <p className="kicker">Recommended workflow</p>
          <h2>Contribute through GitHub</h2>
          <p>
            Edit <code>data/universities.example.json</code>, run the documented validation and
            import step, then open a pull request. No React or API changes are needed.
          </p>
          <ul>
            <li>Use official admissions and tuition pages.</li>
            <li>
              Use <code>null</code> when a number is not reliably published.
            </li>
            <li>Include the date each source was checked.</li>
            <li>Do not copy ranking claims into summaries.</li>
          </ul>
        </div>
        <form className="panel admin-form" onSubmit={submit}>
          <p className="kicker">Maintainers only</p>
          <h2>Development data entry</h2>
          <p>
            This form writes through the protected API. Keep it disabled from the public internet
            unless real authentication is added.
          </p>
          <label>
            University JSON
            <textarea
              rows={18}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              spellCheck="false"
            />
          </label>
          <label>
            Admin key
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} required />
          </label>
          <button type="submit" className="primary-link" disabled={busy}>
            {busy ? 'Validating…' : 'Validate & save'}
          </button>
          {status ? (
            <p className="form-status" role="status">
              {status}
            </p>
          ) : null}
        </form>
      </section>
    </div>
  );
}
