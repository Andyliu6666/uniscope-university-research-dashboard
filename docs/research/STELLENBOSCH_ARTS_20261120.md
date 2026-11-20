# Stellenbosch Arts and Social Sciences — 2027 entry

Reviewed on November 20, 2026. Institution: Stellenbosch University, South Africa, ROR `05bk57929`, existing UUID `0805f68c-7ea8-40a2-bcd0-c13fc807b1cd`.

## Official evidence

| Source                                                                                                                                                    | Complete pages reviewed                                                          | SHA-256                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [2027 international booklet](https://files.su.ac.za/public/undergraduate-maties/documents/2026-03/2027su-international-booklet.pdf)                       | PDF 14–17, printed 24–31; qualification policies reviewed in the preceding batch | `6275bec23a38903a6fb41c947ba59357daafa6e05602b0432300b4319d43cd13` |
| [Arts faculty 2027 admissions policy](https://files.su.ac.za/public/faculty-arts-and-social-sciences/documents/2026-03/fass-admissions-document-2027.pdf) | All four pages                                                                   | `e86e865f456aac703d7de23b7f5fb9f75668e16a606a3738aa802d8ef431089b` |
| [November 2027 Arts yearbook](https://files.su.ac.za/public/registrars-division/documents/2026-11/2027-yearbookpart4-artsandsocialsciences.pdf)           | PDF 19, 21, 30, 37–38, 40, 42, 45–47, 49, 51, 63, 66 and 75                      | `4f38a2797d664e5be0066355caf2cbbc9500ae168a94c9238a52a912af454a1d` |
| [2027 Visual Arts portfolio instructions](https://files.su.ac.za/public/department-visual-arts/documents/2026-04/2027-portfolio-requirementspdf.pdf)      | Complete English instructions, PDF 1–8                                           | `b6317da5ca8b80bcc63c8a5b351fc7aa33b972f2a38795c70b6eb47180371b49` |

The raw sources and page images remain in local backups. They are not redistributed in the repository. Each fact has a source URL, page locator and review date.

## Scope and deduplication

`data/sources/admissions-facts-stellenbosch-arts-2027-20261120.json` contains ten new course identities: Humanities; Language and Culture; Development and Environment; Drama and Theatre; Human Resource Management; International Studies; Music; Political, Philosophical and Economic Studies; Social Work; and Visual Arts. The existing B Data Science identity is reused. The yearbook lists Data Science focal areas within the degree; they do not become duplicate parent programmes.

The batch adds **43 distinct facts**: 40 first-year rules and three separately scoped extended-curriculum rules. These have **146 course associations**. Another **146 associations** explicitly reuse existing reviewed requirements, giving **292 associations** in total. The original common qualification/exemption, USA/AP and relevant Mathematics facts are referenced by dataset/key instead of copied. Matching Arts Mathematics rows were checked separately before linking the existing fact. Original fact text, citations, IDs and earlier associations are preserved.

## Requirements retained

- International-curriculum SU-converted averages are 65% for the eight relevant Arts/Social Work rows and 60% for Music/Visual Arts. They are not IB totals. NSC/IEB mainstream averages, certificate conditions, languages and conditional Mathematics subjects are separately stated. Most linked NSC/IEB degrees require 63%; Drama requires 65%; Music and Visual Arts require 60%.
- Language and Culture, International Studies, Drama and Social Work retain their distinct language choices and grades. Economics, Mathematics and Organisational Informatics elective conditions are conditional, rather than imposed on every applicant.
- Data Science's general NSC conditions are average 80% excluding Life Orientation, Mathematics 80%, and one of the stated home/additional-language alternatives. The Arts/Geoinformatics international English column differs from the Agrisciences table. That difference is explicitly unresolved; neither table is silently imposed on every focal area.
- Faculty selection, July application/document closing, qualification-specific NBT timing, provisional acceptance, reissue requests and no-waiting-list conditions retain their source scope. Faculty policies linked to Data Science are qualified as applying to its Arts/Geoinformatics branch. Contradictory aggregate capacity arithmetic is not used to invent programme seats.
- ECP conditions apply only to the five eligible linked degrees and use the `other` entry route. Its discretionary four-year structure, variable threshold, mainstream restriction and January reconsideration procedure are kept separate from first-year mainstream admission. ECP exclusions for the named other degrees are explicit.
- Drama includes the personal audition/interview and spoken-language condition. Social Work includes its published selection priority bands, 100 first-year places and police clearance no older than six months at registration. Priority bands are not converted into guaranteed admission.
- BA Music's 2027 Music Production branch assesses technology/creativity and requires no previous formal music education. Practical Music Study separately auditions at Grade 7 practical/Grade 5 theory standard, with the published supplementary/alternative-route process. Neither branch becomes a universal rule for every Music applicant. Historical curriculum text is not mistaken for a new admission condition.
- Visual Arts includes originality/declaration, submission format, drawing, sculpture/story sequence, design process, additional work, a personal statement of at most two minutes, and panel/specialisation selection. The source's full creative briefs remain linked rather than copied. The programme-specific deadline is **31 August 2026 for 2027 entry**, supported by the dated portfolio PDF and department page. The general booklet's different 1 September date is retained as a source discrepancy, not a second equally authoritative deadline.

There are **no new dedicated IB score records** in this batch. Published IB subject grades remain available through shared general requirements. Exemption alternatives and converted averages are not fabricated programme IB totals. Earlier five Agrisciences uncertainties and five Southampton Malaysia A-level ambiguities remain pending.

## Import and verification

Schema validation and the zero-write preview passed. Preview correctly predicted 43 insertions, ten new courses, one reused parent and 146 prior-rule links. The previous full database archive was verified by checksum and complete restore-stream read before mutation.

Actual import inserted 43 facts with zero skips. Repeat import inserted nothing, skipped the same 43 already-completed records and reused all eleven declared identities. Whole-database comparisons preserved existing university rows, other programme rows, all ten earlier Stellenbosch programme rows, prior profile/source/import rows, earlier fact content and prior shared links. All **1,212 earlier IB records** retained their fingerprint. Repeat snapshots matched the first completed import.

Live API checks matched every new fact, citation, review date and all 292 associations. All 44 combinations of eleven courses, two entry routes and two applicant filters passed. Academic-year, domestic-applicant and transfer boundaries passed. Specific checks cover the portfolio date, six-month clearance, distinct Music focal areas and the unresolved Data Science variation. Data quality checks passed.

The database now contains **28,171 institutions, 281,731 courses, 3,835 profiles, 25,868 admission requirements, 108,020 sources and 134 import runs**. Reviewed general facts total **3,848 across 88 institutions**. Stellenbosch has **20 course identities and 94 reviewed general facts**. Numerical IB coverage remains **716 courses**, not an increase from this batch. **23,987 institutions still lack structured application facts**; worldwide coverage remains incomplete.

Complete readable archive: `backups/post-stellenbosch-arts-20261120.7_6kuiyu`, SHA-256 `c411d7b837bab7377665a68e4aed5f173e90c855fec8172028db873573fa4f88`. Local validation, preview/import/repeat, row comparisons and API evidence are saved under `backups/*stellenbosch-arts*20261120*`.

Next inspect the separate BMus, Higher Certificate, Diploma and Advanced Diploma admission sections on yearbook PDF 54–55, 77–79 and 82 before declaring further identities. They have not been imported by this Arts batch. BA Music's already completed branch rules must not be duplicated. Continue with remaining faculty tables and worldwide institutions after resolving these distinct routes.
