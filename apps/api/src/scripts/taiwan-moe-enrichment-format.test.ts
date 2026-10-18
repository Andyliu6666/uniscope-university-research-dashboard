import { describe, expect, it } from 'vitest';
import {
  canonicalTaiwanMoeSchoolCode,
  classifyDepartmentRecord,
  nonNegativeInteger,
  parseTuitionCell,
  programLevelForTaiwanMoeQualification,
  splitCodeLabel,
  taiwanMoeTuitionArtifactSchema,
  toTaiwanMoeCostCandidate,
  toTaiwanMoeProgramCandidate,
  tuitionCategoryDefinitions,
  type TaiwanMoeDepartmentRecord,
} from './taiwan-moe-enrichment-format.js';

describe('Taiwan MOE enrichment artifact helpers', () => {
  it('splits reviewed Ministry code-label fields without guessing malformed values', () => {
    expect(splitCodeLabel('30 臺北市', 'county')).toEqual({ code: '30', label: '臺北市' });
    expect(splitCodeLabel('D 日', 'attendance')).toEqual({ code: 'D', label: '日' });
    expect(() => splitCodeLabel('臺北市', 'county')).toThrow(/reviewed code-label/u);
  });

  it('accepts only non-negative integer statistical counts', () => {
    expect(nonNegativeInteger('0', 'students', 1)).toBe(0);
    expect(nonNegativeInteger('123', 'students', 2)).toBe(123);
    expect(() => nonNegativeInteger('-1', 'students', 3)).toThrow(/not a non-negative integer/u);
    expect(() => nonNegativeInteger('1.5', 'students', 4)).toThrow(/not a non-negative integer/u);
  });

  it('keeps empty-qualification organizational units separate from qualifications', () => {
    expect(classifyDepartmentRecord('B 學士', 12, 3)).toEqual({
      recordKind: 'qualification',
      qualification: { code: 'B', label: '學士' },
    });
    expect(classifyDepartmentRecord('', 0, 0)).toEqual({
      recordKind: 'organizational_unit',
      qualification: null,
    });
    expect(() => classifyDepartmentRecord('', 1, 0)).toThrow(/cannot carry students/u);
    expect(() => classifyDepartmentRecord('Q 未審核', 0, 0)).toThrow(
      /Unreviewed qualification code/u,
    );
  });

  it('partitions positive, source-zero, and blank tuition cells without inferring free tuition', () => {
    expect(parseTuitionCell('28,430', 'fee', 1)).toEqual({
      kind: 'amount',
      amountTwd: 28_430,
    });
    expect(parseTuitionCell('28430', 'fee', 2)).toEqual({
      kind: 'amount',
      amountTwd: 28_430,
    });
    expect(parseTuitionCell('0', 'fee', 3)).toEqual({ kind: 'reported_zero' });
    expect(parseTuitionCell('', 'fee', 4)).toEqual({ kind: 'blank' });
    expect(() => parseTuitionCell('28,43', 'fee', 5)).toThrow(/not a reviewed TWD integer/u);
  });

  it('requires the source-unspecified charge period and all reviewed categories', () => {
    const base = {
      schemaVersion: 1,
      datasetVersion: '114',
      academicYear: '2025-26',
      generatedAt: '2026-08-31T14:29:07Z',
      selectedSourceRows: 1,
      schoolCount: 1,
      currency: 'TWD',
      amountMeaning: 'tuition_and_miscellaneous_fee_basis',
      chargePeriod: 'not_specified_by_source',
      referenceDateRule: 'annual October 15 statistical reference date',
      sourceReportedPositiveAmountCount: 1,
      sourceReportedZeroCount: 15,
      sourceBlankCount: 0,
      categories: tuitionCategoryDefinitions,
      schools: [
        {
          sourceRow: 1,
          schoolCode: '0001',
          chineseName: '國立政治大學',
          ownership: 'public',
          institutionCategory: 'general_university',
          fees: [{ categoryCode: 'undergraduate_business_college', amountTwd: 24_890 }],
          sourceReportedZeroCategoryCodes: tuitionCategoryDefinitions
            .filter(({ code }) => code !== 'undergraduate_business_college')
            .map(({ code }) => code),
          sourceBlankCategoryCodes: [],
        },
      ],
    };
    expect(taiwanMoeTuitionArtifactSchema.safeParse(base).success).toBe(true);
    expect(
      taiwanMoeTuitionArtifactSchema.safeParse({
        ...base,
        datasetVersion: '115',
        academicYear: '2026-27',
      }).success,
    ).toBe(true);
    expect(
      taiwanMoeTuitionArtifactSchema.safeParse({ ...base, academicYear: '2026' }).success,
    ).toBe(false);
    expect(
      taiwanMoeTuitionArtifactSchema.safeParse({ ...base, chargePeriod: 'annual' }).success,
    ).toBe(false);
    expect(
      taiwanMoeTuitionArtifactSchema.safeParse({
        ...base,
        categories: tuitionCategoryDefinitions.slice(0, -1),
      }).success,
    ).toBe(false);
  });

  it('normalises only numeric school-code padding for exact identifier matching', () => {
    expect(canonicalTaiwanMoeSchoolCode('0001')).toBe('1');
    expect(canonicalTaiwanMoeSchoolCode('1')).toBe('1');
    expect(canonicalTaiwanMoeSchoolCode('1r02')).toBe('1R02');
    expect(() => canonicalTaiwanMoeSchoolCode('school 1')).toThrow(/Invalid Taiwan MOE/u);
  });

  it('maps only reviewed, unambiguous degree levels into the concise program model', () => {
    const record: TaiwanMoeDepartmentRecord = {
      sourceRow: 1,
      unitCode: '01111001',
      unitName: '教育學系',
      attendance: { code: 'D', label: '日' },
      recordKind: 'qualification',
      qualification: { code: 'D', label: '博士' },
      studentCount: 103,
      fullTimeTeacherCount: 0,
      previousAcademicYearGraduateCount: 13,
    };
    expect(toTaiwanMoeProgramCandidate(record)).toEqual({
      name: '教育學系',
      level: 'graduate',
      field: 'MOE 01111001 · D 博士',
    });
    expect(programLevelForTaiwanMoeQualification('B')).toBe('undergraduate');
    expect(programLevelForTaiwanMoeQualification('X')).toBeNull();
    expect(
      toTaiwanMoeProgramCandidate({
        ...record,
        recordKind: 'organizational_unit',
        qualification: null,
      }),
    ).toBeNull();
  });

  it('maps positive official tuition bases without inventing a charge period', () => {
    expect(
      toTaiwanMoeCostCandidate({
        categoryCode: 'undergraduate_business_college',
        amountTwd: 24_890,
      }),
    ).toMatchObject({
      level: 'undergraduate',
      category: 'tuition_and_fees',
      period: 'other',
      scenario: 'undergraduate_business_college',
      amount: 24_890,
      currency: 'TWD',
      sourceStudyScope: 'daytime_undergraduate',
    });
  });
});
