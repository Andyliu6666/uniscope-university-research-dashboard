import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { format } from 'prettier';
import { z } from 'zod';
import {
  classifyDirectoryName,
  cleanText,
  normaliseOfficialUrl,
  qualificationDefinition,
  taiwanMoeArtifactSchema,
  taiwanMoeSourceReviewSchema,
  type TaiwanMoeArtifact,
} from './taiwan-moe-format.js';

/**
 * Build the compact, deterministic Taiwan MOE 114-academic-year artifact.
 *
 * The old 108 directory is never treated as the current institution list.
 * The 114 enrollment rows define current scope; directory names that represent
 * a real rename/merge are marked conflict for the importer to reject safely.
 *
 * Usage:
 *   pnpm --filter @urd/api exec tsx src/scripts/build-taiwan-moe-artifact.ts
 */

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(scriptDirectory, '../../../../data/sources');
const sourceReviewPath = resolve(sourceDirectory, 'taiwan-moe-source-review.json');
const outputPath = resolve(process.argv[2] ?? resolve(sourceDirectory, 'taiwan-moe-114.json'));
const manifestPath = resolve(
  process.argv[3] ?? resolve(sourceDirectory, 'taiwan-moe-artifacts.json'),
);

const directoryRowSchema = z
  .object({
    '學校\n代碼': z.string().min(1),
    公私立: z.string(),
    體制: z.string(),
    學校名稱: z.string().min(2),
    學校英文名稱: z.string(),
    縣市別: z.string(),
    '第三級\n行政區': z.string(),
    '郵遞\n區號': z.string(),
    學校地址: z.string(),
    學校總機: z.string(),
    網址: z.string(),
  })
  .passthrough();

const studentRowSchema = z
  .object({
    學年度: z.string().regex(/^\d{3}$/u),
    學校代碼: z.string().regex(/^[0-9A-Z]+$/u),
    學校名稱: z.string().min(2),
    '日間∕進修別': z.string().min(1),
    等級別: z.string().min(1),
    總計: z.string(),
    男生計: z.string(),
    女生計: z.string(),
  })
  .passthrough();

type StudentRow = z.infer<typeof studentRowSchema> & { sourceRow: number };

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const integerCount = (value: string, field: string, row: number) => {
  const text = value.trim();
  if (!/^\d+$/u.test(text))
    throw new Error(`${field} is not a non-negative integer at row ${row}.`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed > 2_147_483_647) {
    throw new Error(`${field} is outside the PostgreSQL integer range at row ${row}.`);
  }
  return parsed;
};

const readReviewedSource = async () => {
  const parsed = taiwanMoeSourceReviewSchema.safeParse(
    JSON.parse(await readFile(sourceReviewPath, 'utf8')) as unknown,
  );
  if (!parsed.success) {
    throw new Error(`Invalid Taiwan MOE source review: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
};

const review = await readReviewedSource();
const directoryReview = review.sources.find((source) => source.role === 'directory');
const enrollmentReview = review.sources.find((source) => source.role === 'enrollment');
if (!directoryReview || !enrollmentReview) {
  throw new Error('Taiwan MOE source review must contain one directory and one enrollment source.');
}

const directoryPath = resolve(sourceDirectory, directoryReview.datasetFile);
const enrollmentPath = resolve(sourceDirectory, enrollmentReview.datasetFile);
const [directoryBytes, enrollmentBytes] = await Promise.all([
  readFile(directoryPath),
  readFile(enrollmentPath),
]);
if (sha256(directoryBytes) !== directoryReview.datasetSha256) {
  throw new Error(
    `Refusing unreviewed directory artifact: ${basename(directoryPath)} SHA mismatch.`,
  );
}
if (sha256(enrollmentBytes) !== enrollmentReview.datasetSha256) {
  throw new Error(
    `Refusing unreviewed enrollment artifact: ${basename(enrollmentPath)} SHA mismatch.`,
  );
}

const rawDirectoryRows = parse(directoryBytes, {
  columns: true,
  bom: true,
  skip_empty_lines: true,
  relax_column_count: false,
}) as unknown[];
if (rawDirectoryRows.length !== directoryReview.datasetRows) {
  throw new Error(
    `Directory has ${rawDirectoryRows.length} rows; review expects ${directoryReview.datasetRows}.`,
  );
}
const directoryByCode = new Map<string, z.infer<typeof directoryRowSchema>>();
for (const [index, raw] of rawDirectoryRows.entries()) {
  const parsed = directoryRowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid directory row ${index + 1}: ${z.prettifyError(parsed.error)}`);
  }
  const schoolCode = parsed.data['學校\n代碼'].trim();
  if (directoryByCode.has(schoolCode)) throw new Error(`Duplicate directory code: ${schoolCode}`);
  directoryByCode.set(schoolCode, parsed.data);
}

const parsedEnrollmentJson = z
  .array(z.unknown())
  .parse(JSON.parse(enrollmentBytes.toString('utf8')));
if (parsedEnrollmentJson.length !== enrollmentReview.datasetRows) {
  throw new Error(
    `Enrollment file has ${parsedEnrollmentJson.length} rows; review expects ${enrollmentReview.datasetRows}.`,
  );
}
const selectedRows: StudentRow[] = [];
for (const [index, raw] of parsedEnrollmentJson.entries()) {
  const parsed = studentRowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid enrollment row ${index + 1}: ${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.學年度 === '114') selectedRows.push({ ...parsed.data, sourceRow: index + 1 });
}
if (!selectedRows.length) throw new Error('Enrollment artifact has no academic-year 114 rows.');

