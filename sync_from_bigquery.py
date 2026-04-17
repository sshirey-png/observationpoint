"""
ObservationPoint — Sync BigQuery → PostgreSQL

Refreshes the PostgreSQL database from BigQuery source tables.
Idempotent — safe to run daily or on demand.

1. Staff from staff_master_list_with_function
2. ALL touchpoints from observationpoint.touchpoints (scored + unscored)
3. Scores from observationpoint.scores

Usage:
    DB_PASS=xxx python sync_from_bigquery.py
"""
import os
import json
import logging
import psycopg2
from psycopg2.extras import execute_values
from google.cloud import bigquery
from datetime import date

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

PROJECT_ID = 'talent-demo-482004'
DB_HOST = os.environ.get('DB_HOST') or '35.184.9.224'
DB_NAME = os.environ.get('DB_NAME') or 'observationpoint'
DB_USER = os.environ.get('DB_USER') or 'postgres'
DB_PASS = os.environ.get('DB_PASS') or ''
DB_PORT = os.environ.get('DB_PORT') or '5432'
DB_SOCKET = os.environ.get('DB_SOCKET') or ''


def get_conn():
    if DB_SOCKET:
        return psycopg2.connect(dbname=DB_NAME, user=DB_USER, password=DB_PASS, host=DB_SOCKET)
    return psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS)


def sync_staff(bq, conn):
    """Sync staff from staff_master_list_with_function."""
    log.info("Syncing staff...")
    rows = list(bq.query(f"""
        SELECT
            LOWER(TRIM(Email_Address)) as email,
            First_Name, Last_Name, Employee_Number,
            Job_Title, Job_Function, Location_Name, Dept,
            Supervisor_Name__Unsecured_ as supervisor_name,
            Subject_Desc, Grade_Level_Desc,
            Last_Hire_Date, Salary_or_Hourly, Employment_Status
        FROM `{PROJECT_ID}.talent_grow_observations.staff_master_list_with_function`
        WHERE Email_Address IS NOT NULL AND TRIM(Email_Address) != ''
    """).result())
    log.info(f"  {len(rows)} staff from BigQuery")

    # Build supervisor name→email map for resolving hierarchy
    name_to_email = {}
    for r in rows:
        if r.email and r.Last_Name and r.First_Name:
            key = f'{r.Last_Name}, {r.First_Name}'.lower().strip()
            name_to_email[key] = r.email
            short_first = r.First_Name.split()[0] if r.First_Name else ''
            short_key = f'{r.Last_Name}, {short_first}'.lower().strip()
            if short_key not in name_to_email:
                name_to_email[short_key] = r.email

    cur = conn.cursor()

    # Mark all staff inactive first, then re-activate the ones in BQ
    cur.execute("UPDATE staff SET is_active = FALSE, updated_at = NOW()")

    upserted = 0
    for r in rows:
        if not r.email:
            continue

        # Resolve supervisor name to email
        sup_email = None
        if r.supervisor_name:
            key = r.supervisor_name.lower().strip()
            sup_email = name_to_email.get(key)
            if not sup_email:
                parts = key.split(',')
                if len(parts) == 2:
                    last = parts[0].strip()
                    first = parts[1].strip().split()[0] if parts[1].strip() else ''
                    sup_email = name_to_email.get(f'{last}, {first}')

        is_active = (r.Employment_Status or '').strip() in ('Active', 'Leave of absence', '')
        hire_date = r.Last_Hire_Date.date() if hasattr(r.Last_Hire_Date, 'date') and r.Last_Hire_Date else None

        cur.execute("""
            INSERT INTO staff (email, first_name, last_name, employee_number, job_title,
                job_function, school, department, supervisor_email, subject, grade_level,
                is_active, hire_date, salary_or_hourly, employment_status, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
            ON CONFLICT (email) DO UPDATE SET
                first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
                employee_number=EXCLUDED.employee_number, job_title=EXCLUDED.job_title,
                job_function=EXCLUDED.job_function, school=EXCLUDED.school,
                department=EXCLUDED.department, supervisor_email=EXCLUDED.supervisor_email,
                subject=EXCLUDED.subject, grade_level=EXCLUDED.grade_level,
                is_active=EXCLUDED.is_active, hire_date=EXCLUDED.hire_date,
                salary_or_hourly=EXCLUDED.salary_or_hourly,
                employment_status=EXCLUDED.employment_status, updated_at=NOW()
        """, (r.email, r.First_Name, r.Last_Name, r.Employee_Number,
              r.Job_Title, r.Job_Function, r.Location_Name, r.Dept,
              sup_email, r.Subject_Desc, r.Grade_Level_Desc,
              is_active, hire_date, r.Salary_or_Hourly,
              (r.Employment_Status or '').strip()))
        upserted += 1

    conn.commit()
    cur.execute("SELECT COUNT(*) FROM staff WHERE is_active")
    active = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM staff WHERE supervisor_email IS NOT NULL AND supervisor_email != '' AND is_active")
    with_sup = cur.fetchone()[0]
    log.info(f"  Upserted {upserted}, active: {active}, with supervisor_email: {with_sup}")


