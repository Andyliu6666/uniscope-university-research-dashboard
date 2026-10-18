import { z } from 'zod';

const taiwanMoeAcademicYearSchema = z.string().regex(/^\d{3}$/u);
const academicYearSchema = z.string().regex(/^\d{4}-\d{2}$/u);

const reviewedSourceBaseSchema = z.object({
  datasetId: z.string().regex(/^\d+$/u),
  datasetTitle: z.string().min(1),
  datasetPageUrl: z.string().url().startsWith('https://data.gov.tw/dataset/'),
  downloadUrl: z.string().url().startsWith('https://'),
  publisher: z.string().min(1),
  datasetPageMetadataUpdatedAt: z.iso.datetime({ offset: true }),
  downloadLastModifiedAt: z.iso.datetime(),
  downloadFile: z.string().min(1),
  downloadSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  downloadBytes: z.number().int().positive(),
  downloadRows: z.number().int().positive(),
  datasetVersion: z.string().min(1),
  selectedAcademicYear: taiwanMoeAcademicYearSchema,
  selectedRows: z.number().int().positive(),
  selectedSchools: z.number().int().positive(),
  notes: z.string().min(1),
});

export const taiwanMoeEnrichmentSourceReviewSchema = z.object({
  schemaVersion: z.literal(1),
  retrievedAt: z.iso.datetime(),
  license: z.object({
    name: z.literal('Open Government Data License, version 1.0'),
    url: z.literal('https://data.gov.tw/license'),
  }),
  sources: z.tuple([
    reviewedSourceBaseSchema.extend({ role: z.literal('department_overview') }),
    reviewedSourceBaseSchema.extend({ role: z.literal('tuition_fee_basis') }),
  ]),
});

export const codeLabelSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
});

const qualificationSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
});

const departmentRecordSchema = z.object({
  sourceRow: z.number().int().positive(),
  unitCode: z.string().min(1),
  unitName: z.string().min(1),
  attendance: codeLabelSchema,
  recordKind: z.enum(['qualification', 'organizational_unit']),
  qualification: qualificationSchema.nullable(),
  studentCount: z.number().int().nonnegative(),
  fullTimeTeacherCount: z.number().int().nonnegative(),
  previousAcademicYearGraduateCount: z.number().int().nonnegative(),
});

export const taiwanMoeDepartmentArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetVersion: taiwanMoeAcademicYearSchema,
    academicYear: academicYearSchema,
    generatedAt: z.iso.datetime(),
    selectedSourceRows: z.number().int().positive(),
    schoolCount: z.number().int().positive(),
    qualificationRecordCount: z.number().int().nonnegative(),
    organizationalUnitRecordCount: z.number().int().nonnegative(),
    sourceReportedZeroCounts: z.object({
      students: z.number().int().nonnegative(),
      fullTimeTeachers: z.number().int().nonnegative(),
      previousAcademicYearGraduates: z.number().int().nonnegative(),
    }),
    schools: z.array(
      z.object({
        schoolCode: z.string().regex(/^[0-9A-Z]+$/u),
        chineseName: z.string().min(2),
        county: codeLabelSchema,
        system: codeLabelSchema,
        records: z.array(departmentRecordSchema).min(1),
      }),
    ),
  })
  .superRefine((artifact, context) => {
    const records = artifact.schools.flatMap((school) => school.records);
    const qualificationRecords = records.filter((record) => record.recordKind === 'qualification');
    const organizationalUnitRecords = records.filter(
      (record) => record.recordKind === 'organizational_unit',
    );
    const invariant = (matches: boolean, path: (string | number)[], message: string) => {
      if (!matches) context.addIssue({ code: 'custom', path, message });
    };
    invariant(
      artifact.schoolCount === artifact.schools.length,
      ['schoolCount'],
      'schoolCount must equal the number of schools.',
    );
    invariant(
      artifact.selectedSourceRows === records.length,
      ['selectedSourceRows'],
      'selectedSourceRows must equal the number of department records.',
    );
    invariant(
      artifact.qualificationRecordCount === qualificationRecords.length,
      ['qualificationRecordCount'],
      'qualificationRecordCount must equal the number of qualification records.',
    );
    invariant(
      artifact.organizationalUnitRecordCount === organizationalUnitRecords.length,
      ['organizationalUnitRecordCount'],
      'organizationalUnitRecordCount must equal the number of organizational-unit records.',
    );
    invariant(
      artifact.sourceReportedZeroCounts.students ===
        records.filter((record) => record.studentCount === 0).length,
      ['sourceReportedZeroCounts', 'students'],
      'The student zero count must equal the source-reported zero records.',
    );
    invariant(
      artifact.sourceReportedZeroCounts.fullTimeTeachers ===
        records.filter((record) => record.fullTimeTeacherCount === 0).length,
      ['sourceReportedZeroCounts', 'fullTimeTeachers'],
      'The teacher zero count must equal the source-reported zero records.',
    );
    invariant(
      artifact.sourceReportedZeroCounts.previousAcademicYearGraduates ===
        records.filter((record) => record.previousAcademicYearGraduateCount === 0).length,
      ['sourceReportedZeroCounts', 'previousAcademicYearGraduates'],
      'The graduate zero count must equal the source-reported zero records.',
    );
    invariant(
      new Set(artifact.schools.map((school) => school.schoolCode)).size === artifact.schools.length,
      ['schools'],
      'School codes must be unique.',
    );
    invariant(
      new Set(records.map((record) => record.sourceRow)).size === records.length,
      ['schools'],
      'Department source rows must be unique.',
    );
    for (const [schoolIndex, school] of artifact.schools.entries()) {
      for (const [recordIndex, record] of school.records.entries()) {
        invariant(
          (record.recordKind === 'qualification') === (record.qualification !== null),
          ['schools', schoolIndex, 'records', recordIndex, 'qualification'],
          'Only qualification records may carry a qualification.',
        );
      }
    }
  });

export const tuitionCategoryCodes = [
  'undergraduate_medicine',
  'undergraduate_dentistry',
  'undergraduate_medical_college',
  'undergraduate_engineering_college',
  'undergraduate_science_agriculture_college',
  'undergraduate_business_college',
  'undergraduate_humanities_law_college',
  'undergraduate_other',
  'associate_nursing',
  'associate_health',
  'associate_home_economics',
  'associate_business',
  'associate_industrial',
  'associate_agriculture_food',
  'associate_hospitality',
  'associate_arts_design',
] as const;

export const tuitionCategoryCodeSchema = z.enum(tuitionCategoryCodes);
export type TuitionCategoryCode = z.infer<typeof tuitionCategoryCodeSchema>;

