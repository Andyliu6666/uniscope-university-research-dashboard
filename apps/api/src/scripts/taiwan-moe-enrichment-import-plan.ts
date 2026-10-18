import {
  canonicalTaiwanMoeSchoolCode,
  toTaiwanMoeCostCandidate,
  toTaiwanMoeProgramCandidate,
  type TaiwanMoeDepartmentArtifact,
  type TaiwanMoeTuitionArtifact,
} from './taiwan-moe-enrichment-format.js';

export type TaiwanMoeEnrichmentSchool = {
  canonicalSchoolCode: string;
  department: TaiwanMoeDepartmentArtifact['schools'][number] | null;
  tuition: TaiwanMoeTuitionArtifact['schools'][number] | null;
};

export const taiwanMoeProgramSourceProvider = 'tw_moe_departments';

export type TaiwanMoeProgramCandidate = NonNullable<
  ReturnType<typeof toTaiwanMoeProgramCandidate>
> & {
  sourceExternalId: string;
  unitCode: string;
  qualification: { code: string; label: string };
  sourceRows: number[];
  attendanceModes: Array<{ code: string; label: string }>;
};

export const buildTaiwanMoeEnrichmentSchools = (
  departmentArtifact: TaiwanMoeDepartmentArtifact,
  tuitionArtifact: TaiwanMoeTuitionArtifact,
) => {
  const schools = new Map<string, TaiwanMoeEnrichmentSchool>();
  for (const department of departmentArtifact.schools) {
    const canonicalSchoolCode = canonicalTaiwanMoeSchoolCode(department.schoolCode);
    if (schools.has(canonicalSchoolCode)) {
      throw new Error(`Duplicate canonical department school code: ${canonicalSchoolCode}`);
    }
    schools.set(canonicalSchoolCode, { canonicalSchoolCode, department, tuition: null });
  }
  for (const tuition of tuitionArtifact.schools) {
    const canonicalSchoolCode = canonicalTaiwanMoeSchoolCode(tuition.schoolCode);
    const existing = schools.get(canonicalSchoolCode);
    if (existing?.tuition) {
      throw new Error(`Duplicate canonical tuition school code: ${canonicalSchoolCode}`);
    }
    schools.set(canonicalSchoolCode, {
      canonicalSchoolCode,
      department: existing?.department ?? null,
      tuition,
    });
  }
  return [...schools.values()].sort((left, right) =>
    left.canonicalSchoolCode < right.canonicalSchoolCode
      ? -1
      : left.canonicalSchoolCode > right.canonicalSchoolCode
        ? 1
        : 0,
  );
};

export const resolveExactTaiwanMoeIdentifier = (
  schoolCode: string,
  universityIdsByCanonicalCode: ReadonlyMap<string, ReadonlySet<string>>,
) => {
  const canonicalSchoolCode = canonicalTaiwanMoeSchoolCode(schoolCode);
  const universityIds = [...(universityIdsByCanonicalCode.get(canonicalSchoolCode) ?? [])].sort();
  if (universityIds.length === 1) {
    return {
      kind: 'matched' as const,
      canonicalSchoolCode,
      universityId: universityIds[0] as string,
    };
  }
  if (!universityIds.length) {
    return {
      kind: 'reject' as const,
      canonicalSchoolCode,
      reason: 'No exact tw_moe school-code identifier exists for this reviewed school.',
    };
  }
  return {
    kind: 'reject' as const,
    canonicalSchoolCode,
    reason: 'The canonical tw_moe school code resolves to multiple universities.',
  };
};

export const taiwanMoeProgramSourceExternalId = (
  canonicalSchoolCode: string,
  record: NonNullable<TaiwanMoeEnrichmentSchool['department']>['records'][number],
) => {
  if (record.recordKind !== 'qualification' || !record.qualification) {
    throw new Error('Only a Taiwan MOE qualification row can identify a program source record.');
  }
  const externalId = [
    canonicalTaiwanMoeSchoolCode(canonicalSchoolCode),
    record.unitCode,
    record.qualification.code,
    record.unitName,
  ].join(':');
  if (externalId.length > 255) {
    throw new Error(`Taiwan MOE program source identifier exceeds 255 characters: ${externalId}`);
  }
  return externalId;
};

