import '../load-env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, TransactionRollbackError } from 'drizzle-orm';
import { getConfig } from '../config.js';
import { getUniversityAdmissions } from '../services/university-service.js';
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
      const slug = `programme-search-probe-${randomUUID()}`;
      await tx.execute(sql`
        WITH seed_university AS (
          INSERT INTO universities (name, slug, country, city, website, summary, institution_type)
          VALUES ('Programme search probe', ${slug}, 'Test', 'Test',
                  'https://example.invalid', 'Transactional programme search test', 'unknown')
          RETURNING id
        ), evidence AS (
          INSERT INTO sources (university_id, title, url, category, verified_at)
          SELECT id, 'Test evidence', 'https://example.invalid/programme', 'official', now()
          FROM seed_university RETURNING id, university_id
        ), course AS (
          INSERT INTO programs (university_id, name, level, field)
          SELECT id, title, 'undergraduate', 'Test' FROM seed_university
          CROSS JOIN (VALUES ('Test 100% Course'), ('Test 100X Course'), ('Direct Course')) AS names(title)
          RETURNING id, name, university_id
        ), scope AS (
          INSERT INTO admission_profiles
            (university_id, academic_year, delivery_mode, applicant_type, level, source_id)
          SELECT university_id, '2026/2027', 'campus', 'domestic', 'undergraduate', id FROM evidence
          RETURNING id, university_id, source_id
        ), direct_scope AS (
          INSERT INTO admission_profiles
            (university_id, program_id, academic_year, delivery_mode, applicant_type, level, source_id)
          SELECT scope.university_id, course.id, '2026/2027', 'campus', 'domestic', 'undergraduate', scope.source_id
          FROM scope CROSS JOIN course WHERE course.name = 'Direct Course'
        )
        INSERT INTO admission_requirements
          (admission_profile_id, category, requirement_key, label, status, details, source_id, source_flags)
        SELECT scope.id, 'academic'::requirement_category, 'linked', 'Linked programme rule',
               'required'::requirement_status, 'Reviewed requirement',
               scope.source_id, jsonb_build_object('sharedProgramIds', jsonb_agg(course.id))
        FROM scope CROSS JOIN course WHERE course.name IN ('Test 100% Course', 'Direct Course')
        GROUP BY scope.id, scope.source_id
        UNION ALL
        SELECT scope.id, 'academic', 'unrelated', 'Unrelated profile information', 'required',
               'Irrelevant requirement', scope.source_id,
               jsonb_build_object('sharedProgramIds', jsonb_build_array(course.id))
        FROM scope CROSS JOIN course WHERE course.name = 'Test 100X Course'
      `);

      const query = { year: '2026/2027', applicantType: 'domestic' } as const;
      const linked = await getUniversityAdmissions(tx, slug, { ...query, programme: '100%' });
      assert.equal(linked?.pagination.total, 1);
      assert.deepEqual(
        linked.profiles[0]?.requirements.map((rule) => rule.requirementKey),
        ['linked'],
      );
      assert.deepEqual(
        linked.profiles[0]?.requirements[0]?.sharedPrograms?.map((program) => program.name),
        ['Test 100% Course'],
      );
      const direct = await getUniversityAdmissions(tx, slug, {
        ...query,
        programme: 'Direct Course',
      });
      assert.equal(direct?.pagination.total, 1);
      assert.equal(direct.profiles[0]?.programName, 'Direct Course');
      assert.deepEqual(
        direct.profiles[0]?.sharedRequirements?.map((rule) => rule.requirementKey),
        ['linked'],
      );
      const otherDelivery = await getUniversityAdmissions(tx, slug, {
        ...query,
        programme: 'Test 100% Course',
        deliveryMode: 'distance',
      });
      assert.equal(otherDelivery?.pagination.total, 0);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
} finally {
  await connection.close();
}
console.log(
  'Admission delivery scope and linked programme search checks passed; all fixture rows rolled back.',
);