export const tuitionCategoryDefinitions: ReadonlyArray<{
  code: TuitionCategoryCode;
  sourceColumn: string;
  studyScope: 'daytime_undergraduate' | 'daytime_associate';
  label: string;
}> = [
  {
    code: 'undergraduate_medicine',
    sourceColumn: '日間學制學士班學雜費收費基準-醫學系',
    studyScope: 'daytime_undergraduate',
    label: '醫學系',
  },
  {
    code: 'undergraduate_dentistry',
    sourceColumn: '日間學制學士班學雜費收費基準-牙醫學系',
    studyScope: 'daytime_undergraduate',
    label: '牙醫學系',
  },
  {
    code: 'undergraduate_medical_college',
    sourceColumn: '日間學制學士班學雜費收費基準-醫學院',
    studyScope: 'daytime_undergraduate',
    label: '醫學院',
  },
  {
    code: 'undergraduate_engineering_college',
    sourceColumn: '日間學制學士班學雜費收費基準-工學院',
    studyScope: 'daytime_undergraduate',
    label: '工學院',
  },
  {
    code: 'undergraduate_science_agriculture_college',
    sourceColumn: '日間學制學士班學雜費收費基準-理農學院',
    studyScope: 'daytime_undergraduate',
    label: '理農學院',
  },
  {
    code: 'undergraduate_business_college',
    sourceColumn: '日間學制學士班學雜費收費基準-商學院',
    studyScope: 'daytime_undergraduate',
    label: '商學院',
  },
  {
    code: 'undergraduate_humanities_law_college',
    sourceColumn: '日間學制學士班學雜費收費基準-文法學院',
    studyScope: 'daytime_undergraduate',
    label: '文法學院',
  },
  {
    code: 'undergraduate_other',
    sourceColumn: '日間學制學士班學雜費收費基準-其他',
    studyScope: 'daytime_undergraduate',
    label: '其他',
  },
  {
    code: 'associate_nursing',
    sourceColumn: '日間學制副學士學雜費收費基準(五專後2年、二專)-護理類',
    studyScope: 'daytime_associate',
    label: '護理類',
  },
  {
    code: 'associate_health',
    sourceColumn: '日間學制副學士學雜費收費基準(五專後2年、二專)-衛生類',
    studyScope: 'daytime_associate',
    label: '衛生類',
  },
  {
    code: 'associate_home_economics',
    sourceColumn: '日間學制副學士學雜費收費基準(五專後2年、二專)-家事類',
    studyScope: 'daytime_associate',
    label: '家事類',
  },
  {
    code: 'associate_business',
    sourceColumn: '日間學制副學士學雜費收費基準(五專後2年、二專)-商業類',
    studyScope: 'daytime_associate',
    label: '商業類',
  },
  {
    code: 'associate_industrial',
    sourceColumn: '日間學制副學士學雜費收費基準(五專後2年、二專)-工業類',
    studyScope: 'daytime_associate',
    label: '工業類',
  },
  {
    code: 'associate_agriculture_food',
    sourceColumn: '日間學制副學士學雜費收費基準(五專後2年、二專)-農業與食品類',
    studyScope: 'daytime_associate',
    label: '農業與食品類',
  },
  {
    code: 'associate_hospitality',
    sourceColumn: '日間學制副學士學雜費收費基準(五專後2年、二專)-餐旅類',
    studyScope: 'daytime_associate',
    label: '餐旅類',
  },
  {
    code: 'associate_arts_design',
    sourceColumn: '日間學制副學士學雜費收費基準(五專後2年、二專)-藝術與設計類',
    studyScope: 'daytime_associate',
    label: '藝術與設計類',
  },
];

