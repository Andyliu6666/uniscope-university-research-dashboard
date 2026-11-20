# Stellenbosch Agrisciences and international qualifications — 20 November 2026

The [official 2027 international undergraduate prospectus](https://files.su.ac.za/public/undergraduate-maties/documents/2026-03/2027su-international-booklet.pdf) provides programme-specific IB, Cambridge/Pearson A-level, AS-level/NSSCAS, German-school and Namibian HL/OL requirements. It is linked as the 2027 booklet by the university's [international applications page](https://www.su.ac.za/af/suinternational/node/7338?language=en). This batch adds **ten courses, 51 distinct admission records and 285 course-to-rule links** to the existing Stellenbosch University identity, ROR `05bk57929`, country `ZA`.

The institution had no catalogue or reviewed admissions entries before this batch. Artifact: `data/sources/admissions-facts-stellenbosch-agrisciences-2027-20261120.json`. No application code or database migration is changed. This is the Agrisciences table and relevant shared qualification guidance, not a claim of complete institutional coverage.

## Evidence and course identity

The 31-page PDF was retrieved directly over verified HTTPS. SHA-256: `6275bec23a38903a6fb41c947ba59357daafa6e05602b0432300b4319d43cd13`. Complete PDF pages **3, 5–7 and 10–13** were rendered and visually reviewed. Most PDF pages contain two printed pages: the course tables on PDF 10–13 correspond to printed pages 16–23. The cover identifies 2027; no intake term or delivery mode is supplied. The old 2026 `sun.ac.za` PDF link redirects to the home page and was not used as a substitute.

| Programme                                       | Campus       | Course table, PDF page |
| ----------------------------------------------- | ------------ | ---------------------- |
| BAgric (Agribusiness Management)                | Stellenbosch | 10                     |
| BScAgric (Agricultural Economics)               | Stellenbosch | 10                     |
| BScAgric (Animal Production Systems)            | Stellenbosch | 11                     |
| BSc (Conservation Ecology)                      | Stellenbosch | 11                     |
| BSc (Food Science)                              | Stellenbosch | 11                     |
| BSc (Forestry and Wood Science)                 | Stellenbosch | 12                     |
| BScAgric (Plant and Soil Science)               | Stellenbosch | 12                     |
| BScAgric (Viticulture and Oenology)             | Stellenbosch | 13                     |
| B Data Science (BDatSci)                        | Stellenbosch | 13                     |
| BAgric (Agricultural Production and Management) | Elsenburg    | 13                     |

The Forestry degree's specialisations remain conditional branches within one award. Its Wood specialisation has different AS/A-level, Abitur and Namibian Mathematics conditions; they are retained. Elsenburg's programme and its 55% converted average remain distinct from Agribusiness Management. Data Science's parent identity should be reused when it recurs in other faculty tables.

## Score meaning and unresolved source entries

- The eight linked Agrisciences rows require a 60% **SU-converted average**. Data Science requires 80%, and Elsenburg Agricultural Production and Management requires 55%. These percentages are not IB diploma totals.
- The Matriculation Board header gives **24 points OR two HL passes at 4–7 and three SL passes at 4–7**, with English. This is preserved once as an exemption alternative. It is not copied into ten purported numerical course IB offers. Course-specific subjects and converted averages remain additional requirements.
- Published IB conditions include language **HL 4 / SL 5**, Mathematics **HL 4 / SL 5**, and Physics and Chemistry **HL 4 / SL 5** for their explicitly linked rows. Data Science instead requires Mathematics **HL 5 / SL 6** and distinguishes English First Language HL 4 from Second Language HL 5 / SL 6. The source does not specify Mathematics AA/AI variants.
- A-level, AS-level and Namibian levels are kept separate. For example, Forestry Mathematics differs by specialisation: **A-level E or D**, **AS-level C or B**, and **Namibian HL 3 or 2**. The common A-level E and AS-level D Physics/Chemistry requirements are separate shared facts. Namibian HL values never become IB scores.
- The American-diploma/AP/SAT/ACT/NBT routes retain their original qualification and location boundaries. Applying from the USA as an international applicant differs from completing AHSD within South Africa. The latter branch requires diploma/transcript GPA 3.5 plus one exemption-document alternative; AP is two subjects with grades 3–5. It is not an independent AP requirement imposed on every course, and the alternatives are not cumulative tests.
- Five records explicitly retain uncertainty: missing Plant and Soil Science IB SL numbers; Viticulture's malformed Mathematics connective; an A-level-labelled default Mathematics line in the Namibian column; Elsenburg's unclear science AND/OR grouping; and the USA SAT total 1130 conflicting with subminima 610 and 530. Clear adjacent values are retained with their qualification/major conditions. Missing or contradictory numbers are not repaired by analogy.

The 47 `all`-cohort records include qualification/location-specific conditions and also apply to South African citizens presenting international curricula where stated. Four `international`-cohort records preserve the USA-applicant branch and the booklet's international calendar/fee guidance. These cohorts are queried separately. The calendar's dates have no printed calendar year; they remain source text, and the August/November offer-processing milestones are not new application-closing extensions. The general exemption-certificate timing and the American-diploma section's earlier pre-offer instruction are both retained with their contexts.

All common rules are stored once and linked to the relevant courses. The two profiles contain 51 records, including five marked `unknown`, rather than 285 repeated copies. The dedicated IB table receives **zero numerical-total records** because the course tables do not state a single sufficient course IB total. Actual IB subject grades remain visible in the general admissions results.

## Import and verification

Schema validation passed. The no-write preview planned ten courses and 51 facts with zero skips and preserved the baseline exactly. The previous UTech full archive was checksum-verified and read completely before import. All ten identities and 51 facts were inserted; a repeat made no changes.

The before/after comparison checks all prior universities, course rows, profiles, requirements, sources and import runs, and all 1,212 IB rows. The API matched every new fact, source locator, date and all 285 associations. Every course search passed for both applicant cohorts; year, route and exact applicant-cohort isolation passed. Specific checks retained the five unresolved records, Data Science's distinct IB conditions, Forestry's specialisation Mathematics and the exemption alternative. Data quality, API and website checks passed.

Current counts are **28,171 institutions, 281,721 courses, 3,834 profiles, 25,825 requirements, 108,017 sources and 133 runs**. Reviewed general facts total **3,805 across 88 institutions**. Dedicated IB coverage remains **1,212 records and 716 courses with numerical totals**.

Complete readable archive: `backups/post-stellenbosch-agrisciences-20261120.oqr8514e`, SHA-256 `af8ab42c02a19674610fe260e4f3fcbc7712c4fe8f79cce208f29c04c2418de8`. Raw captures, page text/images, source mapping, validation/preview/repeat logs and API/row comparisons remain in local backups. Raw booklet assets are not republished.

The next source task is the Arts and Social Sciences table on PDF 14–17, printed 24–31, followed by the remaining faculties. Reuse the new Data Science identity and applicable shared qualification rules. Inspect complete pages and faculty-specific selection sources before importing additional conditions; the unresolved fields above remain pending.
