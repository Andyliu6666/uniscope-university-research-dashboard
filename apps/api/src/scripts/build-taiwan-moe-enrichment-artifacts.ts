import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { format } from 'prettier';
import { z } from 'zod';
import {
  classifyDepartmentRecord,
  nonNegativeInteger,
  parseTuitionCell,
  splitCodeLabel,
  taiwanMoeDepartmentArtifactSchema,
  taiwanMoeEnrichmentManifestSchema,
  taiwanMoeEnrichmentSourceReviewSchema,
  taiwanMoeTuitionArtifactSchema,
  tuitionCategoryDefinitions,
  type TaiwanMoeDepartmentArtifact,
  type TaiwanMoeTuitionArtifact,
  type TuitionCategoryCode,
} from './taiwan-moe-enrichment-format.js';

/**
 * Build compact, deterministic Taiwan MOE enrichment artifacts.
 *
 * Raw inputs are supplied explicitly because their reviewed byte-for-byte source
 * snapshots are intentionally not duplicated in the repository.
 *
 * Usage:
 *   pnpm --filter @urd/api build:taiwan-moe-enrichment <programs.json> <tuition.csv> [output-directory]
 */

const rawArguments = process.argv.slice(2);
if (rawArguments[0] === '--') rawArguments.shift();
const [departmentInputArgument, tuitionInputArgument, outputDirectoryArgument] = rawArguments;
if (!departmentInputArgument || !tuitionInputArgument || rawArguments.length > 3) {
  throw new Error(
    'Usage: pnpm --filter @urd/api build:taiwan-moe-enrichment <programs.json> <tuition.csv> [output-directory]',
  );
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(scriptDirectory, '../../../../data/sources');
const sourceReviewPath = resolve(sourceDirectory, 'taiwan-moe-enrichment-source-review.json');
const outputDirectory = resolve(outputDirectoryArgument ?? sourceDirectory);
const departmentInputPath = resolve(departmentInputArgument);
const tuitionInputPath = resolve(tuitionInputArgument);
const departmentDatasetFile = 'taiwan-moe-departments-114.json';
const tuitionDatasetFile = 'taiwan-moe-tuition-114.json';
const manifestFile = 'taiwan-moe-enrichment-artifacts.json';
const departmentOutputPath = resolve(outputDirectory, departmentDatasetFile);
const tuitionOutputPath = resolve(outputDirectory, tuitionDatasetFile);
const manifestOutputPath = resolve(outputDirectory, manifestFile);

const departmentSourceRowSchema = z
  .object({
    學年度: z.string().regex(/^\d{3}$/u),
    學校代碼: z.string().regex(/^[0-9A-Z]+$/u),
    學校名稱: z.string().min(2),
    科系代碼: z.string().min(1),
    科系名稱: z.string().min(1),
    '日間∕進修別': z.string().min(1),
    等級別: z.string(),
    學生數: z.string(),
    教師數: z.string(),
    上學年度畢業生數: z.string(),
    縣市名稱: z.string().min(1),
    體系別: z.string().min(1),
  })
  .passthrough();

const tuitionSourceRowSchema = z
  .object({
    學年度: z.string().regex(/^\d{3}$/u),
    設立別: z.string().min(1),
    學校類別: z.string().min(1),
    學校統計處代碼: z.string().regex(/^[0-9A-Z]+$/u),
    學校名稱: z.string().min(2),
  })
  .passthrough();

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const jsonFormatOptions = { parser: 'json' as const, printWidth: 100 };

const verifyReviewedInput = (
  path: string,
  bytes: Buffer,
  source: {
    downloadFile: string;
    downloadSha256: string;
    downloadBytes: number;
  },
) => {
  if (basename(path) !== source.downloadFile) {
    throw new Error(
      `Refusing unreviewed input name: expected ${source.downloadFile}, received ${basename(path)}.`,
    );
  }
  if (bytes.byteLength !== source.downloadBytes) {
    throw new Error(
      `Refusing unreviewed ${source.downloadFile}: expected ${source.downloadBytes} bytes, received ${bytes.byteLength}.`,
    );
  }
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== source.downloadSha256) {
    throw new Error(
      `Refusing unreviewed ${source.downloadFile}: expected SHA-256 ${source.downloadSha256}, received ${actualSha256}.`,
    );
  }
};

