# Latin American IB admissions requirements — review 2026-09-16

Artifact: `data/sources/ib-requirements-latin-america-20260916.json` (`official-ib-latin-america-2026-09-16-v1`). Review date and every source `checkedOn`: 2026-09-16.

Four records across two institutions: three programme-specific requirements in Chile and one university-level undergraduate admission policy in Peru. All four sources publish numeric totals, but only three are programme cutoffs. The ESAN policy is not copied into individual courses.

## Sources and retained distinctions

| Institution / scope                                       | Published total | Official source and additional conditions                                                                                                                                                                                                                         |
| --------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Universidad de los Andes (Chile) — Arquitectura           | 26/45           | [Programme IB route](https://admision.uandes.cl/admision/admision-directa/detalle/arq---rendimiento-acad%C3%A9mico/arq---rendimiento-acad%C3%A9mico---diploma-ib): grade 4 in Individuals and Societies; the source does not specify HL or SL.                    |
| Universidad de los Andes (Chile) — Ciencia Política       | 26/45           | [Programme IB route](https://admision.uandes.cl/admision/admision-directa/detalle/cpo---rendimiento-acad%C3%A9mico/cpo---rendimiento-acad%C3%A9mico---diploma-ib): grade 4 in Individuals and Societies, with no stated HL/SL level.                              |
| Universidad de los Andes (Chile) — Odontología            | 28/45           | [Programme IB route](https://admision.uandes.cl/admision/admision-directa/detalle/odo-rendimiento-academico/odo---rendimiento-acad%C3%A9mico---diploma-ib): grade 4 in Experimental Sciences, with no stated HL/SL level.                                         |
| Universidad ESAN — university-level IB admission modality | 24/45           | [Undergraduate IB modality](https://ue.edu.pe/pregrado/admision/modalidades/bachillerato-internacional): direct-entry threshold, still subject to registration, document validation and application fee. No numerical IB subject-grade pattern is published here. |

The [UANDES direct-admission catalogue](https://admision.uandes.cl/admision/admision-directa) explicitly identifies the first-semester 2027 cycle and links these three course-specific IB pages. Their records are therefore academic year `2027`, first semester / March, not dated from a footer. First-time applicants must finish secondary school in the application year or preceding year. School transcripts, final or predicted IB results, and a motivation letter are required; foreign-school document equivalencies need confirmation. Eligible applicants compete for vacancies, with interviews to resolve ties. Formal enrolment/payment is still required and this route has no associated academic scholarships. A published minimum is not an admission guarantee.

ESAN explicitly labels its cycle `2027-1`, with classes beginning in March 2027. Its displayed August 2026 application window was already past at the review date. The record preserves that limitation and directs applicants to ask about subsequent rounds; it does not present the window as open. Credit recognition is a separate process from this entrance threshold. `program: null` deliberately keeps the rule in the university-policy section.

All score scales are 45; whether core points are included remains null because the reviewed statements do not explicitly settle it. No official programme codes or HL grades are invented.

## Institution identities

| Institution                      | Exact ROR ID | Country | Reviewed official domains                  |
| -------------------------------- | ------------ | ------- | ------------------------------------------ |
| Universidad de los Andes (Chile) | `03v0qd864`  | CL      | `uandes.cl`                                |
| Universidad ESAN                 | `05dm6rc87`  | PE      | `ue.edu.pe`, `esan.edu.pe`, `uesan.edu.pe` |

The Chilean identity is explicitly distinguished from other institutions named Universidad de los Andes. These records attach only to the exact local ROR and country matches.

## Deferred and excluded candidates

- UANDES Nutrición was not imported: an older indexed snippet gave 26 points, while the retrieved detail showed 25, and the course was not present in the reviewed 2027 catalogue. No stale snippet was promoted into a 2027 score.
- An exploratory Universidad de Lima 28-point lead may describe credit recognition rather than entry eligibility. It remains outside the artifact pending a clearly scoped admission source.

## Validation and local import

Schema validation and the read-only database dry-run passed. Final local import on 2026-09-16 inserted four records and three programmes with zero rejections. The remaining record is the ESAN university policy. Repeating the artifact reported all four already completed and made no duplicate insertions. The main progress checkpoint records the broader API, interface, coverage and backup checks. This batch does not imply full programme or regional coverage.
