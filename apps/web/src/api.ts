import type {
  AdmissionsQuery,
  UniversityAdmissionsResponse,
  University,
  UniversityInput,
  UniversityListResponse,
  UniversityQuery,
} from '@urd/shared';

const configuredApiUrl = import.meta.env.VITE_API_URL as unknown;
const API_URL = typeof configuredApiUrl === 'string' && configuredApiUrl ? configuredApiUrl : '';

const readJson = (raw: string): unknown => {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, options);
  const rawBody = await response.text();
  const body = readJson(rawBody);
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Request failed';
    throw new Error(message);
  }
  if (body === null) throw new Error('The server returned an empty response.');
  return body as T;
};

export const fetchUniversities = (query: UniversityQuery) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<UniversityListResponse>(`/api/universities?${params.toString()}`);
};
export const fetchUniversity = (slug: string) => request<University>(`/api/universities/${slug}`);
export const fetchUniversityAdmissions = (slug: string, query: AdmissionsQuery = {}) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<UniversityAdmissionsResponse>(
    `/api/universities/${slug}/admissions?${params.toString()}`,
  );
};
export const saveUniversity = (input: UniversityInput, adminKey: string) =>
  request<{ slug: string }>('/api/admin/universities', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
    body: JSON.stringify(input),
  });