const reviewResult = taiwanMoeEnrichmentSourceReviewSchema.safeParse(
  JSON.parse(await readFile(sourceReviewPath, 'utf8')) as unknown,
);
if (!reviewResult.success) {
  throw new Error(
    `Invalid Taiwan MOE enrichment source review: ${z.prettifyError(reviewResult.error)}`,
  );
}
const review = reviewResult.data;
const [departmentSource, tuitionSource] = review.sources;
const [departmentBytes, tuitionBytes] = await Promise.all([
  readFile(departmentInputPath),
  readFile(tuitionInputPath),
]);
verifyReviewedInput(departmentInputPath, departmentBytes, departmentSource);
verifyReviewedInput(tuitionInputPath, tuitionBytes, tuitionSource);

const rawDepartmentJson = z.array(z.unknown()).parse(JSON.parse(departmentBytes.toString('utf8')));
if (rawDepartmentJson.length !== departmentSource.downloadRows) {
  throw new Error(
    `Department source has ${rawDepartmentJson.length} rows; review expects ${departmentSource.downloadRows}.`,
  );
}

type DepartmentSchool = TaiwanMoeDepartmentArtifact['schools'][number];
const departmentSchoolsByCode = new Map<string, DepartmentSchool>();
let selectedDepartmentRows = 0;
let qualificationRecordCount = 0;
let organizationalUnitRecordCount = 0;
const sourceReportedZeroCounts = {
  students: 0,
  fullTimeTeachers: 0,
  previousAcademicYearGraduates: 0,
};