def sync_touchpoints(bq, conn):
    """Sync ALL touchpoints from BigQuery (scored + unscored)."""
    log.info("Syncing touchpoints...")

    rows = list(bq.query(f"""
        SELECT id, form_type, teacher_email, observer_email, school, school_year,
               touchpoint_date, status, notes,
               scores_json, feedback_json, meeting_json, goals_json,
               commitments_json, career_json, concerns_json, payload_json,
               participant_emails, created_at, updated_at, published_at
        FROM `{PROJECT_ID}.observationpoint.touchpoints`
        WHERE school_year IN ('2023-2024', '2024-2025', '2025-2026')
    """).result())
    log.info(f"  {len(rows)} touchpoints from BigQuery")

    cur = conn.cursor()

    # Get existing staff emails for foreign key validation
    cur.execute("SELECT email FROM staff")
    known_staff = set(r[0] for r in cur.fetchall())

    inserted = 0
    skipped = 0
    for r in rows:
        teacher = (r.teacher_email or '').strip().lower()
        observer = (r.observer_email or '').strip().lower()

        # Insert missing staff as inactive (former employees referenced in touchpoints)
        for email in [teacher, observer]:
            if email and email not in known_staff:
                cur.execute("""
                    INSERT INTO staff (email, is_active) VALUES (%s, FALSE)
                    ON CONFLICT (email) DO NOTHING
                """, (email,))
                known_staff.add(email)

        if not teacher:
            skipped += 1
            continue

        obs_date = r.touchpoint_date or r.created_at

        def to_json(val):
            if val is None:
                return None
            if isinstance(val, dict):
                return json.dumps(val)
            if isinstance(val, str):
                val = val.strip()
                if val and val[0] in ('{', '['):
                    return val  # already JSON string
                return None
            return None

        cur.execute("""
            INSERT INTO touchpoints (id, form_type, teacher_email, observer_email, school,
                school_year, observed_at, status, is_published, notes,
                scores_json, feedback_json, meeting_json, goals_json,
                commitments_json, career_json, concerns_json, payload_json,
                participant_emails, created_at, updated_at, published_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO UPDATE SET
                form_type=EXCLUDED.form_type, school=EXCLUDED.school,
                status=EXCLUDED.status, notes=EXCLUDED.notes,
                scores_json=EXCLUDED.scores_json, feedback_json=EXCLUDED.feedback_json,
                meeting_json=EXCLUDED.meeting_json, goals_json=EXCLUDED.goals_json,
                updated_at=NOW()
        """, (r.id, r.form_type, teacher, observer or teacher,
              r.school or '', r.school_year, obs_date,
              r.status or 'published', True, r.notes,
              to_json(r.scores_json), to_json(r.feedback_json),
              to_json(r.meeting_json), to_json(r.goals_json),
              to_json(r.commitments_json), to_json(r.career_json),
              to_json(r.concerns_json), to_json(r.payload_json),
              r.participant_emails,
              r.created_at, r.updated_at, r.published_at))
        inserted += 1

        if inserted % 1000 == 0:
            conn.commit()
            log.info(f"  {inserted} touchpoints...")

    conn.commit()
    log.info(f"  Synced {inserted} touchpoints, skipped {skipped}")

    # Backfill school from staff table where missing
    cur.execute("""
        UPDATE touchpoints t SET school = s.school
        FROM staff s WHERE t.teacher_email = s.email
        AND (t.school IS NULL OR t.school = '') AND s.school IS NOT NULL AND s.school != ''
    """)
    backfilled = cur.rowcount
    conn.commit()
    log.info(f"  Backfilled school on {backfilled} touchpoints")

    # Report by form_type
    cur.execute("SELECT form_type, COUNT(*) FROM touchpoints GROUP BY form_type ORDER BY COUNT(*) DESC")
    log.info("  Touchpoints by type:")
    for ft, cnt in cur.fetchall():
        log.info(f"    {ft:35s} {cnt}")