export const taiwanMoeTuitionArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetVersion: taiwanMoeAcademicYearSchema,
    academicYear: academicYearSchema,
    generatedAt: z.iso.datetime(),
    selectedSourceRows: z.number().int().positive(),
    schoolCount: z.number().int().positive(),
    currency: z.literal('TWD'),
    amountMeaning: z.literal('tuition_and_miscellaneous_fee_basis'),
    chargePeriod: z.literal('not_specified_by_source'),
    referenceDateRule: z.literal('annual October 15 statistical reference date'),
    sourceReportedPositiveAmountCount: z.number().int().nonnegative(),
    sourceReportedZeroCount: z.number().int().nonnegative(),
    sourceBlankCount: z.number().int().nonnegative(),
    categories: z
      .array(
        z.object({
          code: tuitionCategoryCodeSchema,
          sourceColumn: z.string().min(1),
          studyScope: z.enum(['daytime_undergraduate', 'daytime_associate']),
          label: z.string().min(1),
        }),
      )
      .length(tuitionCategoryDefinitions.length),
    schools: z.array(
      z.object({
        sourceRow: z.number().int().positive(),
        schoolCode: z.string().regex(/^[0-9A-Z]+$/u),
        chineseName: z.string().min(2),
        ownership: z.enum(['public', 'private']),
        institutionCategory: z.enum([
          'general_university',
          'technical_college',
          'religious_college',
        ]),
        fees: z.array(
          z.object({
            categoryCode: tuitionCategoryCodeSchema,
            amountTwd: z.number().int().positive(),
          }),
        ),
        sourceReportedZeroCategoryCodes: z.array(tuitionCategoryCodeSchema),
        sourceBlankCategoryCodes: z.array(tuitionCategoryCodeSchema),
      }),
    ),
  })
  .superRefine((artifact, context) => {
    const invariant = (matches: boolean, path: (string | number)[], message: string) => {
      if (!matches) context.addIssue({ code: 'custom', path, message });
    };
    invariant(
      artifact.schoolCount === artifact.schools.length,
      ['schoolCount'],
      'schoolCount must equal the number of schools.',
    );
    invariant(
      artifact.selectedSourceRows === artifact.schools.length,
      ['selectedSourceRows'],
      'selectedSourceRows must equal the number of tuition school rows.',
    );
    invariant(
      new Set(artifact.schools.map((school) => school.schoolCode)).size === artifact.schools.length,
      ['schools'],
      'School codes must be unique.',
    );
    invariant(
      new Set(artifact.schools.map((school) => school.sourceRow)).size === artifact.schools.length,
      ['schools'],
      'Tuition source rows must be unique.',
    );
    invariant(
      JSON.stringify(artifact.categories) === JSON.stringify(tuitionCategoryDefinitions),
      ['categories'],
      'Tuition categories must exactly match the reviewed source columns.',
    );
    const positiveCount = artifact.schools.reduce((total, school) => total + school.fees.length, 0);
    const zeroCount = artifact.schools.reduce(
      (total, school) => total + school.sourceReportedZeroCategoryCodes.length,
      0,
    );
    const blankCount = artifact.schools.reduce(
      (total, school) => total + school.sourceBlankCategoryCodes.length,
      0,
    );
    invariant(
      artifact.sourceReportedPositiveAmountCount === positiveCount,
      ['sourceReportedPositiveAmountCount'],
      'The positive-amount count must equal the stored positive fee cells.',
    );
    invariant(
      artifact.sourceReportedZeroCount === zeroCount,
      ['sourceReportedZeroCount'],
      'The zero count must equal the separately retained source-zero cells.',
    );
    invariant(
      artifact.sourceBlankCount === blankCount,
      ['sourceBlankCount'],
      'The blank count must equal the separately retained blank cells.',
    );
    for (const [schoolIndex, school] of artifact.schools.entries()) {
      const categoryCodes = [
        ...school.fees.map((fee) => fee.categoryCode),
        ...school.sourceReportedZeroCategoryCodes,
        ...school.sourceBlankCategoryCodes,
      ];
      invariant(
        categoryCodes.length === tuitionCategoryCodes.length &&
          new Set(categoryCodes).size === tuitionCategoryCodes.length &&
          tuitionCategoryCodes.every((code) => categoryCodes.includes(code)),
        ['schools', schoolIndex],
        'Every reviewed tuition category must appear exactly once as an amount, source zero, or blank.',
      );
    }
  });

const generatedArtifactBaseSchema = z.object({
  datasetFile: z.string().min(1),
  datasetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  datasetBytes: z.number().int().positive(),
  datasetVersion: taiwanMoeAcademicYearSchema,
  selectedRows: z.number().int().positive(),
  schoolCount: z.number().int().positive(),
});

export const taiwanMoeEnrichmentManifestSchema = taiwanMoeEnrichmentSourceReviewSchema.extend({
  generatedArtifacts: z.tuple([
    generatedArtifactBaseSchema.extend({ role: z.literal('department_overview') }),
    generatedArtifactBaseSchema.extend({ role: z.literal('tuition_fee_basis') }),
  ]),
});

export type TaiwanMoeDepartmentArtifact = z.infer<typeof taiwanMoeDepartmentArtifactSchema>;
export type TaiwanMoeTuitionArtifact = z.infer<typeof taiwanMoeTuitionArtifactSchema>;
export type TaiwanMoeEnrichmentManifest = z.infer<typeof taiwanMoeEnrichmentManifestSchema>;
export type TaiwanMoeDepartmentRecord =
  TaiwanMoeDepartmentArtifact['schools'][number]['records'][number];
export type TaiwanMoeTuitionFee = TaiwanMoeTuitionArtifact['schools'][number]['fees'][number];

export const splitCodeLabel = (value: string, field: string) => {
  const match = /^(\S+)\s+(.+)$/u.exec(value.trim());
  if (!match) throw new Error(`${field} is not a reviewed code-label value: ${value}`);
  return codeLabelSchema.parse({ code: match[1], label: match[2] });
};

