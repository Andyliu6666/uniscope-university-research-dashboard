// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AdmissionProfile, UniversityAdmissionsResponse, UniversitySource } from '@urd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdmissionsSection } from './DetailPage.js';

const source: UniversitySource = {
  title: 'General source',
  url: 'https://example.edu/general',
  category: 'official',
  verifiedAt: '2026-10-02T00:00:00Z',
};
const profile = (id: string, changes: Partial<AdmissionProfile> = {}): AdmissionProfile => ({
  id,
  programId: null,
  academicYear: 'unspecified',
  intakeTerm: 'unspecified',
  entryType: 'first_year',
  level: 'undergraduate',
  applicantType: 'all',
  openAdmission: null,
  applicationUrl: null,
  notes: 'Programme rules can add conditions.',
  counts: [],
  qualifications: [],
  testScores: [],
  source,
  requirements: [
    {
      category: 'academic',
      requirementKey: 'academic',
      label: `Requirement ${id}`,
      status: 'required',
      details: `Details ${id}`,
      verifiedAt: '2026-10-02T00:00:00Z',
      sourceFlags: {},
      source: {
        ...source,
        title: 'Specific requirement source',
        url: 'https://example.edu/specific',
      },
    },
  ],
  ...changes,
});
const response = (profiles: AdmissionProfile[]): UniversityAdmissionsResponse => ({
  university: { id: 'university', name: 'University', slug: 'university' },
  profiles,
  pagination: { page: 1, pageSize: 50, total: profiles.length, totalPages: 1 },
  costs: [],
  enrollment: [],
  financialAid: [],
  sources: [source],
});
afterEach(cleanup);
describe('general admissions scope and evidence', () => {
  it('shows the fact source rather than attributing every fact to the profile source', () => {
    render(<AdmissionsSection data={response([profile('one')])} pending={false} />);
    expect(screen.getByRole('link', { name: /Specific requirement source/ })).toHaveAttribute(
      'href',
      'https://example.edu/specific',
    );
    expect(screen.queryByText('Not reported')).not.toBeInTheDocument();
    expect(screen.getByText(/Year not specified/)).toBeInTheDocument();
  });
  it('makes graduate and international scopes accessible without mixing requirements', () => {
    render(
      <AdmissionsSection
        data={response([
          profile('one'),
          profile('two', {
            level: 'graduate',
            applicantType: 'international',
            academicYear: '2026',
          }),
        ])}
        pending={false}
      />,
    );
    expect(screen.queryByText('Details two')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Choose admission scope'), { target: { value: 'two' } });
    expect(screen.getByText('Details two')).toBeInTheDocument();
    expect(screen.queryByText('Details one')).not.toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /graduate.*2026.*international/ }),
    ).toBeInTheDocument();
  });
  it('does not repeat IB-only profiles or invent general requirements', () => {
    render(
      <AdmissionsSection data={response([profile('ib', { requirements: [] })])} pending={false} />,
    );
    expect(
      screen.getByText(/General admissions requirements and statistics have not been verified/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Choose admission scope')).not.toBeInTheDocument();
  });
  it('handles a pending request and an empty response', () => {
    const { rerender } = render(<AdmissionsSection data={undefined} pending />);
    expect(screen.getByText('Loading official admissions data…')).toBeInTheDocument();
    rerender(<AdmissionsSection data={undefined} pending={false} />);
    expect(screen.getByText(/Not yet researched/)).toBeInTheDocument();
  });

  it('can leave a page containing only IB profiles instead of hiding later scopes', () => {
    const onPageChange = vi.fn();
    const data = response([profile('ib', { requirements: [] })]);
    data.pagination = { page: 1, pageSize: 1, total: 51, totalPages: 51 };
    const { rerender } = render(
      <AdmissionsSection data={data} pending={false} onPageChange={onPageChange} />,
    );
    expect(screen.getByRole('button', { name: 'Previous admissions page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next admissions page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    rerender(
      <AdmissionsSection
        data={{ ...data, pagination: { ...data.pagination, page: 51 } }}
        pending={false}
        onPageChange={onPageChange}
      />,
    );
    expect(screen.getByRole('button', { name: 'Next admissions page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous admissions page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(50);
  });

  it('does not present a request failure as missing research and permits retry', () => {
    const onRetry = vi.fn();
    render(<AdmissionsSection data={undefined} pending={false} failed onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'does not mean the school has no requirements',
    );
    expect(screen.queryByText(/Not yet researched/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry admissions request' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
