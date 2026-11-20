# UTech citation review and shared course links — 20 November 2026

The [official international undergraduate booklet](https://www.utech.edu.jm/storage/2026/11/Undergraduate-International-SOCOS-Booklet-Sept-2026.pdf) independently supports all 51 previously stored conditions whose October document URL now returns HTTP 404. This stage refreshes those citations, adds five course identities, reuses three and attaches 18 links to four existing shared rules. It adds **zero duplicate facts and zero IB records**. University of Technology, Jamaica remains ROR `02w1kdc51`, country `JM`.

## Evidence and scope

The current 31-page document's SHA-256 is `77460c4e9741c1997e1d12fd915443577ae0d14252def9442fca1dbe0cc45e1c`. Full PDF pages **6, 12, 14, 16–24** were rendered and visually reviewed for the citation audit; they correspond to printed pages **4, 10, 12, 14–22**. The replacement titles retain individual page locators. The entry cycle is **2027/2028**; the neighbouring 2026/2027 column is tuition, not an alternative admissions year.

The complete rendered Architecture page, PDF 24 / printed 22, contains the subject-category and tertiary-transcript footnote omitted by the earlier text extraction. It supports the existing rule without changing its content. The [Jamaican booklet](https://www.utech.edu.jm/storage/2026/11/Undergraduate-SOCOS-Booklet-Sept-2026.pdf), PDF page 23, independently corroborates this footnote; its SHA-256 is `1b13ae5fa23fb221d3953d3d0340bc08d072c6b66b34d3ae67ea7da116c65cc4`. Every replacement in the manifest uses the international booklet.

The October bytes are unavailable. This is a comparison of the current official document with the exact stored 51 conditions and original frozen artifacts, not a claim that the October and November documents are byte-identical. Numerical conditions retain their meanings: the accelerated Electrical/Computer Engineering A-level Mathematics/Physics grade C and CAPE Unit 1/2 Grade III are not IB thresholds; tertiary GPA values remain prior-study conditions. Ambiguous school-grade and exemption wording remains marked unknown.

## Citation repair

Artifact: `data/corrections/utech-citations-20261120.json`. The guarded [citation workflow](../ADMISSIONS_CITATIONS.md) verifies all original academic content and scope before changing source metadata. All 51 requirement IDs, texts, labels, statuses and source-provider dataset identities are preserved. Twenty-nine admission-profile references and 22 programme references move to the existing current source. Programme provenance URLs move with their source IDs and retain an audit trace.

The complete old source is archived in the separate import checkpoint. It is removed from active sources only after every actual database source foreign key has been checked. The original October source artifacts and earlier import runs are unchanged. A pre-publication quality check caught 22 stale programme provenance URLs; these were corrected with a bounded original-row comparison, and the implementation and PostgreSQL regression fixture now check this case.

## Shared course associations

Artifact: `data/sources/admissions-facts-utech-shared-course-links-2027-20261120.json`. Its `profiles` array is empty: it introduces no copies of existing school or selection requirements.

| Course                               | Catalogue action | Existing shared rules linked                                         |
| ------------------------------------ | ---------------- | -------------------------------------------------------------------- |
| Applied Artificial Intelligence      | New              | General school grade standard; Computing school subjects             |
| Computer Information Systems         | New              | General school grade standard; Computing school subjects             |
| Computer Network and Security        | New              | General school grade standard; Computing school subjects             |
| Gaming                               | New              | General school grade standard; Computing school subjects             |
| Animation Development and Production | Reuse            | General school grade standard; Computing school subjects             |
| Computing                            | Reuse            | General school grade standard; Computing school subjects             |
| Nursing                              | New              | General school grade standard; Nursing/Midwifery subjects; selection |
| Midwifery                            | Reuse            | General school grade standard; Nursing/Midwifery subjects; selection |

The source's misspelt “Artifical” programme name is reconciled with the [official Applied Artificial Intelligence course page](https://www.utech.edu.jm/course-of-study/bachelor-of-science-in-applied-artificial-intelligence/). That page corroborates identity only: its older fees/closed-application banner are not imported as the current admission cycle or opening status. Midwifery's first-year school route remains separate from its professional/post-diploma route. Animation's own subject/selection facts remain alongside its applicable shared rules.

The reviewed tables publish no numerical IB total or College Board AP entry score. “Advanced Placement (Articulation)” concerns tertiary advanced standing. None of these conditions is converted into an invented IB/AP threshold or a claim that a qualification is not accepted.

## Verification and checkpoint

Both artifacts passed validation and no-write previews. The citation refresh and shared-link import each repeated unchanged. The final whole-database comparison permits only the 51 reviewed citation changes, 29 profile source references, 22 programme source/provenance changes, five new course rows and 18 explicit associations. All earlier academic facts, other course rows, prior import runs and all 1,212 IB rows retain their content fingerprints.

The API matched every refreshed citation, all eight course identities and all 18 associations. Programme searches, 2027/2028 scope, exact applicant filtering and Midwifery's first-year/professional separation passed. Five safeguard unit tests, API typecheck, repository lint, the isolated PostgreSQL rollback/repeat/provenance fixture and the live data quality/API/website checks passed. CI also executes the new transaction fixture against a fresh database in a path containing spaces.

Current counts: **28,171 institutions, 281,711 courses, 3,832 admission profiles, 25,774 requirements, 108,016 sources and 132 import runs**. UTech has **54 courses and 102 reviewed general facts**. Globally there remain **3,754 reviewed general facts across 87 institutions** and **716 courses with numerical IB totals**. This repairs current coverage; it does not imply that all institutions or all UTech programmes have complete requirements.

Complete readable final database archive: `backups/post-utech-citations-links-final-20261120.1n51myck`, SHA-256 `ab11a3588b60cb2a6ee723cd80dac8f8ffba1cc6bf45533fe162d9eb10358c17`. Captures, rendered pages, 51-row review mapping, before/after comparisons and repeat/API logs remain under local `backups/`; raw booklet assets are not republished.
