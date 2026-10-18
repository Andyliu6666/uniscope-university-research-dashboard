# Strathmore programme IB review — 2026-10-01

Artifact: `data/sources/ib-requirements-strathmore-20261001.json`, version `official-ib-strathmore-2026-10-01-v1`.

## Reviewed programme sources

Seven undergraduate programme requirements were reviewed. Each cited page explicitly publishes **34 out of 45**, not a school-wide floor copied to different programmes. All use the minimum-entry interpretation, not guaranteed admission. They do not specify the entry year of the IB rule; `academicYear` stays `unspecified`. A 45-point scale is explicit, but a separate statement about core-point treatment is absent, so that flag stays null.

- [Computer Networks and Cyber Security](https://strathmore.edu/bsc-computer-networks-and-cyber-security/)
- [Electrical and Electronics Engineering](https://strathmore.edu/bsc-in-electrical-and-electronics-engineering/) — the [faculty programme page](https://sces.strathmore.edu/academic-programmes/bachelor-of-science-in-electrical-and-electronics-engineering/) independently gives the same total.
- [Financial Economics](https://strathmore.edu/bsc-financial-economics/)
- [Financial Engineering](https://strathmore.edu/bbsc-financial-engineering/)
- [Actuarial Science](https://strathmore.edu/bbs-actuarial-science/)
- [Informatics and Computer Science](https://strathmore.edu/bsc-in-informatics-and-computer-science/)
- [Law School undergraduate admissions](https://law.strathmore.edu/admissions/) — also requires English 6, without specifying HL/SL or a course variant. Do not put that grade into `hlGrades`.

All seven primary HTML pages were read directly over verified HTTPS using curl on October 1. Node's TLS path rejected an incomplete certificate chain and the web reader timed out on some pages; neither certificate verification nor access controls was disabled. Successful curl responses supplied the actual admissions text, not merely a search snippet.

Additional conditions remain on each record: entrance examinations/interview, supporting documents, examination fee and foreign-qualification equivalence. KCSE grades are not converted to invented IB subject grades. April/June intake months are retained where supplied, without assigning a year or publishing an open deadline. Law's February 2026 entrance-test notice is not treated as the year of the undated IB rule.

The [older Financial Economics prospectus](https://www.strathmore.edu/prospectus/undergraduate/files/assets/basic-html/page42.html) mentions English/Mathematics grade 5 but has no readable total and different intake/fee information. The record flags subject clarification; it does not mix that older page into the current programme page's numerical fields.

## Conflicts and deferred candidates

These candidates are **not imported**:

- Communication and International Studies: [central Communication](https://strathmore.edu/ba-in-communication/) and [central International Studies](https://strathmore.edu/ba-in-international-studies/) say 30/45, whereas [faculty Communication](https://shss.strathmore.edu/bachelor-of-arts-in-communication/) and [faculty International Studies](https://shss.strathmore.edu/bachelor-of-arts-in-international-studies-bis/) say 24 plus English 5 and Mathematics 4. No authoritative superseding date was established. Do not choose a preferred threshold or turn this disagreement into a 24–30 offer range.
- Financial Services: [central page](https://strathmore.edu/bachelor-of-financial-services/) says 30/45; [business-school page](https://sbs.strathmore.edu/en_gb/programme/bachelor-of-financial-services/) says 34/45. Needs source reconciliation.
- Supply Chain and Operations Management: its [business-school page](https://sbs.strathmore.edu/en_gb/programme/bachelor-of-supply-chain-and-operations-management/) mixes a 2025 intake section with a 2026 intake banner. Deferred for a separate scope review.
- Pretoria BIS Multimedia, Information Science and Publishing: official indexed departmental pages publish HL grade 4 and APS values, not IB Diploma totals. Direct requests returned HTTP 403. Research leads: [Multimedia](https://www.up.ac.za/information-science/bis-multimedia-code-12131013), [Information Science](https://www.up.ac.za/information-science/bis-information-science-code-12240012), [Publishing](https://www.up.ac.za/information-science/bis-publishing-code-12131014). The Information Science page also contains a copied Multimedia curriculum sentence. No new Pretoria records were imported from these leads; verify against the intended admission cycle before use.

## Identity and import checkpoint

Exact ROR `047dnqw48`, country `KE`, official domain `strathmore.edu`; local UUID `36afd6eb-9eaa-44b4-a963-e65abfce0570`, slug `strathmore-university-047dnqw48`. Before the batch, the database had zero programmes at this institution. No existing user-created course is being replaced. Course codes are null because the selected sources supply no official admission code.

October 1 schema validation passed: seven programme records, seven explicit totals. Read-only database preview: seven insert candidates, zero updates, zero rejections. After a verified backup, the actual local database import inserted seven requirements and seven programmes, with zero updates and zero rejections. A repeat reported `already-completed` and created no duplicates. The actual website API returned all seven exact requirement objects; applicant/year/route/level filters, search and pagination were checked. The API image was rebuilt with this source artifact. Post-build verification and final recovery results are recorded in `docs/IB_PROGRESS.md`. No GitHub push or separate hosted deployment is implied.
