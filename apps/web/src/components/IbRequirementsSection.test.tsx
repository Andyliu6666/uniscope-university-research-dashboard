// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { IbQuery, IbRequirement, UniversityIbResponse } from '@urd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUniversityIb } from '../api.js';
import { IbRequirementCard, IbRequirementsSection } from './IbRequirementsSection.js';

vi.mock('../api.js', () => ({ fetchUniversityIb: vi.fn() }));

const fetchIb = vi.mocked(fetchUniversityIb);
const clients: QueryClient[] = [];

const requirement = (overrides: Partial<IbRequirement> = {}): IbRequirement => ({
  recordKey: 'computing-2027-standard',
  academicYear: '2027',
  intakeTerm: 'September',
  entryType: 'first_year',
  applicantType: 'all',
  applicantContext: 'Standard first-year applicants',
  status: 'published',
  scoreKind: 'typical_offer',
  totalMin: 28,
  totalMax: 30,
  scoreScale: 45,
  includesCorePoints: true,
  hlGrades: [6, 5, 5],
  subjectNotes: 'Higher Level Mathematics at grade 5 is required.',
  conditions: 'An offer also depends on meeting the published subject requirements.',
  source: {
    title: 'Official computing entry requirements',
    url: 'https://university.example/courses/computing',
    checkedOn: '2026-09-10',
    evidence: 'Typical offer: 28 to 30 points.',
  },
  ...overrides,
});

