import { z } from 'zod';

export const directoryStatusSchema = z.enum(['exact', 'legal_name_variant', 'conflict', 'missing']);

export const studyLevelSchema = z.enum([
  'all',
  'undergraduate',
  'graduate',
  'doctoral',
  'non_degree',
  'other',
]);

export const enrollmentAggregateSchema = z.object({
  qualificationCode: z.string().min(1),
  qualificationLabel: z.string().min(1),
  population: z.string().regex(/^qualification_[a-z0-9_]+$/u),
  level: studyLevelSchema,
  studentCount: z.number().int().nonnegative(),
  menCount: z.number().int().nonnegative(),
  womenCount: z.number().int().nonnegative(),
  attendanceModes: z.array(z.string().min(1)).min(1),
  sourceRows: z.array(z.number().int().positive()).min(1),
});

export const taiwanMoeSchoolSchema = z.object({
  schoolCode: z.string().regex(/^[0-9A-Z]+$/u),
  chineseName: z.string().min(2),
  englishName: z.string().min(2).nullable(),
  publicPrivate: z.enum(['public', 'private']).nullable(),
  systemType: z.string().min(1).nullable(),
  county: z.string().min(1).nullable(),
  district: z.string().min(1).nullable(),
  postalCode: z.string().min(1).nullable(),
  address: z.string().min(1).nullable(),
  phone: z.string().min(1).nullable(),
  website: z.string().url().nullable(),
  directoryStatus: directoryStatusSchema,
  directoryChineseName: z.string().min(2).nullable(),
  totalStudentCount: z.number().int().nonnegative(),
  menCount: z.number().int().nonnegative(),
  womenCount: z.number().int().nonnegative(),
  sourceRows: z.array(z.number().int().positive()).min(1),
  enrollments: z.array(enrollmentAggregateSchema).min(1),
});

export const taiwanMoeArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  datasetVersion: z.literal('114'),
  reportedAcademicYear: z.literal('114'),
  academicYear: z.literal('2025-26'),
  generatedAt: z.iso.datetime(),
  selectedSourceRows: z.number().int().positive(),
  schools: z.array(taiwanMoeSchoolSchema).min(1),
});

const reviewedSourceSchema = z.object({
  role: z.enum(['directory', 'enrollment']),
  datasetFile: z.string().min(1),
  datasetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  datasetRows: z.number().int().positive(),
  datasetVersion: z.string().min(1),
  datasetPageUrl: z.string().url().startsWith('https://'),
  downloadUrl: z.string().url().startsWith('https://'),
  publisher: z.string().min(1),
  notes: z.string().min(1),
});

export const taiwanMoeSourceReviewSchema = z.object({
  schemaVersion: z.literal(1),
  retrievedAt: z.iso.datetime(),
  license: z.object({ name: z.string().min(1), url: z.string().url().startsWith('https://') }),
  sources: z.array(reviewedSourceSchema).length(2),
});

export const taiwanMoeManifestSchema = taiwanMoeSourceReviewSchema.extend({
  generatedArtifact: z.object({
    datasetFile: z.string().min(1),
    datasetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    datasetVersion: z.literal('114'),
    schoolCount: z.number().int().positive(),
    selectedSourceRows: z.number().int().positive(),
  }),
});

export type TaiwanMoeArtifact = z.infer<typeof taiwanMoeArtifactSchema>;
export type TaiwanMoeSchool = z.infer<typeof taiwanMoeSchoolSchema>;
export type TaiwanMoeManifest = z.infer<typeof taiwanMoeManifestSchema>;

export type TaiwanMoeIdentityResolution =
  | { kind: 'existing'; universityId: string; matchedBy: 'identifier' | 'domain' | 'alias' }
  | { kind: 'create' }
  | { kind: 'reject'; reason: string };

export type TaiwanMoeIdentityCandidates = {
  identifierUniversityId: string | undefined;
  domainUniversityIds: readonly string[];
  aliasUniversityIds: readonly string[];
};

export const cleanText = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/gu, ' ').trim();
  return cleaned || null;
};

export const normaliseOfficialUrl = (value: unknown) => {
  const text = cleanText(value);
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//iu.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.protocol = 'https:';
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

export const websiteDomain = (value: unknown) => {
  const url = normaliseOfficialUrl(value);
  if (!url) return null;
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./u, '');
  return hostname || null;
};

export const classifyDirectoryName = (currentName: string, directoryName: string | null) => {
  if (!directoryName) return 'missing' as const;
  if (currentName === directoryName) return 'exact' as const;
  if (directoryName.includes(currentName)) return 'legal_name_variant' as const;
  return 'conflict' as const;
};

