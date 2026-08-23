import type {
  University,
  UniversityInput,
  UniversityListResponse,
  UniversityQuery,
} from '@urd/shared';

const configuredApiUrl = import.meta.env.VITE_API_URL as unknown;
const API_URL = typeof configuredApiUrl === 'string' && configuredApiUrl ? configuredApiUrl : '';
const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, options);
  if (!response.ok) {
    const body = (await response.json()) as unknown;
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Request failed';
    throw new Error(message);
  }
  return response.json() as Promise<T>;
};

export const fetchUniversities = (query: UniversityQuery) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<UniversityListResponse>(`/api/universities?${params.toString()}`);
};
export const fetchUniversity = (slug: string) => request<University>(`/api/universities/${slug}`);
export const saveUniversity = (input: UniversityInput, adminKey: string) =>
  request<{ slug: string }>('/api/admin/universities', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
    body: JSON.stringify(input),
  });
