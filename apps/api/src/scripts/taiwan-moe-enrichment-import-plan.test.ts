import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  taiwanMoeDepartmentArtifactSchema,
  taiwanMoeTuitionArtifactSchema,
  type TaiwanMoeDepartmentArtifact,
  type TaiwanMoeTuitionArtifact,
} from './taiwan-moe-enrichment-format.js';
import {
  buildTaiwanMoeCostPlan,
  buildTaiwanMoeEnrichmentSchools,
  buildTaiwanMoeProgramProvenance,
  buildTaiwanMoeProgramPlan,
  resolveExactTaiwanMoeIdentifier,
  taiwanMoeProgramSourceExternalId,
} from './taiwan-moe-enrichment-import-plan.js';

const sourceDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../data/sources',
);
let departmentArtifact: TaiwanMoeDepartmentArtifact;
let tuitionArtifact: TaiwanMoeTuitionArtifact;

beforeAll(async () => {
  departmentArtifact = taiwanMoeDepartmentArtifactSchema.parse(
    JSON.parse(await readFile(resolve(sourceDirectory, 'taiwan-moe-departments-114.json'), 'utf8')),
  );
  tuitionArtifact = taiwanMoeTuitionArtifactSchema.parse(
    JSON.parse(await readFile(resolve(sourceDirectory, 'taiwan-moe-tuition-114.json'), 'utf8')),
  );
});

describe('Taiwan MOE enrichment import plan', () => {
  it('joins the two reviewed artifacts by canonical school code only', () => {
    const schools = buildTaiwanMoeEnrichmentSchools(departmentArtifact, tuitionArtifact);
    expect(schools).toHaveLength(148);
    expect(schools.filter((school) => school.department && school.tuition)).toHaveLength(139);
    expect(schools.filter((school) => school.department && !school.tuition)).toHaveLength(1);
    expect(schools.filter((school) => !school.department && school.tuition)).toHaveLength(8);
  });

  it('produces exact reviewed program and tuition plans without inventing facts', () => {
    const schools = buildTaiwanMoeEnrichmentSchools(departmentArtifact, tuitionArtifact);
    const programPlans = schools.map(buildTaiwanMoeProgramPlan);
    const costPlans = schools.map(buildTaiwanMoeCostPlan);
    expect(programPlans.reduce((total, plan) => total + plan.candidates.length, 0)).toBe(7_696);
    expect(
      programPlans.reduce((total, plan) => total + plan.organizationalUnitRowsSkipped, 0),
    ).toBe(472);
    expect(
      programPlans.reduce((total, plan) => total + plan.unsupportedQualificationRowsSkipped, 0),
    ).toBe(3);
    expect(
      programPlans.reduce((total, plan) => total + plan.duplicateOfferingRowsCollapsed, 0),
    ).toBe(1_170);
    expect(costPlans.reduce((total, plan) => total + plan.candidates.length, 0)).toBe(529);
    expect(costPlans.reduce((total, plan) => total + plan.sourceReportedZeroCellsSkipped, 0)).toBe(
      1_823,
    );
    expect(costPlans.reduce((total, plan) => total + plan.sourceBlankCellsSkipped, 0)).toBe(0);
    const candidates = programPlans.flatMap((plan) => plan.candidates);
    expect(new Set(candidates.map((candidate) => candidate.sourceExternalId)).size).toBe(7_696);
    expect(
      candidates.every(
        (candidate) =>
          candidate.sourceRows.length > 0 &&
          candidate.sourceRows.every(
            (sourceRow: number) => Number.isInteger(sourceRow) && sourceRow > 0,
          ),
      ),
    ).toBe(true);
    expect(candidates.every((candidate) => candidate.attendanceModes.length > 0)).toBe(true);
  });

  it('resolves only a unique exact canonical tw_moe identifier', () => {
    const identities = new Map<string, ReadonlySet<string>>([
      ['1', new Set(['university-1'])],
      ['2', new Set(['university-2a', 'university-2b'])],
    ]);
    expect(resolveExactTaiwanMoeIdentifier('0001', identities)).toEqual({
      kind: 'matched',
      canonicalSchoolCode: '1',
      universityId: 'university-1',
    });
    expect(resolveExactTaiwanMoeIdentifier('0002', identities)).toMatchObject({ kind: 'reject' });
    expect(resolveExactTaiwanMoeIdentifier('0003', identities)).toMatchObject({ kind: 'reject' });
  });

  it('derives a stable auditable program key from source identity fields', () => {
    const school = buildTaiwanMoeEnrichmentSchools(departmentArtifact, tuitionArtifact).find(
      (candidate) =>
        candidate.department?.records.some((record) => record.recordKind === 'qualification'),
    );
    const record = school?.department?.records.find(
      (candidate) => candidate.recordKind === 'qualification',
    );
    const department = school?.department;
    if (!school || !department || !record) {
      throw new Error('Reviewed artifact has no qualification record.');
    }
    expect(taiwanMoeProgramSourceExternalId(school.canonicalSchoolCode, record)).toBe(
      `${school.canonicalSchoolCode}:${record.unitCode}:${record.qualification?.code}:${record.unitName}`,
    );

    const candidate = buildTaiwanMoeProgramPlan(school).candidates[0];
    if (!candidate) throw new Error('Reviewed artifact has no supported program candidate.');
    const provenance = buildTaiwanMoeProgramProvenance(candidate, {
      artifactFile: 'taiwan-moe-departments-114.json',
      datasetVersion: '114',
      academicYear: '2025-26',
      datasetPageUrl: 'https://data.gov.tw/dataset/6231',
      downloadUrl: 'https://example.gov.tw/departments.csv',
      sourceRetrievedAt: '2026-08-31T00:00:00Z',
      sourceLastModifiedAt: '2026-08-30T00:00:00Z',
      schoolCode: department.schoolCode,
      canonicalSchoolCode: school.canonicalSchoolCode,
      schoolName: department.chineseName,
    });
    expect(provenance).toMatchObject({
      academicYear: '2025-26',
      sourceProvider: 'tw_moe_departments',
      sourceExternalId: candidate.sourceExternalId,
      sourceFlags: {
        provider: 'tw_moe_departments',
        sourceRows: candidate.sourceRows,
        canonicalSchoolCode: school.canonicalSchoolCode,
        unitCode: candidate.unitCode,
        qualificationCode: candidate.qualification.code,
      },
    });
  });
});
