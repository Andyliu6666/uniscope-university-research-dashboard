import { asc, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { institutionIdentifiers } from '../db/schema.js';

type IdentifierOwnershipDatabase = Pick<Database, 'select'>;

export type IdentifierOwnershipConflict = {
  provider: string;
  universityId: string;
  externalIds: string[];
};

export const assertNoIdentifierOwnershipConflicts = (
  conflicts: IdentifierOwnershipConflict[],
  context: string,
) => {
  if (conflicts.length === 0) return;
  const details = conflicts
    .map((conflict) => ({
      ...conflict,
      externalIds: [...conflict.externalIds].sort(),
    }))
    .sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) ||
        left.universityId.localeCompare(right.universityId),
    )
    .map(
      ({ provider, universityId, externalIds }) =>
        `${provider}/${universityId}=[${externalIds.join(', ')}]`,
    )
    .join('; ');
  throw new Error(
    `${context} refused: this provider requires at most one identifier per university. ` +
      `Resolve these institution_identifiers conflicts first: ${details}.`,
  );
};

/**
 * Importers call this before any identity-dependent mutation. The database
 * partial unique index prevents new ROR/OpenAlex conflicts, while this gate
 * makes unresolved legacy conflicts fail deterministically instead of relying
 * on row/Map order. Other providers can intentionally remain one-to-many.
 */
export const assertProviderIdentifierOwnership = async (
  db: IdentifierOwnershipDatabase,
  providers: string[],
  context: string,
) => {
  const uniqueProviders = [...new Set(providers)].sort();
  if (uniqueProviders.length === 0) return;
  const conflicts = await db
    .select({
      provider: institutionIdentifiers.provider,
      universityId: institutionIdentifiers.universityId,
      externalIds: sql<
        string[]
      >`array_agg(${institutionIdentifiers.externalId} order by ${institutionIdentifiers.externalId})`,
    })
    .from(institutionIdentifiers)
    .where(inArray(institutionIdentifiers.provider, uniqueProviders))
    .groupBy(institutionIdentifiers.provider, institutionIdentifiers.universityId)
    .having(sql`count(*) > 1`)
    .orderBy(asc(institutionIdentifiers.provider), asc(institutionIdentifiers.universityId))
    .limit(20);
  assertNoIdentifierOwnershipConflicts(conflicts, context);
};