const rowsBySchool = new Map<string, StudentRow[]>();
for (const row of selectedRows) {
  const rows = rowsBySchool.get(row.學校代碼) ?? [];
  rows.push(row);
  rowsBySchool.set(row.學校代碼, rows);
}

const schools: TaiwanMoeArtifact['schools'] = [];
for (const [schoolCode, rows] of [...rowsBySchool.entries()].sort(([left], [right]) =>
  left.localeCompare(right, 'en', { numeric: true }),
)) {
  const names = [...new Set(rows.map((row) => row.學校名稱.trim()))];
  if (names.length !== 1) {
    throw new Error(`School code ${schoolCode} has conflicting current names: ${names.join(', ')}`);
  }
  const chineseName = names[0] as string;
  const directory = directoryByCode.get(schoolCode);
  const directoryChineseName = cleanText(directory?.學校名稱);
  const directoryStatus = classifyDirectoryName(chineseName, directoryChineseName);
  const aggregates = new Map<
    string,
    {
      qualificationCode: string;
      qualificationLabel: string;
      population: string;
      level: 'all' | 'undergraduate' | 'graduate' | 'doctoral' | 'non_degree' | 'other';
      studentCount: number;
      menCount: number;
      womenCount: number;
      attendanceModes: Set<string>;
      sourceRows: number[];
    }
  >();
  let totalStudentCount = 0;
  let menCount = 0;
  let womenCount = 0;
  for (const row of rows) {
    const definition = qualificationDefinition(row.等級別.trim());
    if (!definition) {
      throw new Error(
        `Unreviewed qualification label at enrollment row ${row.sourceRow}: ${row.等級別}`,
      );
    }
    const total = integerCount(row.總計, '總計', row.sourceRow);
    const men = integerCount(row.男生計, '男生計', row.sourceRow);
    const women = integerCount(row.女生計, '女生計', row.sourceRow);
    if (men + women !== total) {
      throw new Error(`Gender totals do not equal total enrollment at row ${row.sourceRow}.`);
    }
    totalStudentCount += total;
    menCount += men;
    womenCount += women;
    const existing = aggregates.get(row.等級別) ?? {
      ...definition,
      qualificationLabel: row.等級別.trim().replace(/^\S+\s*/u, ''),
      studentCount: 0,
      menCount: 0,
      womenCount: 0,
      attendanceModes: new Set<string>(),
      sourceRows: [],
    };
    existing.studentCount += total;
    existing.menCount += men;
    existing.womenCount += women;
    existing.attendanceModes.add(row['日間∕進修別'].trim());
    existing.sourceRows.push(row.sourceRow);
    aggregates.set(row.等級別, existing);
  }
  if (menCount + womenCount !== totalStudentCount) {
    throw new Error(`School ${schoolCode} has inconsistent aggregate gender totals.`);
  }
  const publicPrivateText = cleanText(directory?.公私立);
  const publicPrivate =
    publicPrivateText === '公立' ? 'public' : publicPrivateText === '私立' ? 'private' : null;
  if (directory && !publicPrivate) {
    throw new Error(`Directory school ${schoolCode} has unsupported public/private value.`);
  }
  schools.push({
    schoolCode,
    chineseName,
    englishName: cleanText(directory?.學校英文名稱),
    publicPrivate,
    systemType: cleanText(directory?.體制),
    county: cleanText(directory?.縣市別),
    district: cleanText(directory?.['第三級\n行政區']),
    postalCode: cleanText(directory?.['郵遞\n區號']),
    address: cleanText(directory?.學校地址),
    phone: cleanText(directory?.學校總機),
    website: normaliseOfficialUrl(directory?.網址),
    directoryStatus,
    directoryChineseName,
    totalStudentCount,
    menCount,
    womenCount,
    sourceRows: rows.map((row) => row.sourceRow),
    enrollments: [...aggregates.values()]
      .sort((left, right) => left.population.localeCompare(right.population))
      .map((aggregate) => ({
        ...aggregate,
        attendanceModes: [...aggregate.attendanceModes].sort(),
      })),
  });
}

const artifact = taiwanMoeArtifactSchema.parse({
  schemaVersion: 1,
  datasetVersion: '114',
  reportedAcademicYear: '114',
  academicYear: '2025-26',
  generatedAt: review.retrievedAt,
  selectedSourceRows: selectedRows.length,
  schools,
});
const formattedArtifact = await format(JSON.stringify(artifact), { parser: 'json' });
await writeFile(outputPath, formattedArtifact, 'utf8');
const artifactSha256 = sha256(formattedArtifact);
const manifest = {
  ...review,
  generatedArtifact: {
    datasetFile: basename(outputPath),
    datasetSha256: artifactSha256,
    datasetVersion: artifact.datasetVersion,
    schoolCount: artifact.schools.length,
    selectedSourceRows: artifact.selectedSourceRows,
  },
};
const formattedManifest = await format(JSON.stringify(manifest), { parser: 'json' });
await writeFile(manifestPath, formattedManifest, 'utf8');
console.log(
  `Built ${basename(outputPath)} (${artifactSha256}) and ${basename(manifestPath)} with ${artifact.schools.length} schools and ${artifact.selectedSourceRows} reviewed 114-year source rows.`,
);
