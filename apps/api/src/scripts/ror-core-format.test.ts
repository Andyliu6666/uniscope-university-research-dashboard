import { describe, expect, it } from 'vitest';
import {
  assertRorCoreColumns,
  normalizeHttpsUrl,
  parseRorAliases,
  ROR_CORE_COLUMNS,
  rorIdFromUrl,
  toRorCoreDatabasePatch,
  transformRorCoreCsvRow,
} from './ror-core-format.js';

const row = {
  id: 'https://ror.org/012345678',
  'admin.last_modified.date': '2026-08-25',
  established: '1965',
  'links.type.website': 'https://example.edu/',
  'links.type.wikipedia': 'http://en.wikipedia.org/wiki/Example',
  'locations.geonames_details.continent_code': 'AF',
  'locations.geonames_details.country_code': 'KE',
  'locations.geonames_details.country_subdivision_name': 'Nairobi County',
  'locations.geonames_details.lat': '-1.286389',
  'locations.geonames_details.lng': '36.817223',
  'names.types.acronym': 'no_lang_code: EU',
  'names.types.alias': 'en: Example College, Example Institute; sw: Chuo cha Mfano',
  'names.types.label': 'sw: Chuo Kikuu cha Mfano',
  'names.types.ror_display': 'Example University',
  status: 'active',
  types: 'education; funder',
};

describe('ROR core artifact projection', () => {
  it('requires the reviewed CSV columns', () => {
    expect(() => assertRorCoreColumns([...ROR_CORE_COLUMNS])).not.toThrow();
    expect(() => assertRorCoreColumns(ROR_CORE_COLUMNS.filter((name) => name !== 'id'))).toThrow(
      /missing required columns/u,
    );
  });

  it('accepts canonical ROR identifiers and retains only safe HTTPS official URLs', () => {
    expect(rorIdFromUrl('https://ror.org/012345678')).toBe('012345678');
    expect(rorIdFromUrl('https://example.org/012345678')).toBeNull();
    expect(normalizeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeHttpsUrl('http://example.edu/')).toBeNull();
    expect(normalizeHttpsUrl('https://user:secret@example.edu/')).toBeNull();
    expect(
      normalizeHttpsUrl('http://old.example.edu/; https://secure.example.edu/path#about'),
    ).toBe('https://secure.example.edu/path');
    expect(normalizeHttpsUrl('http://en.wikipedia.org/wiki/Example', true)).toBe(
      'https://en.wikipedia.org/wiki/Example',
    );
  });

  it('retains language-tagged stored names', () => {
    expect(parseRorAliases(row['names.types.alias'], 'alias', 'Example University')).toEqual([
      { name: 'Example College', kind: 'alias', languageCode: 'en' },
      { name: 'Example Institute', kind: 'alias', languageCode: 'en' },
      { name: 'Chuo cha Mfano', kind: 'alias', languageCode: 'sw' },
    ]);
  });

  it('projects only education records into validated core facts', () => {
    const projected = transformRorCoreCsvRow(row);
    if (!projected) throw new Error('Expected an education record.');
    expect(projected).toMatchObject({
      rorId: '012345678',
      status: 'active',
      countryCode: 'KE',
      continentCode: 'AF',
      region: 'Nairobi County',
      latitude: -1.286389,
      longitude: 36.817223,
      officialWebsite: 'https://example.edu/',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Example',
      establishedYear: 1965,
    });
    expect(toRorCoreDatabasePatch('00000000-0000-0000-0000-000000000001', projected)).toMatchObject(
      {
        university_id: '00000000-0000-0000-0000-000000000001',
        country_code: 'KE',
        continent_code: 'AF',
        official_website: 'https://example.edu/',
        wikipedia_url: 'https://en.wikipedia.org/wiki/Example',
        established_year: 1965,
        operating_status: 'active',
        source_modified_at: '2026-08-25T00:00:00.000Z',
      },
    );
    expect(transformRorCoreCsvRow({ ...row, types: 'funder' })).toBeNull();
  });

  it('retains valid establishment years before 1000', () => {
    expect(transformRorCoreCsvRow({ ...row, established: '970' })?.establishedYear).toBe(970);
  });

  it('omits insecure official links from projected core facts', () => {
    expect(
      transformRorCoreCsvRow({ ...row, 'links.type.website': 'http://example.edu/' })
        ?.officialWebsite,
    ).toBeNull();
  });
});
