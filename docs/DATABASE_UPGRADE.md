# Upgrading an existing UniScope database

Use a logical dump when changing PostgreSQL major versions or development snapshots. Run these steps in the original checkout with its original Compose project name and `.env`. Keep the old volume and a copy of the old checkout available until you have verified the new site. The web interface and imports share this database.

1. Before updating the checkout, stop imports and any other writers, stop the API and web services, and leave the database running. Save a new, private backup. Allow extra disk space for a second volume and the dump.

   ```bash
   docker compose stop api web
   mkdir -p backups
   archive="backups/pre-upgrade-$(date +%Y%m%d-%H%M%S).dump"
   docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$archive" &&
     docker compose exec -T db pg_restore --exit-on-error --file=/dev/null < "$archive"
   ```

2. With the updated checkout, build the new services. Start a temporary database container against the **new, empty snapshot volume**. Keep the original database available while verifying the copy. On a retry, inspect the candidate before restoring again.

   ```bash
   docker compose build
   docker compose run --no-deps -d --name uniscope-upgrade-check db
   docker inspect -f '{{.State.Health.Status}}' uniscope-upgrade-check
   ```

3. Once the temporary database is healthy, restore the archive in one transaction. Compare the row counts with the original database, including universities, programmes and admission requirements. Installations with extra databases, roles or tablespaces must also migrate those objects.

   ```bash
   docker exec -i uniscope-upgrade-check sh -c 'pg_restore --exit-on-error --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$archive"
   docker exec uniscope-upgrade-check sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT (SELECT count(*) FROM universities) AS universities, (SELECT count(*) FROM programs) AS programs, (SELECT count(*) FROM admission_requirements) AS requirements"'
   ```

4. After verification, stop and remove the temporary **container**. The restored data stays in its named volume. Start the normal services and run the database checks.

   ```bash
   docker stop uniscope-upgrade-check && docker rm uniscope-upgrade-check
   docker compose up -d --wait
   ./scripts/check-data-quality.sh
   ```

5. Open a university profile and check its admissions sources. For rollback before resuming writes, stop the upgraded services, return to the previous checkout with the same project name and environment, and start its Compose services against the original volume. After new writes, save them before rolling back.
