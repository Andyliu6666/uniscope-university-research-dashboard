# Contributing to UniScope

Contributions can be as small as fixing one deadline. You do not need to commit to the project long-term.

## Data contributions

1. Create a clearly named JSON file under `data/`, using `data/myuniversity.json` as the structural reference.
2. Keep the slug lowercase and hyphenated.
3. Prefer official university admissions, tuition, and program pages.
4. Set unknown numerical facts to `null`; never estimate them.
5. Write a neutral summary and avoid ranking or marketing claims.
6. Run the import command against a local database, then open a pull request with the JSON file and a short note about what you verified.

Reviewers check schema validity, source quality, neutral wording, and whether dates and costs clearly match the applicant type. A data-only contribution should not edit application code.

## Code contributions

Before opening a pull request, run `pnpm check`. Keep changes focused. New dependencies or abstractions should solve a current requirement, not a hypothetical future one.

If a formatting check fails, run `pnpm format`, review the diff, then run `pnpm check` before committing. Hand-edited JSON and migration metadata follow the same formatting rules as code; downloaded source artifacts and generated reports retain their defined bytes and exclusions.

GitHub CI checks code quality and also applies database migrations twice to a temporary PostgreSQL database from a checkout path containing spaces. For a historical red check, open its failed step and compare its commit with the latest branch: rerunning an old commit does not include a later fix. The CI workflow can also be run manually against the current branch. See [the failure audit](docs/CI_FAILURE_AUDIT_20261018.md) for the reviewed historical failures.

## Community expectations

Be welcoming to student contributors, explain review requests clearly, and do not publish private applicant information. Harassment, discrimination, and plagiarism are not accepted.