export const hasReliableDirectoryRow = (school: TaiwanMoeSchool) =>
  school.directoryStatus === 'exact' || school.directoryStatus === 'legal_name_variant';

const oneUniqueValue = (values: readonly string[]) => {
  const unique = [...new Set(values)];
  return unique.length === 1 ? (unique[0] as string) : null;
};

/**
 * Resolve a current MOE school without name similarity.
 *
 * A previously attached MOE code is strongest. An exact current Chinese label
 * may safely recover a renamed institution. The old 108 directory domain is
 * considered only when that directory row still names the current 114 school;
 * stale rename/merge rows are never allowed to drive a domain match or create.
 */
export const resolveTaiwanMoeIdentity = (
  school: TaiwanMoeSchool,
  candidates: TaiwanMoeIdentityCandidates,
): TaiwanMoeIdentityResolution => {
  if (candidates.identifierUniversityId) {
    return {
      kind: 'existing',
      universityId: candidates.identifierUniversityId,
      matchedBy: 'identifier',
    };
  }

  const domainIds = hasReliableDirectoryRow(school) ? candidates.domainUniversityIds : [];
  const aliasIds = candidates.aliasUniversityIds;
  const uniqueDomainIds = [...new Set(domainIds)];
  const uniqueAliasIds = [...new Set(aliasIds)];
  const domainMatch = oneUniqueValue(uniqueDomainIds);
  const aliasMatch = oneUniqueValue(uniqueAliasIds);
  if (uniqueDomainIds.length > 1) {
    return {
      kind: 'reject',
      reason: `Official website domain is not unique: ${websiteDomain(school.website) ?? 'missing'}`,
    };
  }
  if (uniqueAliasIds.length > 1) {
    return {
      kind: 'reject',
      reason: `Exact official Chinese alias is attached to multiple institutions: ${school.chineseName}`,
    };
  }
  if (domainMatch && aliasMatch && domainMatch !== aliasMatch) {
    return {
      kind: 'reject',
      reason: 'Unique website-domain and exact official Chinese-alias matches disagree.',
    };
  }
  if (domainMatch) return { kind: 'existing', universityId: domainMatch, matchedBy: 'domain' };
  if (aliasMatch) return { kind: 'existing', universityId: aliasMatch, matchedBy: 'alias' };
  if (school.directoryStatus === 'conflict') {
    return {
      kind: 'reject',
      reason: `108 directory name conflicts with current 114 name (${school.directoryChineseName ?? 'missing'} => ${school.chineseName}).`,
    };
  }
  if (school.directoryStatus === 'missing') {
    return { kind: 'reject', reason: 'Current 114 school is missing from the reviewed directory.' };
  }
  if (!school.website) {
    return { kind: 'reject', reason: 'Reviewed directory has no valid official website.' };
  }
  return { kind: 'create' };
};

const qualificationDefinitions: Record<
  string,
  { qualificationCode: string; population: string; level: z.infer<typeof studyLevelSchema> }
> = {
  'D 博士': {
    qualificationCode: 'D',
    population: 'qualification_doctorate',
    level: 'doctoral',
  },
  'M 碩士': {
    qualificationCode: 'M',
    population: 'qualification_masters',
    level: 'graduate',
  },
  'B 學士': {
    qualificationCode: 'B',
    population: 'qualification_bachelors',
    level: 'undergraduate',
  },
  'B 四技': {
    qualificationCode: 'B',
    population: 'qualification_four_year_technical',
    level: 'undergraduate',
  },
  'C 二年制': {
    qualificationCode: 'C',
    population: 'qualification_two_year_bachelors',
    level: 'undergraduate',
  },
  'C 二技': {
    qualificationCode: 'C',
    population: 'qualification_two_year_technical',
    level: 'undergraduate',
  },
  '2 二專': {
    qualificationCode: '2',
    population: 'qualification_junior_college_two_year',
    level: 'undergraduate',
  },
  '5 五專': {
    qualificationCode: '5',
    population: 'qualification_junior_college_five_year',
    level: 'undergraduate',
  },
  '5 七年': {
    qualificationCode: '5',
    population: 'qualification_seven_year',
    level: 'undergraduate',
  },
  'X 4+X': {
    qualificationCode: 'X',
    population: 'qualification_4_plus_x',
    level: 'other',
  },
};

export const qualificationDefinition = (label: string) => qualificationDefinitions[label] ?? null;