for (const [index, raw] of rawDepartmentJson.entries()) {
  if (typeof raw !== 'object' || raw === null || !('學年度' in raw)) {
    throw new Error(`Department source row ${index + 1} has no academic year.`);
  }
  if ((raw as Record<string, unknown>).學年度 !== '114') continue;
  const sourceRow = index + 1;
  const parsed = departmentSourceRowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid department source row ${sourceRow}: ${z.prettifyError(parsed.error)}`);
  }
  const row = parsed.data;
  const studentCount = nonNegativeInteger(row.學生數, '學生數', sourceRow);
  const fullTimeTeacherCount = nonNegativeInteger(row.教師數, '教師數', sourceRow);
  const previousAcademicYearGraduateCount = nonNegativeInteger(
    row.上學年度畢業生數,
    '上學年度畢業生數',
    sourceRow,
  );
  const classification = classifyDepartmentRecord(
    row.等級別,
    studentCount,
    previousAcademicYearGraduateCount,
  );
  if (classification.recordKind === 'qualification') qualificationRecordCount += 1;
  else organizationalUnitRecordCount += 1;
  if (studentCount === 0) sourceReportedZeroCounts.students += 1;
  if (fullTimeTeacherCount === 0) sourceReportedZeroCounts.fullTimeTeachers += 1;
  if (previousAcademicYearGraduateCount === 0) {
    sourceReportedZeroCounts.previousAcademicYearGraduates += 1;
  }

  const schoolCode = row.學校代碼.trim();
  const chineseName = row.學校名稱.trim();
  const county = splitCodeLabel(row.縣市名稱, 'county');
  const system = splitCodeLabel(row.體系別, 'system');
  const existingSchool = departmentSchoolsByCode.get(schoolCode);
  if (
    existingSchool &&
    (existingSchool.chineseName !== chineseName ||
      existingSchool.county.code !== county.code ||
      existingSchool.county.label !== county.label ||
      existingSchool.system.code !== system.code ||
      existingSchool.system.label !== system.label)
  ) {
    throw new Error(
      `School code ${schoolCode} has conflicting identity fields at source row ${sourceRow}.`,
    );
  }
  const school: DepartmentSchool = existingSchool ?? {
    schoolCode,
    chineseName,
    county,
    system,
    records: [],
  };
  school.records.push({
    sourceRow,
    unitCode: row.科系代碼.trim(),
    unitName: row.科系名稱.trim(),
    attendance: splitCodeLabel(row['日間∕進修別'], 'attendance'),
    recordKind: classification.recordKind,
    qualification: classification.qualification,
    studentCount,
    fullTimeTeacherCount,
    previousAcademicYearGraduateCount,
  });
  departmentSchoolsByCode.set(schoolCode, school);
  selectedDepartmentRows += 1;
}

if (selectedDepartmentRows !== departmentSource.selectedRows) {
  throw new Error(
    `Department source selected ${selectedDepartmentRows} year-114 rows; review expects ${departmentSource.selectedRows}.`,
  );
}
if (departmentSchoolsByCode.size !== departmentSource.selectedSchools) {
  throw new Error(
    `Department source selected ${departmentSchoolsByCode.size} schools; review expects ${departmentSource.selectedSchools}.`,
  );
}

const departmentArtifact = taiwanMoeDepartmentArtifactSchema.parse({
  schemaVersion: 1,
  datasetVersion: '114',
  academicYear: '2025-26',
  generatedAt: review.retrievedAt,
  selectedSourceRows: selectedDepartmentRows,
  schoolCount: departmentSchoolsByCode.size,
  qualificationRecordCount,
  organizationalUnitRecordCount,
  sourceReportedZeroCounts,
  schools: [...departmentSchoolsByCode.values()]
    .sort((left, right) => compareText(left.schoolCode, right.schoolCode))
    .map((school) => ({
      ...school,
      records: school.records.sort((left, right) => left.sourceRow - right.sourceRow),
    })),
});

const rawTuitionRows = parse(tuitionBytes, {
  columns: true,
  bom: true,
  skip_empty_lines: true,
  relax_column_count: false,
}) as unknown[];
if (rawTuitionRows.length !== tuitionSource.downloadRows) {
  throw new Error(
    `Tuition source has ${rawTuitionRows.length} rows; review expects ${tuitionSource.downloadRows}.`,
  );
}

const ownershipBySource = { 公立: 'public', 私立: 'private' } as const;
const categoryBySource = {
  一般大學: 'general_university',
  技專校院: 'technical_college',
  宗教研修學院: 'religious_college',
} as const;
type TuitionSchool = TaiwanMoeTuitionArtifact['schools'][number];
const tuitionSchoolsByCode = new Map<string, TuitionSchool>();
let selectedTuitionRows = 0;
let sourceReportedPositiveAmountCount = 0;
let sourceReportedZeroCount = 0;
let sourceBlankCount = 0;

for (const [index, raw] of rawTuitionRows.entries()) {
  if (typeof raw !== 'object' || raw === null || !('學年度' in raw)) {
    throw new Error(`Tuition source row ${index + 1} has no academic year.`);
  }
  if ((raw as Record<string, unknown>).學年度 !== '114') continue;
  const sourceRow = index + 1;
  const parsed = tuitionSourceRowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid tuition source row ${sourceRow}: ${z.prettifyError(parsed.error)}`);
  }
  const row = parsed.data;
  const ownership = ownershipBySource[row.設立別 as keyof typeof ownershipBySource];
  const institutionCategory = categoryBySource[row.學校類別 as keyof typeof categoryBySource];
  if (!ownership) throw new Error(`Unreviewed ownership at tuition source row ${sourceRow}.`);
  if (!institutionCategory) {
    throw new Error(`Unreviewed institution category at tuition source row ${sourceRow}.`);
  }
  const schoolCode = row.學校統計處代碼.trim();
  if (tuitionSchoolsByCode.has(schoolCode)) {
    throw new Error(`Duplicate year-114 tuition school code ${schoolCode}.`);
  }
  const fees: TuitionSchool['fees'] = [];
  const sourceReportedZeroCategoryCodes: TuitionCategoryCode[] = [];
  const sourceBlankCategoryCodes: TuitionCategoryCode[] = [];
  for (const definition of tuitionCategoryDefinitions) {
    const rawValue = row[definition.sourceColumn];
    if (typeof rawValue !== 'string') {
      throw new Error(
        `Missing reviewed tuition column ${definition.sourceColumn} at source row ${sourceRow}.`,
      );
    }
    const cell = parseTuitionCell(rawValue, definition.sourceColumn, sourceRow);
    if (cell.kind === 'amount') {
      fees.push({ categoryCode: definition.code, amountTwd: cell.amountTwd });
      sourceReportedPositiveAmountCount += 1;
    } else if (cell.kind === 'reported_zero') {
      sourceReportedZeroCategoryCodes.push(definition.code);
      sourceReportedZeroCount += 1;
    } else {
      sourceBlankCategoryCodes.push(definition.code);
      sourceBlankCount += 1;
    }
  }
  if (
    fees.length + sourceReportedZeroCategoryCodes.length + sourceBlankCategoryCodes.length !==
    tuitionCategoryDefinitions.length
  ) {
    throw new Error(`Tuition cells were not fully partitioned at source row ${sourceRow}.`);
  }
  tuitionSchoolsByCode.set(schoolCode, {
    sourceRow,
    schoolCode,
    chineseName: row.學校名稱.trim(),
    ownership,
    institutionCategory,
    fees,
    sourceReportedZeroCategoryCodes,
    sourceBlankCategoryCodes,
  });
  selectedTuitionRows += 1;
}

