# IB work checkpoint — 2026-10-02 (Strathmore fully verified)

**Current work direction:** the user's October 2 instruction expands the next work from IB-only batches to all discoverable admissions requirements, without repeated facts. Employment data is deferred. Read `docs/ADMISSIONS_PROGRESS.md` first for the current increment; the completed IB checkpoints below remain historical and must not be reimported.

## Latest closed checkpoint — Strathmore, October 1–2

**Seven reviewed requirements and seven programmes were imported October 1, with zero updates and zero rejections.** Repeating the artifact immediately returned `already-completed`, so this batch must not be recreated or reseeded. The API image was rebuilt successfully afterward. Programmes: Computer Networks and Cyber Security, Electrical and Electronics Engineering, Financial Economics, Financial Engineering, Actuarial Science, Informatics and Computer Science, and Law.

Live coverage export refreshed October 2 Bangkok time (`2026-10-01T23:34:48Z`): **54 reviewed IB records across 25 institutions; 48 reviewed programmes, 37 programmes with published numeric totals, and six institution-wide policies**. Total catalogue: **280,081 entries, 194,417 undergraduate**, across the unchanged **28,171 institutions**. **24,069 institutions still have no structured application facts**; neither this batch nor a non-empty IB record makes an institution complete.

Pre-import backup: `backups/pre-strathmore-20261001.UTxWtC` (about 40 MB; 191 archive listing lines, successfully read). All seven selected primary HTML sources were directly retrieved October 1 with HTTPS verification enabled. Each explicitly states 34/45; the Law page additionally states English 6 but does not specify HL/SL. Academic year stays unspecified, not 2026 inferred from the review date. Conflicting thresholds for other Strathmore courses and unverified Pretoria leads remain deferred in `docs/research/IB_STRATHMORE_20261001.md`.

All six steps for this increment are complete:

1. Structure and safety: reused the existing scoped importer, schema, API and UI. No application code, migration or dependency changed in this increment.
2. Official sources: seven programme-specific pages reviewed October 1, with separate subject conditions, applicant/entry-route scope and unspecified academic year. Conflicting course thresholds remain deferred; website verification on October 2 did not advance the source review date.
3. Tests: October 2 lint passed on 119 files, all three package typechecks passed, and all 110 tests passed (16 shared, 76 API, 18 web). Whole-repository formatting and whitespace checks passed.
4. Identity, backup and preview: exact ROR `047dnqw48`, country KE and official domain confirmed. The institution had zero existing programmes before import. The readable pre-import backup above, validation and read-only dry run all completed before the seven inserts.
5. Import and actual website: October 1 import inserted seven records with zero updates/rejections; repeat import was an already-completed no-op. The rebuilt API image contains the exact artifact. On October 2, all **54** IB requirement objects across **seven artifacts and 26 institution/level route scopes** matched the live website API and database count, with zero missing or extra records. Strathmore applicant/year/route/level isolation, programme search and pagination checks passed. The actual browser displayed the Law programme's 34/45, English 6 with unspecified HL/SL, conditions and official source. Screenshot saved in the task-output directory as `strathmore-ib-20261002.png`. All three Docker services are healthy.
6. Coverage and recovery: October 2 database-quality, API and website gates passed; the live coverage export was refreshed. Readable post-import backup: `backups/post-strathmore-20261002.nnodR0` (about 40 MB; 191 archive listing lines). No Git commit or push was performed; unrelated working-tree changes remain preserved.

There is no in-flight import or background research job for this increment. The global objective remains unfinished: expand independently reviewed programme requirements in underrepresented regions and add sourced fees, deadlines and basic institution facts. Resolve the recorded source conflicts before importing those deferred courses. Do not recreate this completed batch or mistake these 54 reviewed records for complete coverage of the global catalogue.

## Historical closed checkpoint — Ghana, September 29–October 1

The Cape Coast increment is applied to the local Docker database and verified on the actual website: **three new programme requirements and three new catalogue entries, zero rejected records**. The courses are Health Information Management (Regular), Sport and Exercise Science (Regular), and Doctor of Optometry. These sources publish HL/SL subject grades, **not an IB Diploma total**, and apply to local applicants only. Their source check date remains September 29; a later website check is not a new source review.

