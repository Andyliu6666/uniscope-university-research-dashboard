import '../load-env.js';
import { sql, TransactionRollbackError } from 'drizzle-orm';
import { getConfig } from '../config.js';
import { createDb } from './client.js';

const connection = createDb(getConfig(), { max: 1 });
try {
  try {
    await connection.db.transaction(async (tx) => {
      await tx.execute(sql`
        DO $$
        DECLARE
          university uuid;
          evidence uuid;
          course uuid;
          selected_course uuid;
          iteration integer;
        BEGIN
          INSERT INTO universities (name, slug, country, city, website, summary, institution_type)
          VALUES ('Delivery scope probe', 'delivery-probe-' || gen_random_uuid(),
                  'Test', 'Test', 'https://example.invalid', 'Transactional admission scope test', 'unknown')
          RETURNING id INTO university;
          INSERT INTO sources (university_id, title, url, category, verified_at)
          VALUES (university, 'Test evidence', 'https://example.invalid/scope', 'official', now())
          RETURNING id INTO evidence;
          INSERT INTO programs (university_id, name, level, field)
          VALUES (university, 'Test course', 'undergraduate', 'Test') RETURNING id INTO course;
          FOR iteration IN 0..1 LOOP
            selected_course := CASE WHEN iteration = 0 THEN NULL ELSE course END;
            INSERT INTO admission_profiles
              (university_id, program_id, academic_year, source_id)
            VALUES (university, selected_course, '2026/2027', evidence);
            INSERT INTO admission_profiles
              (university_id, program_id, academic_year, delivery_mode, source_id)
            VALUES (university, selected_course, '2026/2027', 'distance', evidence);
            IF (SELECT count(*) FROM admission_profiles p
                WHERE p.university_id = university
                  AND p.program_id IS NOT DISTINCT FROM selected_course
                  AND p.delivery_mode = 'unspecified') <> 1 THEN
              RAISE EXCEPTION 'Legacy default scope was not preserved';
            END IF;
            IF (SELECT count(*) FROM admission_profiles p
                WHERE p.university_id = university
                  AND p.program_id IS NOT DISTINCT FROM selected_course
                  AND p.delivery_mode = 'distance') <> 1 THEN
              RAISE EXCEPTION 'Distance scope was not isolated';
            END IF;
            BEGIN
              INSERT INTO admission_profiles
                (university_id, program_id, academic_year, delivery_mode, source_id)
              VALUES (university, selected_course, '2026/2027', 'distance', evidence);
              RAISE EXCEPTION 'Duplicate distance scope was accepted';
            EXCEPTION WHEN unique_violation THEN
              NULL;
            END;
          END LOOP;
        END $$;
      `);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
} finally {
  await connection.close();
}
console.log('Admission delivery scope checks passed; all fixture rows rolled back.');
