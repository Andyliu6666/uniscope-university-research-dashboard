import { describe, expect, it } from 'vitest';
import {
  classifyDirectoryName,
  normaliseOfficialUrl,
  qualificationDefinition,
  resolveTaiwanMoeIdentity,
  websiteDomain,
  type TaiwanMoeSchool,
} from './taiwan-moe-format.js';

const school = (overrides: Partial<TaiwanMoeSchool> = {}): TaiwanMoeSchool => ({
  schoolCode: '0001',
  chineseName: '現行大學',
  englishName: 'Current University',
  publicPrivate: 'public',
  systemType: '一般大學',
  county: '臺北市',
  district: '大安區',
  postalCode: '100',
  address: '臺北市大安區測試路1號',
  phone: '02-12345678',
  website: 'https://current.example.edu.tw/',
  directoryStatus: 'exact',
  directoryChineseName: '現行大學',
  totalStudentCount: 100,
  menCount: 40,
  womenCount: 60,
  sourceRows: [1],
  enrollments: [
    {
      qualificationCode: 'B',
      qualificationLabel: '學士',
      population: 'qualification_bachelors',
      level: 'undergraduate',
      studentCount: 100,
      menCount: 40,
      womenCount: 60,
      attendanceModes: ['日間'],
      sourceRows: [1],
    },
  ],
  ...overrides,
});

describe('Taiwan MOE artifact helpers', () => {
  it('distinguishes legal-name wrappers from actual renames', () => {
    expect(classifyDirectoryName('南臺科技大學', '南臺學校財團法人南臺科技大學')).toBe(
      'legal_name_variant',
    );
    expect(classifyDirectoryName('國立陽明交通大學', '國立交通大學')).toBe('conflict');
    expect(classifyDirectoryName('馬偕醫學大學', null)).toBe('missing');
  });

  it('normalises official domains without treating paths as identity', () => {
    expect(normaliseOfficialUrl('http://www.ntu.edu.tw/path')).toBe('https://www.ntu.edu.tw/path');
    expect(websiteDomain('https://www.ntu.edu.tw/path')).toBe('ntu.edu.tw');
  });

  it('maps Ministry qualification labels without inventing unknown mappings', () => {
    expect(qualificationDefinition('D 博士')).toMatchObject({
      level: 'doctoral',
      population: 'qualification_doctorate',
    });
    expect(qualificationDefinition('unknown')).toBeNull();
  });

  it('never lets a stale directory domain match or create a renamed school', () => {
    const current = school({
      directoryStatus: 'conflict',
      directoryChineseName: '舊校名',
      website: 'https://old.example.edu.tw/',
    });
    expect(
      resolveTaiwanMoeIdentity(current, {
        identifierUniversityId: undefined,
        domainUniversityIds: ['stale-domain-id'],
        aliasUniversityIds: [],
      }),
    ).toMatchObject({ kind: 'reject' });
  });

  it('allows only exact strong identities and reliable directory creation', () => {
    const current = school({ directoryStatus: 'conflict', directoryChineseName: '舊校名' });
    expect(
      resolveTaiwanMoeIdentity(current, {
        identifierUniversityId: 'code-id',
        domainUniversityIds: [],
        aliasUniversityIds: [],
      }),
    ).toEqual({ kind: 'existing', universityId: 'code-id', matchedBy: 'identifier' });
    expect(
      resolveTaiwanMoeIdentity(current, {
        identifierUniversityId: undefined,
        domainUniversityIds: [],
        aliasUniversityIds: ['current-label-id'],
      }),
    ).toEqual({ kind: 'existing', universityId: 'current-label-id', matchedBy: 'alias' });
    expect(
      resolveTaiwanMoeIdentity(school(), {
        identifierUniversityId: undefined,
        domainUniversityIds: [],
        aliasUniversityIds: [],
      }),
    ).toEqual({ kind: 'create' });
  });

  it('quarantines ambiguous or disagreeing exact matches', () => {
    expect(
      resolveTaiwanMoeIdentity(school(), {
        identifierUniversityId: undefined,
        domainUniversityIds: ['domain-id'],
        aliasUniversityIds: ['alias-id'],
      }),
    ).toMatchObject({ kind: 'reject' });
    expect(
      resolveTaiwanMoeIdentity(school(), {
        identifierUniversityId: undefined,
        domainUniversityIds: ['first', 'second'],
        aliasUniversityIds: [],
      }),
    ).toMatchObject({ kind: 'reject' });
  });
});
