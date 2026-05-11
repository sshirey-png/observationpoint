#!/usr/bin/env python3
"""
audit_supervisor_gaps.py — surface holes in the staff.supervisor_email chain.

Why it matters: OP's access model (and the Supervisor Dashboard's) walks the
recursive supervisor chain. If a teacher's chain doesn't reach their school
leader, that leader can't see the teacher's profile.

Run from project root with the DB password in env:
    DB_PASS='...' python tools/audit_supervisor_gaps.py

Reports three categories:
  1. Active staff with NO supervisor_email (chain starts nowhere)
  2. Active staff whose supervisor_email points to an inactive or missing person
  3. Active TEACHERS whose recursive chain never reaches a school leader or admin
     (these are the ones invisible to their building's leadership today)
"""
import os
import sys

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    sys.exit("psycopg2 not installed. pip install psycopg2-binary")

DB_HOST = os.environ.get('DB_HOST', '35.184.9.224')
DB_PORT = os.environ.get('DB_PORT', '5432')
DB_NAME = os.environ.get('DB_NAME', 'observationpoint')
DB_USER = os.environ.get('DB_USER', 'postgres')
DB_PASS = os.environ.get('DB_PASS')

if not DB_PASS:
    sys.exit("Set DB_PASS env var. (Same value the Cloud Run service uses.)")

# Titles that count as "school leadership" — mirror auth.SCHOOL_LEADER_TITLE_KEYWORDS
SCHOOL_LEADER_KEYWORDS = ['principal', 'assistant principal', 'dean', 'director of culture']
# Admin titles — anyone whose chain reaches one of these is "covered"
C_TEAM_KEYWORDS = ['chief', 'exdir']


def is_school_leader(title):
    t = (title or '').lower()
    return any(k in t for k in SCHOOL_LEADER_KEYWORDS)


def is_admin(title):
    t = (title or '').lower()
    return any(k in t for k in C_TEAM_KEYWORDS)


def main():
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT email, first_name, last_name, job_title, job_function, school, supervisor_email, is_active
        FROM staff
    """)
    rows = cur.fetchall()
    conn.close()

    by_email = {(r['email'] or '').lower(): r for r in rows if r['email']}
    active = {e: r for e, r in by_email.items() if r['is_active']}

    def name(r):
        return f"{(r['first_name'] or '').strip()} {(r['last_name'] or '').strip()}".strip() or r['email']

    # ── 1. Active staff with no supervisor_email ──────────────────────────
    no_sup = [r for r in active.values() if not (r['supervisor_email'] or '').strip()]

    # ── 2. supervisor_email points to inactive/missing person ─────────────
    broken = []
    for r in active.values():
        se = (r['supervisor_email'] or '').strip().lower()
        if not se:
            continue
        if se not in by_email:
            broken.append((r, se, 'missing from staff table'))
        elif not by_email[se]['is_active']:
            broken.append((r, se, 'supervisor is inactive'))

    # ── 3. Active teachers whose chain never reaches a leader/admin ───────
    orphan_teachers = []
    for r in active.values():
        if (r['job_function'] or '') != 'Teacher':
            continue
        # walk the chain
        seen = set()
        cur_email = (r['email'] or '').lower()
        reached = False
        while cur_email and cur_email not in seen:
            seen.add(cur_email)
            person = by_email.get(cur_email)
            if not person:
                break
            if is_school_leader(person['job_title']) or is_admin(person['job_title']):
                reached = True
                break
            cur_email = (person['supervisor_email'] or '').strip().lower()
        if not reached:
            orphan_teachers.append(r)

    # ── Report ───────────────────────────────────────────────────────────
    print("=" * 70)
    print("SUPERVISOR CHAIN GAPS")
    print("=" * 70)

    print(f"\n[1] Active staff with NO supervisor_email: {len(no_sup)}")
    for r in sorted(no_sup, key=lambda x: (x['school'] or '', name(x))):
        print(f"    {name(r):<28} {r['job_title']:<28} {r['school'] or '(no school)'}")

    print(f"\n[2] Active staff pointing to a missing/inactive supervisor: {len(broken)}")
    for r, se, why in sorted(broken, key=lambda x: (x[0]['school'] or '', name(x[0]))):
        print(f"    {name(r):<28} → {se:<35} ({why})")

    print(f"\n[3] Active TEACHERS whose chain never reaches a leader/admin: {len(orphan_teachers)}")
    print("    (these teachers are invisible to their building's leadership today)")
    for r in sorted(orphan_teachers, key=lambda x: (x['school'] or '', name(x))):
        print(f"    {name(r):<28} {r['job_title']:<28} {r['school'] or '(no school)':<32} sup={r['supervisor_email'] or '(none)'}")

    print("\n" + "=" * 70)
    print(f"SUMMARY: {len(no_sup)} no-supervisor · {len(broken)} broken-link · {len(orphan_teachers)} orphan-teachers")
    print("=" * 70)


if __name__ == '__main__':
    main()
