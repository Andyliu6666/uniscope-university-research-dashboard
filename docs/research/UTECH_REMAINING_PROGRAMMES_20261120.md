# UTech Jamaica additional programme requirements — 20 November 2026

The [current official international undergraduate booklet](https://www.utech.edu.jm/storage/2026/11/Undergraduate-International-SOCOS-Booklet-Sept-2026.pdf) supplies **2027/2028 entry requirements**, with separate adjacent 2026/2027 tuition and career columns. This batch adds **27 course identities, 43 distinct admission facts and 66 course-to-rule associations** to the existing University of Technology, Jamaica, ROR `02w1kdc51`. It preserves all 22 existing courses and 59 previously reviewed facts. The institution now has 49 catalogue courses and 102 reviewed admissions facts.

Artifact: `data/sources/admissions-facts-utech-remaining-programmes-2027-20261120.json`. The existing schema, importer and programme-search behaviour are used. This is a bounded remaining-programme batch, not full institutional or global completeness.

## Official evidence and course reconciliation

The 31-page PDF was retrieved over verified HTTPS. SHA-256: `77460c4e9741c1997e1d12fd915443577ae0d14252def9442fca1dbe0cc45e1c`. Full PDF pages **9–11, 13, 15–16, 23, 25–26** were rendered and visually reviewed, including all row boundaries and column headings. They correspond to printed pages 7–9, 11, 13–14, 21, 23–24. Text extraction supported, rather than replaced, inspection of the complete pages. Per-fact page locators are retained in citation titles, with multi-page citations for shared policies.

The November URL's bytes differ from the previously reviewed October URL. That old URL currently returns HTTP 404, so this review does not claim to have compared its unavailable bytes. It reconciles the new source against the exact existing institution/course identities, prior artifacts and stored conditions. The older 51 PDF-backed facts need a separate citation audit before any provenance update; their contents and existing links are retained by this batch. Previously captured material was not silently redated.

| Newly declared course                                                         | Entry scopes in this batch |
| ----------------------------------------------------------------------------- | -------------------------- |
| Bachelor of Business Administration                                           | first_year, transfer       |
| Bachelor of Science in Accounting                                             | first_year                 |
| Bachelor of Science in Finance and Technology                                 | first_year                 |
| Bachelor of Science in Food Service Management                                | first_year                 |
| Bachelor of Science in Hospitality & Tourism Management                       | first_year                 |
| Bachelor of Science in Entrepreneurship                                       | first_year                 |
| Bachelor of Science in Medical Technology                                     | first_year, other          |
| Bachelor of Science in Child and Adolescent Development                       | first_year                 |
| Bachelor of Science in Dietetics and Nutrition                                | first_year                 |
| Bachelor of Health Sciences                                                   | other                      |
| Bachelor of Science in Midwifery                                              | other                      |
| Certificate in Critical Care Nursing (Post RN)                                | other                      |
| Certificate in Midwifery                                                      | other                      |
| Doctor of Medical Dentistry                                                   | first_year, other          |
| Bachelor of Science in Dental Laboratory Technology                           | first_year                 |
| Bachelor of Science in Dental Hygiene (Accelerated)                           | first_year                 |
| Diploma in Dental Assisting (Expanded function) (Accelerated)                 | first_year                 |
| Bachelor of Science in Environmental Health                                   | first_year                 |
| Bachelor of Science in Occupational Health, Safety & Environmental Management | first_year                 |
| Diploma in Meats & Other Foods Inspection (Post-Basic)                        | other                      |
| Bachelor of Arts in Apparel Design, Production & Management                   | first_year, other          |
| Bachelor of Science in Sport Sciences                                         | first_year, other          |
| Bachelor of Science in Construction Management                                | first_year, other          |
| Bachelor of Science in Land Surveying and Geographic Information Sciences     | first_year, transfer       |
| Bachelor of Science in Quantity Surveying                                     | first_year                 |
| Bachelor of Science in Real Estate Management & Valuation                     | first_year                 |
| Bachelor of Science in Sustainable Spatial Planning and Land Development      | first_year, other          |

## Qualification and selection decisions

- Eleven business, apparel and land-related courses share their five-subject English/Mathematics school route once. Hospitality/food foreign-language advantages and five courses' possible interviews are separate shared policies. Each course retains its subject preferences or additional conditions. Majors/minors do not create extra copies of an identical entry requirement.
- Medical Technology, Dental Hygiene and Environmental Health share the same five-subject Chemistry/Biology-or-Human-and-Social-Biology rule. Occupational Health explicitly names Biology without that alternative and keeps its own rule. Dental Assisting is a three-subject diploma; it does not receive a bachelor's five-subject condition.
- Child Development's bachelor degree has five subjects, an interview, a psychometric test pass and a clean police record. It is separate from the previously reviewed three-subject certificate. Dietetics requires a second science and prefers Chemistry; the preference is not changed into a mandatory subject.
- Dentistry keeps the five ordinary subjects plus CAPE/three-GCE-A-level school route separate from its science-degree alternative. No GCE grade pattern, IB equivalence or automatic programme exemption is inferred. Its source does not specify three GCE grades.
- Professional-entry routes retain actual licences, approved prior qualifications and experience: two post-diploma clinical laboratory years, three years for the alternative Health Sciences qualification branch, six relevant clinical months plus BLS for Critical Care Nursing, and two inspector years for the post-basic Food Inspection diploma. These are admission conditions, not employment outcomes.
- Registered Nurse and Registered Midwife entry to the Midwifery bachelor degree have separate conditions within one course identity. Current licences, NCJ approval, clinical-hours portfolio and a successful interview retain their applicant context. The source's explanation of up-to-20-credit module exemptions is unclear and marked `unknown`; it is not made a universal limit on the separately stated exemption from years 1 and 2.
- The Apparel row's prior awards/business-operator wording does not explicitly connect its listed routes. It is marked `unknown`. The clear school-subject route is preserved without imposing an unsupported prior diploma or portfolio on all applicants.
- Land Surveying's **2.70 GPA** belongs only to the relevant associate-degree route into Year 2. Construction's **18 credits** describe CAPE track/credit consideration; they are not examination points. The three-year Spatial Planning row keeps its three CAPE units/relevant prior-study routes separate from the ordinary four-year school-leaver row. No invented unit-to-subject pattern is supplied.
- These reviewed tables publish no IB total or College Board AP score. The phrase “Advanced Placement (Articulation)” means tertiary advanced standing. This batch therefore adds **zero IB records**, leaves the existing 1,212 IB rows unchanged and does not label silence about AP as a rejection policy. CSEC/GCE ordinary grades and institutional credit counts are never converted into IB/AP minima.

The 23 first-year, 18 other-route and two transfer facts are stored in the existing three university-scoped admission profiles and linked explicitly to the applicable courses. Ordinary, professional, post-diploma and accelerated conditions are identified in each fact. Certificate/diploma award names remain visible under the existing coarse undergraduate course family. The general admissions endpoint filters the stored applicant cohort exactly; `all` facts stay in the all-applicant cohort rather than being relabelled as an international-only cohort.

## Import and verification

The source artifact passed schema validation and a zero-write preview showing 43 new facts and 27 course identities with no skips or ambiguous identity matches. The prior complete Nottingham archive was verified before import. All 43 facts were inserted, and repeat import returned already completed without changes. Earlier reviewed general and IB row fingerprints matched their baseline, including the existing UTech records.

The live API matched every new fact, citation page title, check date, all 27 catalogue names and 66 associations. All 27 programme searches returned exactly their linked new conditions. Year and exact applicant-cohort filtering passed, as did separate first-year/professional/transfer routes and specific certificate, clinical-experience, GPA and preference boundaries. Data quality, API and website checks passed. No existing application logic was changed.

Complete readable post-import archive: `backups/post-utech-remaining-20261120.uwbdwp`, SHA-256 `f8164603bdce7b170b58e2118ed7d0f0013a8715da5a031871a9c14f2afbcee6`. Local raw captures, rendered pages, table-to-fact mapping, preview/import logs and independent API verification remain in `backups/research-utech-jamaica-20261120/` and the adjoining verification files. Raw booklet assets are not republished in the repository.

## Next exact work

Audit the older 51 UTech PDF-backed facts against the new source and reconcile the old 404 citation only where the current text independently supports the same condition. Preserve keys, course IDs, values, scopes and original import history. Shared-only Nursing/Midwifery/computing course identities and their older references must be reconciled before adding or linking them; do not create copies of prior shared rules. The remaining worldwide qualification and admissions research continues after this provenance repair.