const response = (overrides: Partial<UniversityIbResponse> = {}): UniversityIbResponse => ({
  university: { id: 'institution-1', name: 'Test University', slug: 'test-university' },
  institutionPolicies: [],
  programs: [
    {
      id: 'program-1',
      name: 'Computer Science',
      field: 'Computing',
      level: 'undergraduate',
      catalogYear: '2027',
      requirements: [requirement()],
    },
  ],
  years: ['2027', '2026', 'unspecified'],
  pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  coverage: { catalogPrograms: 1, programsWithReviewedIb: 1, programsWithPublishedTotals: 1 },
  ...overrides,
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <IbRequirementsSection slug="test-university" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchIb.mockReset();
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

describe('IbRequirementCard', () => {
  it('distinguishes a typical offer range from a minimum and retains its conditions and evidence link', () => {
    render(<IbRequirementCard requirement={requirement()} />);
    expect(screen.getByText('28–30/45 · Typical offer')).toBeInTheDocument();
    expect(screen.queryByText(/Minimum entry requirement/u)).not.toBeInTheDocument();
    expect(
      screen.getByText(/2027 entry · September · Standard first-year applicants/u),
    ).toBeInTheDocument();
    expect(screen.getByText('Higher Level grades: 6, 5, 5')).toBeInTheDocument();
    expect(
      screen.getByText('Higher Level Mathematics at grade 5 is required.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Total includes core points.')).toBeInTheDocument();
    expect(screen.getByText(/An offer also depends/u)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Official requirement · checked 2026-09-10/u });
    expect(link).toHaveAttribute('href', 'https://university.example/courses/computing');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('does not turn an unstated total or year into a zero-point cutoff or current entry year', () => {
    render(
      <IbRequirementCard
        requirement={requirement({
          academicYear: 'unspecified',
          intakeTerm: 'unspecified',
          status: 'not_stated_in_source',
          totalMin: null,
          totalMax: null,
          scoreScale: null,
          scoreKind: null,
          includesCorePoints: null,
          hlGrades: [],
        })}
      />,
    );
    expect(screen.getByText('IB total not stated in the reviewed source')).toBeInTheDocument();
    expect(
      screen.getByText(/Entry year not stated by source · Term not specified/u),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0\/45|2027 entry|Higher Level grades/u)).not.toBeInTheDocument();
  });

  it('keeps contextual offer eligibility distinct from a general minimum', () => {
    render(
      <IbRequirementCard
        requirement={requirement({
          scoreKind: 'contextual_offer',
          totalMin: 26,
          totalMax: null,
          applicantContext:
            'Eligible applicants in the published contextual admissions scheme only',
        })}
      />,
    );
    expect(
      screen.getByText('26/45 · Contextual offer — eligibility conditions apply'),
    ).toBeInTheDocument();
    expect(screen.getByText(/published contextual admissions scheme only/u)).toBeInTheDocument();
    expect(screen.queryByText(/Minimum entry requirement/u)).not.toBeInTheDocument();
  });
});

describe('IbRequirementsSection', () => {
  it('announces loading without claiming that records are missing', () => {
    fetchIb.mockImplementation(() => new Promise<UniversityIbResponse>(() => {}));
    renderSection();
    expect(screen.getByRole('status')).toHaveTextContent('Loading program requirements…');
    expect(screen.queryByText(/No catalog programs/u)).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Find the requirements for your course' }),
    ).toBeInTheDocument();
  });

  it('shows a fetch failure separately from missing data and retries successfully', async () => {
    fetchIb
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce(response());
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.queryByText(/No catalog programs/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Computer Science' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchIb).toHaveBeenCalledTimes(2);
  });

  it('describes empty catalog results as unknown coverage, not proof that programs do not exist', async () => {
    fetchIb.mockResolvedValue(
      response({
        programs: [],
        years: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        coverage: { catalogPrograms: 0, programsWithReviewedIb: 0, programsWithPublishedTotals: 0 },
      }),
    );
    renderSection();
    expect(
      await screen.findByText(
        /This does not establish that the university offers no such programs/u,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No university-wide IB policy has been verified for these filters.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 of 0 catalog entries');
    expect(screen.queryByRole('navigation', { name: 'IB program pages' })).not.toBeInTheDocument();
  });

  it('does not inherit an institution-wide minimum into an unreviewed program', async () => {
    const data = response();
    data.institutionPolicies = [
      requirement({
        recordKey: 'institution-policy',
        totalMin: 24,
        totalMax: null,
        scoreKind: 'minimum_entry',
      }),
    ];
    data.programs = data.programs.map((program) => ({ ...program, requirements: [] }));
    data.coverage.programsWithReviewedIb = 0;
    data.coverage.programsWithPublishedTotals = 0;
    fetchIb.mockResolvedValue(data);
    renderSection();
    const program = await screen.findByRole('article');
    expect(screen.getByText('24/45 · Minimum entry requirement')).toBeInTheDocument();
    expect(within(program).queryByText(/24\/45/u)).not.toBeInTheDocument();
    expect(
      within(program).getByText(
        /A school-wide score must not be treated as this program’s cutoff/u,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 of 1 catalog entries');
  });

  it('sends entry year, applicant, route and level filters without dropping their scope', async () => {
    fetchIb.mockResolvedValue(response());
    renderSection();
    await screen.findByRole('heading', { name: 'Computer Science' });
    fireEvent.change(screen.getByLabelText('Entry year'), { target: { value: '2027' } });
    await waitFor(() =>
      expect(fetchIb).toHaveBeenLastCalledWith(
        'test-university',
        expect.objectContaining({ year: '2027', page: 1 }),
      ),
    );
    fireEvent.change(screen.getByLabelText('Applicant'), { target: { value: 'international' } });
    await waitFor(() =>
      expect(fetchIb).toHaveBeenLastCalledWith(
        'test-university',
        expect.objectContaining({ year: '2027', applicantType: 'international' }),
      ),
    );
    fireEvent.change(screen.getByLabelText('Entry route'), { target: { value: 'transfer' } });
    await waitFor(() =>
      expect(fetchIb).toHaveBeenLastCalledWith(
        'test-university',
        expect.objectContaining({ entryType: 'transfer', applicantType: 'international' }),
      ),
    );
    fireEvent.change(screen.getByLabelText('Study level'), { target: { value: 'graduate' } });
    await waitFor(() =>
      expect(fetchIb).toHaveBeenLastCalledWith(
        'test-university',
        expect.objectContaining({
          year: '2027',
          applicantType: 'international',
          entryType: 'transfer',
          level: 'graduate',
          page: 1,
        }),
      ),
    );
    expect(screen.getByLabelText('Entry year')).toHaveValue('2027');
  });

  it('paginates catalog entries and resets to the first page when submitting a search', async () => {
    fetchIb.mockImplementation(async (_slug: string, query: IbQuery) =>
      response({
        pagination: { page: query.page, pageSize: 20, total: 21, totalPages: 2 },
        coverage: {
          catalogPrograms: 21,
          programsWithReviewedIb: 1,
          programsWithPublishedTotals: 1,
        },
      }),
    );
    renderSection();
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(fetchIb).toHaveBeenLastCalledWith(
      'test-university',
      expect.objectContaining({ page: 2, pageSize: 20 }),
    );
    fireEvent.change(screen.getByLabelText('Program name'), {
      target: { value: '  Computer Science  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search programs' }));
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(fetchIb).toHaveBeenLastCalledWith(
      'test-university',
      expect.objectContaining({ page: 1, q: 'Computer Science' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('1 of 21 catalog entries');
  });

  it('does not treat missing postgraduate entry information as an IB cutoff', async () => {
    const data = response();
    data.programs = data.programs.map((program) => ({
      ...program,
      name: 'Computing PhD',
      level: 'graduate',
      requirements: [],
    }));
    fetchIb.mockResolvedValue(data);
    renderSection();
    expect(
      await screen.findByText(/Its prior-degree entry requirements have not been verified here/u),
    ).toBeInTheDocument();
    expect(screen.queryByText(/school-wide score must not/u)).not.toBeInTheDocument();
  });
});
