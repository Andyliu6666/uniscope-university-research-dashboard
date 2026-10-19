# Admissions review: Ghana and South Pacific, 18 October 2026

This is a bounded reviewed increment, not complete coverage of these institutions or the 28,171-institution directory. No third-party estimated minimum, generated requirement, employment outcome or silent qualification conversion is included.

## Exact identities and artifacts

| Institution                           | Existing identity | General facts |           IB records |
| ------------------------------------- | ----------------- | ------------: | -------------------: |
| Ashesi University, Ghana              | ROR `028kehd60`   |            29 | 1 institution policy |
| University of Ghana, Ghana            | ROR `01r22mr83`   |            21 | 20 programme records |
| University of the South Pacific, Fiji | ROR `008stv805`   |            37 | 1 institution policy |

General artifact: `data/sources/admissions-facts-ghana-pacific-20261018.json` (87 facts, 30 scopes, 19 source-linked programme declarations). IB artifact: `data/sources/ib-requirements-ghana-pacific-20261018.json` (22 records, including 20 programmes). University-wide shared conditions are not cloned to every course. Matching Cambridge conditions published for Ghanaian and international applicants are stored once with the explicit qualification restriction; international WASSCE differences have their own scope. Qualification routes are alternatives, not a requirement to take every exam listed.

## Official evidence and source dates

All sources below were successfully retrieved over verified HTTPS on October 18. Raw captures and complete PDFs remain outside Git in the task's `tmp/` directory; only concise factual paraphrases and source references are committed.

- [Ashesi application FAQ](https://ashesi.edu.gh/how-to-apply/): undergraduate qualification routes, transcripts, shortlist interviews, consideration of personal essays/extracurriculars, updating awards, awaiting results, fee/waiver process, international translations/language evidence, transfer documents and three graduate programmes. These FAQ rules are undated: neither the review date nor footer becomes an entry year. The FAQ does not specify an IB total, SAT/ACT/AP minimum, compulsory prize or current essay prompt/word count.
- [Linked Ashesi paper application](https://ashesi.edu.gh/wp-content/uploads/2024/07/Ashesi_University_Admissions_Application_Form_2024.pdf): explicitly labelled **2024/25**, PDF page 8 / printed page 7. Complete pages 8-9 rendered and visually inspected. Two-essay instructions and AI-authorship warning are retained only in a historical 2024/25 scope. Old deadlines and fees are not made current. SHA-256 `f10ae29ab44c7d982f419a6b67ae6f63b3a5840fb7edfede24dbf39fa2a3f012`.
- [Ghana domestic entry requirements](https://admissions.ug.edu.gh/undergraduate/entry-requirements): Ghanaian WASSCE/SSSCE baseline and aggregate method, Cambridge baseline and distinct programme subject combinations. Page includes a “show more” control: the initial programme blocks are not claimed to be its entire catalogue. Captured HTML SHA-256 `583ba8ba6211158ee1f33a9e391db019a35a89b9f9a4bb696b58c8956cdf875d`.
- [Ghana explicit international requirements](https://admissions.ug.edu.gh/international/requirements): states non-Ghanaian first-year scope, regardless of where applicants studied, and excludes transfers. IB blocks give subject/HL/SL requirements for 20 named programmes, not IB totals. Cambridge blocks corroborate the shared subject conditions. Captured HTML SHA-256 `bffea1d901d80454de8132b40abe182979f437eb1640a95d1f09c32d7b25aa30`.
- [USP 2026 handbook](https://www.usp.ac.fj/handbookandcalendar2026/wp-content/uploads/sites/176/2026/01/2026-Handbook-and-Calendar_updated.pdf): printed pages 78-84 and 95 / PDF pages 79-85 and 96, all rendered and visually inspected as complete pages. This batch uses the international **diploma/undergraduate** column, not the foundation/postgraduate columns, for 19 country-qualification routes, IB 24 and English alternatives. Shared application documents and mature-entry rules are recorded separately. SHA-256 `1c55947b95e89a0d6a0f2ef0240dc79c00b1d370e3cbdf8fd382724e42534a4b`.

## Ambiguities preserved, not guessed

1. Ghana's international IB introduction repeats Cambridge A-level text, and the domestic IB panel has an international heading. Use the explicit international page's individually labelled IB blocks, never convert the copied introduction into an IB condition. The American high-school panel contains the same unrelated introduction and empty programme blocks: no American/AP/SAT minimum is accepted from it.
2. Ghana Medicine specifies HL Chemistry at 5, but no numeric minimum for the other described HL/SL science pair. Do not change that to three HL grades of 5. Veterinary Medicine does not independently require SL Mathematics in its IB block. Psychology and some education blocks list Mathematics at both levels; preserve the published overlap and request clarification.
3. Ghana Fine Arts Cambridge block mentions aggregate 12 without a defined scale, while international WASSCE uses 24. Record the explicit audition/interview, but do not assign 12 to IB or invent a Cambridge-points scale.
4. USP defines international as citizenship outside USP-member countries, not simply non-Fijian. Country names in the equivalency table identify the qualification system, not a nationality restriction.
5. USP Cambridge CAE 52 has no modern scale identified. Legacy TOEFL paper/computer entries and particularly paper writing 59 need scale/availability clarification. Preserve these as `unknown`, not a modern usable threshold or a conversion. HKDSE's “level 4 core subjects” and Korea's “above mi (70-79)” wording are likewise unresolved.
6. USP's IB 24 is a general academic-equivalency minimum, not a programme guarantee. The IB Diploma's 45-point scale is identified; the source does not separately state core-point inclusion, retained as unknown. The language table's HL 4 has no subject name: preserve that ambiguity in subject notes, not as an extra universal HL pattern.
7. No official compulsory competition/prize threshold was found in this reviewed set. Ashesi's update-awards facility is optional; extracurriculars/personal essays are considered. Absence of an AP/SAT/competition statement is not a published `not_required` policy.

## Explicit remaining work

Follow Ghana's remaining programme pages and official current application instructions; reconcile copied/empty panels before expanding qualifications. Inspect the current Ashesi application portal before asserting current essay counts or prompts; do not require login or submit an application merely to research. Continue USP regional, foundation, postgraduate and programme-specific sections without borrowing adjacent table columns. Confirm legacy language scales with a newer explicit official policy. Expand the source queue to other under-researched institutions and continents. No institution is marked fully researched by this increment.

General admissions API/UI pagination replaces the former silent 50-profile cutoff. The bounded default remains 50; `page`/`pageSize` preserve existing scope filters. IB-only pages still allow navigation to later general requirements. Request failures are displayed as errors, not as evidence that requirements are missing.
