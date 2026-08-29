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

## Community expectations

Be welcoming to student contributors, explain review requests clearly, and do not publish private applicant information. Harassment, discrimination, and plagiarism are not accepted.