if (selectedTuitionRows !== tuitionSource.selectedRows) {
  throw new Error(
    `Tuition source selected ${selectedTuitionRows} year-114 rows; review expects ${tuitionSource.selectedRows}.`,
  );
}
if (tuitionSchoolsByCode.size !== tuitionSource.selectedSchools) {
  throw new Error(
    `Tuition source selected ${tuitionSchoolsByCode.size} schools; review expects ${tuitionSource.selectedSchools}.`,
  );
}

const tuitionArtifact = taiwanMoeTuitionArtifactSchema.parse({
  schemaVersion: 1,
  datasetVersion: '114',
  academicYear: '2025-26',
  generatedAt: review.retrievedAt,
  selectedSourceRows: selectedTuitionRows,
  schoolCount: tuitionSchoolsByCode.size,
  currency: 'TWD',
  amountMeaning: 'tuition_and_miscellaneous_fee_basis',
  chargePeriod: 'not_specified_by_source',
  referenceDateRule: 'annual October 15 statistical reference date',
  sourceReportedPositiveAmountCount,
  sourceReportedZeroCount,
  sourceBlankCount,
  categories: tuitionCategoryDefinitions,
  schools: [...tuitionSchoolsByCode.values()].sort((left, right) =>
    compareText(left.schoolCode, right.schoolCode),
  ),
});

const formattedDepartmentArtifact = await format(
  JSON.stringify(departmentArtifact),
  jsonFormatOptions,
);
const formattedTuitionArtifact = await format(JSON.stringify(tuitionArtifact), jsonFormatOptions);
const departmentArtifactMetadata = {
  role: 'department_overview' as const,
  datasetFile: departmentDatasetFile,
  datasetSha256: sha256(formattedDepartmentArtifact),
  datasetBytes: Buffer.byteLength(formattedDepartmentArtifact, 'utf8'),
  datasetVersion: '114' as const,
  selectedRows: departmentArtifact.selectedSourceRows,
  schoolCount: departmentArtifact.schoolCount,
};
const tuitionArtifactMetadata = {
  role: 'tuition_fee_basis' as const,
  datasetFile: tuitionDatasetFile,
  datasetSha256: sha256(formattedTuitionArtifact),
  datasetBytes: Buffer.byteLength(formattedTuitionArtifact, 'utf8'),
  datasetVersion: '114' as const,
  selectedRows: tuitionArtifact.selectedSourceRows,
  schoolCount: tuitionArtifact.schoolCount,
};
const manifest = taiwanMoeEnrichmentManifestSchema.parse({
  ...review,
  generatedArtifacts: [departmentArtifactMetadata, tuitionArtifactMetadata],
});
const formattedManifest = await format(JSON.stringify(manifest), jsonFormatOptions);

await mkdir(outputDirectory, { recursive: true });
const outputs = [
  [departmentOutputPath, formattedDepartmentArtifact],
  [tuitionOutputPath, formattedTuitionArtifact],
  [manifestOutputPath, formattedManifest],
] as const;
for (const [path, contents] of outputs) {
  const temporaryPath = `${path}.tmp`;
  await rm(temporaryPath, { force: true });
  await writeFile(temporaryPath, contents, 'utf8');
  await rename(temporaryPath, path);
}

console.log(
  `Built ${departmentDatasetFile}: ${departmentArtifact.schoolCount} schools, ${departmentArtifact.selectedSourceRows} rows, SHA-256 ${departmentArtifactMetadata.datasetSha256}.`,
);
console.log(
  `Built ${tuitionDatasetFile}: ${tuitionArtifact.schoolCount} schools, ${tuitionArtifact.selectedSourceRows} rows, ${sourceReportedPositiveAmountCount} positive amounts, ${sourceReportedZeroCount} source zeros, ${sourceBlankCount} blanks, SHA-256 ${tuitionArtifactMetadata.datasetSha256}.`,
);
console.log(`Wrote reviewed manifest ${manifestFile}.`);