export const nonNegativeInteger = (value: string, field: string, sourceRow: number) => {
  const text = value.trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) {
    throw new Error(`${field} is not a non-negative integer at source row ${sourceRow}.`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed > 2_147_483_647) {
    throw new Error(`${field} is outside the PostgreSQL integer range at source row ${sourceRow}.`);
  }
  return parsed;
};

export const classifyDepartmentRecord = (
  qualificationLabel: string,
  studentCount: number,
  previousAcademicYearGraduateCount: number,
) => {
  const text = qualificationLabel.trim();
  if (!text) {
    if (studentCount !== 0 || previousAcademicYearGraduateCount !== 0) {
      throw new Error('An empty qualification label cannot carry students or graduates.');
    }
    return { recordKind: 'organizational_unit' as const, qualification: null };
  }
  const qualification = splitCodeLabel(text, 'qualification label');
  const allowed = new Set(['D', 'M', 'B', 'C', '2', '5', 'X']);
  if (!allowed.has(qualification.code)) {
    throw new Error(`Unreviewed qualification code: ${qualification.code}`);
  }
  return { recordKind: 'qualification' as const, qualification };
};

export type TuitionCell =
  { kind: 'amount'; amountTwd: number } | { kind: 'reported_zero' } | { kind: 'blank' };

export const parseTuitionCell = (value: string, field: string, sourceRow: number): TuitionCell => {
  const text = value.trim();
  if (!text) return { kind: 'blank' };
  if (!/^(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+)$/u.test(text)) {
    throw new Error(`${field} is not a reviewed TWD integer at source row ${sourceRow}.`);
  }
  const parsed = Number(text.replaceAll(',', ''));
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `${field} is outside the JavaScript safe-integer range at source row ${sourceRow}.`,
    );
  }
  return parsed === 0 ? { kind: 'reported_zero' } : { kind: 'amount', amountTwd: parsed };
};

/**
 * MOE sources disagree only on numeric zero-padding (for example `1` versus
 * `0001`). Canonicalisation removes that presentation difference without
 * changing alphanumeric identifiers or using a name as identity evidence.
 */
export const canonicalTaiwanMoeSchoolCode = (value: string) => {
  const code = value.trim().toUpperCase();
  if (!/^[0-9A-Z]+$/u.test(code)) throw new Error(`Invalid Taiwan MOE school code: ${value}`);
  return /^\d+$/u.test(code) ? code.replace(/^0+(?=\d)/u, '') : code;
};

export const programLevelForTaiwanMoeQualification = (
  qualificationCode: string,
): 'undergraduate' | 'graduate' | null => {
  if (qualificationCode === 'D' || qualificationCode === 'M') return 'graduate';
  if (['B', 'C', '2', '5'].includes(qualificationCode)) return 'undergraduate';
  return null;
};

export const toTaiwanMoeProgramCandidate = (record: TaiwanMoeDepartmentRecord) => {
  if (record.recordKind !== 'qualification' || !record.qualification) return null;
  const level = programLevelForTaiwanMoeQualification(record.qualification.code);
  if (!level) return null;
  return {
    name: record.unitName,
    level,
    field: `MOE ${record.unitCode} · ${record.qualification.code} ${record.qualification.label}`,
  };
};

export const toTaiwanMoeCostCandidate = (fee: TaiwanMoeTuitionFee) => {
  const definition = tuitionCategoryDefinitions.find(({ code }) => code === fee.categoryCode);
  if (!definition) throw new Error(`Unknown reviewed tuition category: ${fee.categoryCode}`);
  return {
    level: 'undergraduate' as const,
    applicantType: 'all' as const,
    residency: 'all' as const,
    category: 'tuition_and_fees' as const,
    period: 'other' as const,
    scenario: definition.code,
    amount: fee.amountTwd,
    currency: 'TWD' as const,
    sourceCategoryLabel: definition.label,
    sourceStudyScope: definition.studyScope,
    sourceColumn: definition.sourceColumn,
  };
};