export const buildTaiwanMoeProgramPlan = (school: TaiwanMoeEnrichmentSchool) => {
  const candidates = new Map<string, TaiwanMoeProgramCandidate>();
  let organizationalUnitRowsSkipped = 0;
  let unsupportedQualificationRowsSkipped = 0;
  let duplicateOfferingRowsCollapsed = 0;
  for (const record of school.department?.records ?? []) {
    if (record.recordKind === 'organizational_unit') {
      organizationalUnitRowsSkipped += 1;
      continue;
    }
    const candidate = toTaiwanMoeProgramCandidate(record);
    if (!candidate) {
      unsupportedQualificationRowsSkipped += 1;
      continue;
    }
    if (!record.qualification) {
      throw new Error(`Qualification program row ${record.sourceRow} has no qualification.`);
    }
    const sourceExternalId = taiwanMoeProgramSourceExternalId(school.canonicalSchoolCode, record);
    const existing = candidates.get(sourceExternalId);
    if (existing) {
      if (
        existing.name !== candidate.name ||
        existing.level !== candidate.level ||
        existing.field !== candidate.field
      ) {
        throw new Error(
          `Taiwan MOE source identifier ${sourceExternalId} maps to inconsistent program facts.`,
        );
      }
      existing.sourceRows.push(record.sourceRow);
      if (
        !existing.attendanceModes.some(
          ({ code, label }) => code === record.attendance.code && label === record.attendance.label,
        )
      ) {
        existing.attendanceModes.push(record.attendance);
      }
      duplicateOfferingRowsCollapsed += 1;
    } else {
      candidates.set(sourceExternalId, {
        ...candidate,
        sourceExternalId,
        unitCode: record.unitCode,
        qualification: record.qualification,
        sourceRows: [record.sourceRow],
        attendanceModes: [record.attendance],
      });
    }
  }
  return {
    candidates: [...candidates.values()].map((candidate) => ({
      ...candidate,
      sourceRows: [...candidate.sourceRows].sort((left, right) => left - right),
      attendanceModes: [...candidate.attendanceModes].sort((left, right) =>
        left.code.localeCompare(right.code),
      ),
    })),
    organizationalUnitRowsSkipped,
    unsupportedQualificationRowsSkipped,
    duplicateOfferingRowsCollapsed,
  };
};

export const buildTaiwanMoeProgramProvenance = (
  candidate: TaiwanMoeProgramCandidate,
  context: {
    artifactFile: string;
    datasetVersion: string;
    academicYear: string;
    datasetPageUrl: string;
    downloadUrl: string;
    sourceRetrievedAt: string;
    sourceLastModifiedAt: string;
    schoolCode: string;
    canonicalSchoolCode: string;
    schoolName: string;
  },
) => ({
  academicYear: context.academicYear,
  sourceProvider: taiwanMoeProgramSourceProvider,
  sourceExternalId: candidate.sourceExternalId,
  sourceFlags: {
    provider: taiwanMoeProgramSourceProvider,
    artifactFile: context.artifactFile,
    datasetVersion: context.datasetVersion,
    datasetPageUrl: context.datasetPageUrl,
    downloadUrl: context.downloadUrl,
    sourceRetrievedAt: context.sourceRetrievedAt,
    sourceLastModifiedAt: context.sourceLastModifiedAt,
    reportedAcademicYear: context.datasetVersion,
    academicYear: context.academicYear,
    schoolCode: context.schoolCode,
    canonicalSchoolCode: context.canonicalSchoolCode,
    schoolName: context.schoolName,
    sourceRows: candidate.sourceRows,
    unitCode: candidate.unitCode,
    unitName: candidate.name,
    qualificationCode: candidate.qualification.code,
    qualificationLabel: candidate.qualification.label,
    attendanceModes: candidate.attendanceModes,
  },
});

export const buildTaiwanMoeCostPlan = (school: TaiwanMoeEnrichmentSchool) => ({
  candidates: (school.tuition?.fees ?? []).map((fee) => ({
    ...toTaiwanMoeCostCandidate(fee),
    sourceRow: school.tuition?.sourceRow ?? 0,
  })),
  sourceReportedZeroCellsSkipped: school.tuition?.sourceReportedZeroCategoryCodes.length ?? 0,
  sourceBlankCellsSkipped: school.tuition?.sourceBlankCategoryCodes.length ?? 0,
});

export const taiwanMoeEnrichmentSchoolSummary = (school: TaiwanMoeEnrichmentSchool) => ({
  canonicalSchoolCode: school.canonicalSchoolCode,
  departmentSchoolCode: school.department?.schoolCode ?? null,
  departmentSchoolName: school.department?.chineseName ?? null,
  departmentRecordCount: school.department?.records.length ?? 0,
  tuitionSchoolCode: school.tuition?.schoolCode ?? null,
  tuitionSchoolName: school.tuition?.chineseName ?? null,
  positiveTuitionCellCount: school.tuition?.fees.length ?? 0,
  sourceReportedZeroTuitionCellCount: school.tuition?.sourceReportedZeroCategoryCodes.length ?? 0,
});
