# Belize programme admissions increment — 1 November 2026

**56 facts / 46 scopes / 43 programme declarations** for the exact existing University of Belize, `ror:00fgcap50`, BZ. The declarations include **18 associate awards and 25 bachelor programmes/cognates**, not 43 bachelor degrees. Four additional named certificate awards are covered in one explicitly restricted other-award scope. This does not establish full admissions coverage for this institution or the global catalogue.

## Official evidence

Eleven canonical department pages were retrieved over verified HTTPS on 1 November 2026. Complete programme offerings, codes, requirements and neighbouring award headings were reviewed from the captured HTML; search snippets and `old.ub.edu.bz` were discovery only. Raw captures and extracted text are retained in ignored `backups/research-belize-programmes-20261101/`. Per-fact citations identify the department and published programme code; the three Business Education cognates share code BBUE and retain distinct names.

| Capture                       | Official page                                                | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| nursing-department.html       | [nursing](https://ub.edu.bz/nursing-department/)             | `11529d358c0356df732580b77e2543aff9d86c11766f0f7bb686c6a522e75a45` |
| allied-health-department.html | [allied-health](https://ub.edu.bz/allied-health-department/) | `b40acd448b83f455997e90e11f70ebd049da0a48b8d88cc299181402a6ee24ea` |
| social-work-department.html   | [social-work](https://ub.edu.bz/social-work-department/)     | `16df7201a126b29f23b2eb096b629ec14544d8cee08c886b5be979e964f49924` |
| science-department.html       | [science](https://ub.edu.bz/science-department/)             | `70b09bac5f8353e4517b56351e007022a394f089d8c7e31ac3264da1c7d8d714` |
| engineering-department.html   | [engineering](https://ub.edu.bz/engineering-department/)     | `1c197ed39ce665e7a3a165d85ff6c1d4dfed21b9b8e380be020d6480fd732daf` |
| mpit-department.html          | [mpit](https://ub.edu.bz/mpit-department/)                   | `821441111379cf1000a99863e8bbc60b86010c6b41cadb96959bc04d914e4439` |
| agriculture-department.html   | [agriculture](https://ub.edu.bz/agriculture-department/)     | `f59581950a23275601706ef2f5458dc78b746c5ac26ed8c63703a9a2326fc23c` |
| education-department.html     | [education](https://ub.edu.bz/education-department/)         | `4ff5e23ebbe6fe5e1d4cb7b62eabfc4912ecc5ca82a1dd5c2bfc378e7771c7be` |
| arts-department.html          | [arts](https://ub.edu.bz/arts-department/)                   | `e0d67eba71d4386e40b1f2d23ef27eac1047796585c07eb98134fbfe672a9f73` |
| criminology-department.html   | [criminology](https://ub.edu.bz/criminology-department/)     | `a57693aa4e3903661bbaf5ffc294cbb3fb4fab579b1e3f41951e8928a20a4b7c` |
| tourism-department.html       | [tourism](https://ub.edu.bz/tourism-department/)             | `57572e158e5c222f719ec459bcbcf3cea172968dfb84e3331b7b260b0e9bf637` |

The Business department was also captured (SHA-256 `6a7fd5a0c07677345f2312563ad8f65c342a2c9952691e4ab5266bb5324492bf`) but its programmes/MBA are deferred to a separately reviewed batch. The education diploma and master's entry panels also need additional graduate-specific review. No PDF, curriculum sequence, tuition amount or employment outcome is used as an admissions requirement in this increment.

## Scope and deduplication decisions

The department pages do not specify an application year. All profiles use `unspecified` year and intake; page copyright dates do not become an admission cycle. Early Childhood Education is explicitly online/part-time only; Spanish Education is offered by cohort without a next-cohort date.

Each published named programme has its own subject/prior-award condition. Where departments independently list the same subject GPA combination for different programmes, identical factual thresholds remain in those distinct programme scopes so selecting a programme returns its actual entry requirement. They are not cloned as generic institution-wide rules. The institution-wide essay, recommendations, documents, placement tests and international language conditions from the previous increment are **not repeated**. The three Business Education cognates are distinct selectable names, not three copies in one scope.

GPA in an individual subject and cumulative GPA are separate conditions: Chemistry associate requires cumulative 2.5, while Biology, combined Biology/Chemistry, combined Chemistry/Mathematics and Natural Resource Management associates specify cumulative 2.0. Marine Biology raises Biology/Chemistry to 3.0. Pre-Medical Science's associate route requires 3.0 across four subjects and overall; this is not an MBBS offer. Associate IT keeps Mathematics 3.0, English 2.0, IT 2.5 and cumulative 2.5.

Nursing requires five CXC grades 1–2, with the four named subjects and one other, plus age 17 at the start of the entry academic year. That age rule is separately evidenced for Practical Nursing and is not extended to the other certificates. Engineering's Technical Drawing/Chemistry backgrounds and Agriculture background are advantageous (`considered`), not mandatory extra subjects.

Medical Laboratory Science and Social Work preserve their alternative prior-associate routes in separate `other` entry profiles. Other bachelor prerequisites naming an associate award use the same route; no automatic transfer credit or entry year is inferred. Primary Education's prerequisite is specifically the primary-education associate, while several other courses expressly permit a related field. Hospitality/Tourism bachelors name a business-related associate, not necessarily a tourism associate.

Midwifery, Practical Nursing, GIS and ESL certificates remain named in an institution-level `other` award profile because the current programme catalogue supports undergraduate/graduate levels only. No certificate is falsely declared as a bachelor programme. Midwifery/Practical Nursing retain their subject and cumulative GPAs; Practical Nursing has its own entry age and non-transfer-to-Nursing restriction. GIS requires an associate award; ESL requires a high-school diploma. Missing subject specialisms, registration criteria, ages and English-test scores are not invented. A future award-level catalogue extension can provide individual certificate selectors without duplicating these facts.

No IB total, AP conversion, A-level equivalence, compulsory essay/competition or admissions guarantee is established by these pages. Original IB/general full rows must remain unchanged. This is an append-only data increment using the existing schema/importer and dependencies. Eight semantic safeguards cover these distinctions, in addition to existing importer/API tests.

## Reproducibility and follow-up

New artifact: `data/sources/admissions-facts-belize-programmes-20261101.json`, dataset version `official-admissions-belize-programmes-2026-11-01-v1`. Completed older artifacts are immutable and are not replayed. Validation, backup, read-only preview, actual import, repeat-safety, full API/browser checks, coverage and publication are recorded in `../ADMISSIONS_PROGRESS.md` and the ignored handoff.

Continue Belize Business/MBA, graduate education, current-cycle dates and previously documented medical/payment ambiguities. Remaining Eswatini Science/Engineering/Consumer Sciences/distance routes still need full source review and resolution of the general English C versus faculty D wording. Expand to further under-researched institutions rather than claiming global completion. Employment remains deferred.