Live coverage export at `2026-09-30T11:59:58Z`: **28,171 institutions, 280,074 catalogue entries (194,410 undergraduate), 47 reviewed IB records across 24 institutions, 41 reviewed programmes, 30 programmes with published numeric totals and six institution-wide policies**. There remain **24,070 institutions with no structured application facts**. This is a small verified increment, not completion of the global objective.

Six-step status:

1. Structure and safety: reused the scoped schema/importer/API/UI; no application code, migration or dependency changed in this increment.
2. Source research: `data/sources/ib-requirements-ghana-20260929.json` and `docs/research/IB_GHANA_20260929.md` record official programme sources, local-applicant scope, subject thresholds, unspecified year and conflicting application-open labels. No total or deadline was inferred.
3. Tests: 110 tests passed again October 1 (16 shared, 76 API, 18 web); lint passed on 118 files, all three package typechecks passed, and whole-repository formatting/whitespace checks passed. The three live requirements were also compared field-for-field against the artifact again October 1; applicant/year/route isolation remained correct.
4. Backup and preview: exact institution ROR and country confirmed; it had zero existing programmes before this batch. Readable pre-import backup `backups/pre-ghana-20260929.1wAtRX` (about 40 MB, 191 archive listing lines); validation and read-only preview passed.
5. Apply and website: all three records imported September 29; a repeat was an already-completed no-op. On September 30, every field matched the artifact through the website API; international, other-year and other-route filters excluded these domestic/undated/first-year records. The refreshed API image contains the exact artifact. A real-browser check displayed all three requirements and their sources. All three Docker services remain healthy October 1.
6. Coverage and recovery: data-quality, API and website gates passed September 30, and the live export was refreshed. Readable post-import backup `backups/post-ghana-20260930.TNSrZe` (about 40 MB, 191 archive listing lines). No user programmes were removed; no commit or GitHub push was performed. Extensive older working-tree changes remain preserved.

The Strathmore batch following this checkpoint was imported October 1; see the latest checkpoint above. After Docker Desktop exited during that continuation, it was restarted without restoring or deleting any data; existing services and records were retained. The 47-record figures in this section describe the earlier Ghana checkpoint only.

## Historical closed checkpoint — September 21

The new Africa, Asia and Latin America artifacts have been imported into the actual local Docker database: **18 new records across 10 newly covered institutions, including 17 programs and one university policy; zero rejections**. Eleven of the new program records have published numeric totals. Six African program sources recognize IB but do not publish an IB total; those totals remain null. Every import was repeated and correctly reported a completed-checksum no-op. This is applied database data, not just proposed JSON.

Live coverage export at `2026-09-21T01:49:43Z`: **28,171 institutions, 280,071 catalog entries (194,407 undergraduate), 44 reviewed IB records, 23 covered institutions, 38 reviewed programs, 30 programs with published numeric totals and six university-wide policies**. These numeric totals have different published meanings and are not interchangeable cutoffs. There are still **24,071 institutions with no structured application facts**. The global completeness objective is emphatically not finished.

Reviewed corrections before import: UMS engineering requirements apply to the local/UPU route, not verified international eligibility; Ardhi's source belongs to historical 2025/2026; Salem and Pan-Atlantic are other/direct-entry routes rather than first-year entry; Sunway publishes 24/42 excluding bonus points; UANDES Chile and ESAN refer to 2027. A faculty-only IUEA policy was deferred instead of mislabelled university-wide. No user-created programs or existing records were removed.

Six-step status for this increment:

