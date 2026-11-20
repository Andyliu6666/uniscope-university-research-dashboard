# Stellenbosch Economic and Management Sciences — 2027 entry

Reviewed November 20, 2026 (UTC). The existing institution is Stellenbosch University, South Africa, ROR `05bk57929`. This batch follows the completed Agrisciences, Arts and Music-awards reviews.

## Primary sources

| Source                                                                                                                                               | Complete pages reviewed                                                                      | SHA-256                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [2027 international booklet](https://files.su.ac.za/public/undergraduate-maties/documents/2026-03/2027su-international-booklet.pdf)                  | Economic tables PDF 18–19, printed 32–35; general qualification policies reviewed previously | `6275bec23a38903a6fb41c947ba59357daafa6e05602b0432300b4319d43cd13` |
| [2027 faculty selection policy](https://files.su.ac.za/public/economic-and-management-sciences/documents/2026-04/2027-emsselectionprocessengpdf.pdf) | All eight pages, including the table continued across PDF 6–8                                | `a4d331291e04cdc3363de9448c8a4d46c6bb2d4b77bfcab97dfe4c231aa21b33` |
| [November 2027 faculty yearbook](https://files.su.ac.za/public/registrars-division/documents/2026-11/2027-yearbook-part10-ems.pdf)                   | PDF 17–20, 25–26, 28–30, 51, 61, 67, 71, 77–78, 80–82 and 88                                 | `dc8d08cbb08d45b83337b2404e39386a0592dd9f2d1781f7d43e71d9b90ce618` |

The faculty prospective-students page links the selection-policy URL above. Its homepage links a second copy at an Afrikaans-named path. That copy has a different byte hash, but comparison after explicitly normalising the international-prospectus reference filename and page footers gives identical academic text and thresholds. Both captures and the precise comparison remain in local backups; the current prospective-page link is used for facts. Raw PDFs are not redistributed.

## Identities, qualifications and scopes

The artifact `data/sources/admissions-facts-stellenbosch-economic-2027-20261120.json` declares 15 identities, creates **14** and reuses the existing **B Data Science** parent. The new identities comprise nine named first-year degrees, two diplomas, two advanced diplomas and the separate unspecialised BCom articulation award. BAccounting in the international booklet corresponds to BAcc in the yearbook. Focal areas within existing degrees are retained as conditions rather than duplicate parent degrees. BCom (Law) and BAccLLB are not included in this faculty-policy batch.

There are **64 distinct new facts**, **213 new-fact associations** and **161 associations reusing reviewed requirements**, giving **374 associations**. New facts comprise 47 first-year/all-applicant records, seven other-entry/all-applicant records, six transfer/all-applicant records and four other-entry/domestic records. Explicit award names distinguish bachelor, diploma and advanced-diploma entries within the faculty's undergraduate catalogue.

Existing qualification-exemption, USA/AP and applicable IB/A-level/AS-level/German-school/Namibian subject rules are referenced by dataset/key. A matching bachelor-certificate rule is also linked to the existing Data Science parent after independent faculty-yearbook verification. No earlier fact text, source citation or programme identity is rewritten. Earlier Data Science NSC minima and international Mathematics/IB rules remain in place.

## Academic and application distinctions

- Five degrees share the NSC/IEB 65% average/60% Mathematics admission floor and a distinct 2027 selection threshold of 70%/63%. Mathematics is 70% for the Economics Econometrics and Financial Sector focal areas; the corresponding international-conversion footnote is separately sourced.
- Mathematical Sciences, International Business, Actuarial Science and BAccounting retain their individual minimum and higher selection values. BAccounting preserves both the higher-Mathematics branch and the lower-Mathematics-plus-Accounting alternative in every published curriculum. NSC language alternatives, IB HL/SL subject grades, Cambridge/Pearson A-level, AS-level, Abitur and Namibian systems are not conflated.
- International averages of 65%, 70%, 80% and 85% use SU's converted percentage scale. The existing 24-point exemption alternative is not a course-specific IB cutoff. **No new dedicated IB total record is added.**
- EMS selection thresholds are annual maxima that can be lowered in specified circumstances while admission minima remain mandatory. Grade 11 conditional offers, Grade 12 final offers, document closing, offer-letter acceptance periods and waiting-list groups retain their distinct conditions. Arts faculty dates are not copied into EMS.
- The Public Accountability Diploma preserves the exact placement of three years' relevant experience on its second NSC alternative. A completed higher-education qualification is a separate entry alternative. Advanced Public Accountability preserves its three qualification/WIL/RPL alternatives. Their December closing and assessed prior-credit routes are explicitly scoped.
- Sustainable Development's diploma preserves the alternative Mathematics/Mathematical Literacy and Business/Economics/Accounting combination, its own English conditions, departmental form and September closing. The advanced diploma instead needs an aligned NQF 6/7 qualification, computer/internet access and its own selection process. Neither diploma inherits bachelor-only exemption rules without evidence.
- The Management Sciences ECP is a faculty-offer route with separate NSC 60%/Mathematics 50%, language, citizenship, previous-schooling, repeat-subject and SES conditions. The `domestic` grouping does not make every resident eligible: the source expressly restricts registration to South African citizens.
- External transfer uses prior-credit completion, satisfactory conduct and possible formal readmission; internal transfers distinguish higher/lower-requirement destinations. The unspecialised BCom is not open to first-year registration. Data Science additionally requires programme-committee approval for articulation. Tertiary credit percentages are not school-exam cutoffs.

Two new source differences remain explicit rather than silently resolved: the Data Science EMS international language column differs from other faculty tables, and the School of Tomorrow yearbook instruction requires all NBTs while the selection policy lists NBT **or** SAT. The two policy-copy URLs themselves do not introduce different academic thresholds. Earlier Agrisciences and Southampton Malaysia ambiguities remain pending.

## Verification and coverage

Validation and a zero-write preview passed with 64 predicted insertions, 14 new identities, one reused parent and 161 prior-rule links. The previous complete Music archive was verified by checksum and full restore-stream read before mutation. Actual import inserted all 64 facts with zero skips. Repeat imported nothing and retained all 15 declared identities.

Whole-database comparisons preserved existing universities, all 24 earlier Stellenbosch programme rows, other programme rows, prior profiles/sources/imports, earlier fact content, previous shared-link prefixes and all 1,212 reviewed IB rows. The repeat snapshots equal the first completed import.

The live API matched all 64 facts, sources, dates and 374 associations. All 135 course/route/cohort searches passed, accounting for substring search unions such as generic BCom and Diploma/Advanced Diploma. Year and readmission boundaries, first-year exclusion of the articulation award, NSC minimum/selection alternatives, ECP eligibility and source differences passed. An initial burst reached the normal API rate limit; the completed verifier respects Retry-After without weakening the application limit. The final data-quality, API and website checks passed.

Counts are **28,171 institutions, 281,749 courses, 3,837 profiles, 25,945 admission requirements, 108,022 sources and 136 import runs**. Reviewed general facts total **3,925 across 88 institutions**. Stellenbosch has **38 catalogue entries and 171 reviewed general facts**. Published numerical IB-total coverage remains **716 courses**. There are still **23,987 institutions without structured application facts**; worldwide coverage remains unfinished.

Complete readable archive: `backups/post-stellenbosch-economic-20261120.4x2shcf_`, SHA-256 `46a7fd3881259dade175615a6be59732d8f77a517aa864448006a20457791fd5`. Local captures, rendered pages, variant comparison, validation/preview/import/repeat logs and row/API evidence are saved under the research and checkpoint backups.

The next source queue is Engineering: the 2027 international booklet's complete PDF 21, the current 115-page November 2027 Engineering yearbook and the two actual 2027 selection-policy PDFs. Some official navigation links labelled 2027 still return 2025/2026 documents; inspect the document's own year before using it. No Engineering artifact or import is included here.