def sync_scores(bq, conn):
    """Sync dimension scores from BigQuery."""
    log.info("Syncing scores...")

    rows = list(bq.query(f"""
        SELECT touchpoint_id, dimension_code, dimension_name, score, cycle
        FROM `{PROJECT_ID}.observationpoint.scores`
        WHERE school_year IN ('2023-2024', '2024-2025', '2025-2026')
    """).result())
    log.info(f"  {len(rows)} scores from BigQuery")

    cur = conn.cursor()

    # Get existing touchpoint IDs in PostgreSQL
    cur.execute("SELECT id::text FROM touchpoints")
    valid_tps = set(r[0] for r in cur.fetchall())

    # Clear and reload (scores don't have a natural PK for upsert)
    cur.execute("DELETE FROM scores")
    conn.commit()

    batch = []
    skipped = 0
    for r in rows:
        tp_id = r.touchpoint_id
        if tp_id not in valid_tps:
            skipped += 1
            continue
        batch.append((tp_id, r.dimension_code, r.dimension_name, float(r.score), r.cycle))

    log.info(f"  Loading {len(batch)} scores, skipped {skipped} (no matching touchpoint)")

    for i in range(0, len(batch), 5000):
        chunk = batch[i:i+5000]
        execute_values(cur,
            "INSERT INTO scores (touchpoint_id, dimension_code, dimension_name, score, cycle) VALUES %s",
            chunk, page_size=500)
        conn.commit()
        log.info(f"    {min(i+5000, len(batch))}/{len(batch)}")

    log.info(f"  Scores synced: {len(batch)}")


def main():
    if not DB_PASS:
        log.error("Set DB_PASS environment variable")
        return

    bq = bigquery.Client(project=PROJECT_ID)
    conn = get_conn()

    log.info("=" * 60)
    log.info("ObservationPoint — BigQuery → PostgreSQL Sync")
    log.info("=" * 60)

    sync_staff(bq, conn)
    sync_touchpoints(bq, conn)
    sync_scores(bq, conn)

    # Final counts
    cur = conn.cursor()
    log.info("\nFinal counts:")
    for t in ['staff', 'touchpoints', 'scores']:
        cur.execute(f"SELECT COUNT(*) FROM {t}")
        total = cur.fetchone()[0]
        if t == 'staff':
            cur.execute(f"SELECT COUNT(*) FROM {t} WHERE is_active")
            active = cur.fetchone()[0]
            log.info(f"  {t}: {total} ({active} active)")
        else:
            log.info(f"  {t}: {total}")

    conn.close()
    log.info("=" * 60)
    log.info("DONE")
    log.info("=" * 60)


if __name__ == '__main__':
    main()