1. Structure and safety: existing scoped IB schema/importer/API/UI reused; no new migration or dependency.
2. Source research: three reviewed artifacts finalized with applicant, year and entry-route distinctions.
3. Tests: 110 shared/API/web tests passed again on September 19 (16 shared, 76 API, 18 web); lint checked 117 files and all package typechecks passed. Whole-repository formatting and whitespace checks passed September 21. No application source was changed in this data increment.
4. Backup and preview: readable 40 MB pre-expansion backup `backups/pre-ib-expansion-20260916.pMfCwt`; all three read-only dry runs had zero rejections. Exact existing institution identifiers were confirmed; the ten target institutions had no catalog programs before this increment.
5. Import and verification: 6 Africa + 8 Asia + 4 Latin America rows applied; 17 new programs; repeated imports were no-ops. All 44 stored requirements matched their complete source artifacts through the live website API on September 19. Eleven additional year/applicant/route isolation checks passed, and the original Oxford program ID was preserved. The refreshed API image contains all five exact JSON artifacts; all three Docker services are healthy. Real-browser checks confirmed Sunway 24/42, UMS international-filter exclusion, and Salem's documented non-numeric 200-level route under Other.
6. Coverage and handoff: data-quality, API, website and formatting checks passed September 21; the live coverage export was refreshed. Readable 40 MB post-import backup: `backups/post-ib-expansion-20260921.N3DnQm` (191 archive listing lines). This increment's six steps are complete. No commit or GitHub push has been performed; extensive pre-existing working-tree changes remain preserved.

The Cape Coast review begun after this checkpoint was imported September 29 and verified September 30; see the latest checkpoint above. The 44-record figures in this historical section describe only the September 21 state.

### Docker recovery already completed — do not restore again

On September 15 the active Docker context had no containers or data volumes. The original pre-IB backup was restored only after checking that the target database had no user tables, without a destructive clean/drop. The first two reviewed artifacts restored the exact 28,171 / 280,054 / 26 baseline. A readable recovery backup was saved as `backups/restored-ib-baseline-20260915.XXXXXX.dump` (the Xs are literal characters in the existing filename).

On September 16 Docker Desktop was restarted; its data volume was intact and the recovered baseline was verified. No second database restoration was needed or performed. The previous source patch in the task-output directory is an intermediate review artifact, not the authoritative current repository.

## September 11 verified increment

**This IB increment is implemented, imported and visible on the local Docker website. The overall objective remains open:** source-backed information for every institution and program. Do not treat institution identities or catalog entries as complete application profiles.

## Six work steps — completed for this increment

1. **Data structure and safety:** implemented in the actual repository. Existing admission tables are reused. University policies and program requirements stay separate. Each reviewed record retains score semantics, year, intake, entry route, applicant scope and an official source. Unknown scores are never replaced with a guessed number.
2. **Official source research:** two reviewed artifacts contain 26 records across 13 institutions in 7 countries: 21 program records (19 with numeric totals) and 5 institution-wide policies. The Kenyan batch covers 6 programs at Eldoret, Maseno, Maasai Mara and Kabarak. Published typical offers remain labelled as typical offers, not minimum cutoffs.
3. **Tests and review:** 110 tests passed: 16 shared, 76 API and 18 web. Coverage includes schema validation, exact identities, ambiguous program matches, scope isolation, import safety, API filters, UI states and native Node loading. A Docker-only shared-module resolution failure was fixed and guarded by a native Node regression test. Formatting, lint, types and production builds were checked; the final verification is recorded below.
4. **Backup and identity preview:** the live baseline was 28,171 institutions, 280,034 catalog entries and zero structured IB qualification rows. A readable full PostgreSQL backup was made before import. Both initial dry runs had zero identity rejections and made no writes.
5. **Apply and website verification:** code is applied in `/Users/andydufresne/Documents/uniscope-university-research-dashboard`. Docker API/web were rebuilt and all three services are healthy. Both artifacts were imported with zero rejected IB records. All 13 institution IB endpoints returned successful responses through the website proxy. The real Eldoret page displayed scores, conditions and sources; its program-name search was exercised. Oxford was checked after merging the duplicate described below.
6. **Coverage export and handoff:** data-quality gates passed and `data/import-status.json` was generated from the live database. Both final artifact imports were repeated to verify their completed-checksum no-op behavior. Progress is saved here. No Git commit or GitHub push was performed during this increment; unrelated pre-existing working-tree changes remain preserved.

## Historical September 11 database coverage

Live export: `data/import-status.json`, generated `2026-09-11T04:07:49Z`.

