# Stellenbosch separate Music awards — 2027 entry

Reviewed November 20, 2026, for the existing Stellenbosch University identity, ROR `05bk57929`. This follows the completed Arts batch; BA (Music) is not duplicated.

## Official source and course identities

The [November 2027 Arts yearbook](https://files.su.ac.za/public/registrars-division/documents/2026-11/2027-yearbookpart4-artsandsocialsciences.pdf) has SHA-256 `4f38a2797d664e5be0066355caf2cbbc9500ae168a94c9238a52a912af454a1d`. Complete PDF pages 54–55, 77–79 and 82 were rendered and visually reviewed, including continuation text. The existing [faculty selection policy](https://files.su.ac.za/public/faculty-arts-and-social-sciences/documents/2026-03/fass-admissions-document-2027.pdf) explicitly lists the separate Music awards.

Four new identities are declared: **BMus**, **Higher Certificate in Music**, **Diploma (Practical Music)** and **Advanced Diploma (Practical Music)**. All belong to the faculty's undergraduate catalogue. Their award names remain explicit; certificate/diploma entries are not represented as bachelor degrees. BMus specialisations within the parent degree are not separate parent-course identities.

## Admission and progression distinctions

- BMus: NSC/IEB average 60% excluding Life Orientation; Mathematics 70% only for the specified Mathematics subjects. Its four-subject and language rules reuse two matching Arts facts. Practical Grade 7 and theory Grade 5 standards require proof in classical music through selection. Supplementary work, the specified bridging prerequisite and alternative preparation routes retain their conditions.
- Higher Certificate: four approved NSC subjects at code 3 (40–49%), excluding Life Orientation. The source's Grade V/VI practical and Grade III/IV theory wording is preserved; bowed strings specifically require Grade VI practical.
- Practical Music Diploma: the same four-subject NSC rule, stored once for both awards, with Grade VII practical and Grade III/IV theory. The certificate and diploma share one separately recorded audition/theory-test and supplementary-work policy.
- Advanced Diploma: a Practical Music Diploma or Senate-approved music qualification, and selection by audition. Conditional supplementary work is retained. These are `other` entry-route facts, not a school-leaver entry route.
- Higher Certificate progression still requires the destination diploma/degree's entrance conditions and selection. Exceptional entry from the completed Diploma to **BMus Year 2** requires **70% in each** of General Music Study 391 and Theory of Music 371, plus BMus admission and selection requirements. This is a `transfer` record, not a first-year cutoff.
- BMus has no ECP option. Its later specialisation selection belongs to the `other` route. Existing common faculty selection, application/document closing and qualification-specific NBT rules are linked only to the three first-year awards; no unsupported general school-leaver policy is attached to the Advanced Diploma.

No unpublished IB, A-level or AP score is inferred from music grades, NSC marks or tertiary module percentages. There are no new dedicated IB records.

## Artifact, verification and coverage

`data/sources/admissions-facts-stellenbosch-music-awards-2027-20261120.json` adds **13 distinct facts**, with **16 new-fact associations** and **11 associations reusing earlier rules**. Eight facts are first-year, four are `other` and one is `transfer`. Cross-programme common facts are stored once.

Validation and a zero-write preview passed. The completed Arts full archive was verified before import. Import created four courses and 13 facts with zero skips; repeat added nothing. Whole-database checks preserved all prior university, programme, profile, source and import rows, earlier fact content/shared-link prefixes and all 1,212 reviewed IB rows. All 20 prior Stellenbosch programme rows were unchanged.

The live API matched every fact, source, review date and all 27 associations. All 24 course/route/cohort searches passed, including empty first-year results for the Advanced Diploma, year and applicant isolation, and protection against bachelor-certificate rules appearing on the certificate/diploma. Programme search uses substring matching: a search for `Diploma (Practical Music)` also matches the Advanced Diploma; the verifier checks that union while checking each fact's exact course associations independently. Data quality checks passed.

Counts are **28,171 institutions, 281,735 courses, 3,836 profiles, 25,881 admission requirements, 108,020 sources and 135 import runs**. Reviewed general facts total **3,861 across 88 institutions**. Stellenbosch has **24 courses and 107 reviewed general facts**. Numerical IB coverage remains **716 courses**. Worldwide coverage is unfinished.

Complete readable archive: `backups/post-stellenbosch-music-20261120.drzk1_80`, SHA-256 `a2f1b917dd6a8fe5f7b6ce0bf8aea3f740e39897eb1bd7616a2969b777eb394d`. Captured page images, validation/import/repeat logs, metadata/fact fingerprints and API evidence remain in local backups.

Continue with the international booklet's remaining faculty tables, starting Economic and Management Sciences on PDF 18–21. Reuse the Data Science parent and independently verify programme-specific subject columns and faculty selection rules. The five earlier Agrisciences uncertainties, Arts Data Science language variation and Southampton Malaysia A-level ambiguities remain pending.