| Metric                                              |   Count |
| --------------------------------------------------- | ------: |
| Institutions in the database                        |  28,171 |
| Catalog entries, all levels                         | 280,054 |
| Undergraduate catalog entries                       | 194,390 |
| Reviewed IB qualification records                   |      26 |
| Institutions with reviewed IB records               |      13 |
| Institution-wide IB policies                        |       5 |
| Programs with reviewed IB records, all entry routes |      21 |
| Programs with published numeric totals              |      19 |
| Rejected records in this IB increment               |       0 |

Numeric totals include explicitly labelled minimum-entry requirements and typical-offer ranges. These are not 19 interchangeable minimum cutoffs. One reviewed Aberystwyth top-up route is not first-year entry; the default first-year filter consequently shows 20 reviewed programs across this batch, not 21. Institution-wide policies do not count as reviewed programs.

The latest broader coverage export still reports **24,081 institutions with no structured application facts**. This is a substantial unfinished data-research task. A source-backed identity, research profile or institution-wide diploma-recognition statement does not resolve it.

## Data corrections and recovery

- Full pre-import database backup: `backups/pre-ib-20260911.PYRMn7.dump` (about 40 MB; archive listing successfully read).
- An import initially created a second Oxford Computer Science program because its name included a degree suffix. The existing user-created program `c7ab853f-b073-4c39-8f75-4cbd97e4a0e3` was preserved. Its official IB profile was reassigned to that program, and only the newly introduced duplicate `32b91d8e-e5a7-4710-9b90-dbb511a73cb0` was deleted after checking dependent rows. Recovery snapshot: `backups/ib-oxford-duplicate-before-merge-20260911.json`. No qualification or source evidence was deleted.
- The corrected first artifact uses dataset version `official-ib-reviewed-2026-09-10-r2`. Its 20 records updated the same records without creating programs; the final total is 20 net new catalog entries plus one reviewed pre-existing Oxford program.
- Programs with no official course code use `courseCode: null`, not an invented official-looking code. Internal identity includes source URL, exact name and level so two courses on one admissions page remain distinct.
- The ignored local `.env` database URL now uses host port 55432, matching the existing Docker database port. Credentials were unchanged and are not included in source artifacts.

## Resume safely

1. Read this checkpoint, `docs/IB_REQUIREMENTS.md` and the current live coverage export; inspect the dirty working tree before modifying it.
2. Prioritize additional official course pages in underrepresented regions, including Uganda, Tanzania, Zambia, Nigeria and Latin America. Preserve explicit non-numeric findings rather than inventing scores. A school-wide 24-point rule must not be copied to every course.
3. Add a new versioned source artifact. Resolve exact institution identifiers and existing program identities; retain academic year, applicant scope, HL/subject conditions, official URL and check date. Review existing catalog matches before creating a new program.
4. Validate, make a current database backup and perform a read-only dry run. Resolve identity conflicts rather than guessing. Import only reviewed records, repeat to check idempotency, then run the data-quality gates and regenerate the coverage export.
5. Rebuild the API image when its source artifacts or code change; rebuild web when frontend code changes. Verify the actual website and filters, not just local JSON or a test-only process.
6. Update this checkpoint with committed counts, evidence gaps and remaining work. Do not mark the global objective complete or imply automatic future work is running.

Deferred research: Eldoret Disaster Management has an unresolved official BA/BSc name conflict. Nairobi Project Planning needs an exact institution identifier and has no numeric total in the reviewed source. Neither was imported as a numeric requirement.

Do not delete Docker volumes, run demonstration seeds, overwrite user-created courses or fabricate unreported thresholds. No automated background research job was started.

## Local verification links

- [Strathmore: seven reviewed programme totals](http://localhost:5173/universities/strathmore-university-047dnqw48#ib-requirements)
- [Cape Coast: three local-applicant programme requirements](http://localhost:5173/universities/university-of-cape-coast-0492nfe34#ib-requirements)
- [Eldoret: three reviewed programs](http://localhost:5173/universities/university-of-eldoret-010crp378#ib-requirements)
- [Oxford: preserved Computer Science program](http://localhost:5173/universities/university-of-oxford#ib-requirements)
- [Kabarak: Counselling Psychology](http://localhost:5173/universities/kabarak-university-009b5t134#ib-requirements)
