"""
ObservationPoint — PostgreSQL Database Layer
"""
import os
import uuid
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone, date
from collections import defaultdict

DB_HOST = os.environ.get('DB_HOST') or '35.184.9.224'
DB_NAME = os.environ.get('DB_NAME') or 'observationpoint'
DB_USER = os.environ.get('DB_USER') or 'postgres'
DB_PASS = os.environ.get('DB_PASS') or ''
DB_PORT = os.environ.get('DB_PORT') or '5432'
DB_SOCKET = os.environ.get('DB_SOCKET') or ''

import logging
log = logging.getLogger(__name__)


def get_conn():
    if DB_SOCKET:
        log.info(f"Connecting via socket: {DB_SOCKET}")
        return psycopg2.connect(dbname=DB_NAME, user=DB_USER, password=DB_PASS,
                                host=DB_SOCKET)
    log.info(f"Connecting via TCP: {DB_HOST}:{DB_PORT}")
    return psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
                            user=DB_USER, password=DB_PASS)


def _serialize(val):
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    return val


# --- Staff ---

def search_staff(query, limit=15):
    conn = get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT email, first_name, last_name, job_title, school, job_function
            FROM staff
            WHERE is_active AND (
                LOWER(first_name || ' ' || last_name) LIKE LOWER(%s)
                OR LOWER(email) LIKE LOWER(%s)
            )
            ORDER BY last_name, first_name
            LIMIT %s
        """, (f'%{query}%', f'%{query}%', limit))
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def get_staff_by_email(email):
    conn = get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM staff WHERE email = %s", (email.lower(),))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# --- My Team (direct reports) ---

def get_my_team(supervisor_email):
    """Return direct reports for the logged-in user, with touchpoint history."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT email, first_name, last_name, job_title, school, job_function
            FROM staff
            WHERE supervisor_email = %s AND is_active
            ORDER BY last_name, first_name
        """, (supervisor_email.lower(),))
        reports = cur.fetchall()

        if not reports:
            return {'school_years': [], 'teachers': {}}

        emails = [r[0] for r in reports]
        staff_map = {r[0]: {'email': r[0], 'first_name': r[1], 'last_name': r[2],
                            'job_title': r[3], 'school': r[4], 'job_function': r[5]} for r in reports}

        cur.execute("""
            SELECT t.id, t.form_type, t.teacher_email, t.school, t.school_year,
                   t.observed_at, t.notes as rubric,
                   s.dimension_code, s.score
            FROM touchpoints t
            JOIN scores s ON s.touchpoint_id = t.id
            WHERE t.teacher_email = ANY(%s)
            ORDER BY t.teacher_email, t.observed_at DESC
        """, (emails,))

        teachers = {}
        tp_map = {}
        for row in cur.fetchall():
            tid, form_type, email, tp_school, sy, obs_at, rubric, dim_code, score = row
            if email not in teachers:
                s = staff_map.get(email, {})
                teachers[email] = {
                    'email': email,
                    'name': f"{s.get('first_name','')} {s.get('last_name','')}".strip() or email,
                    'school': s.get('school', tp_school or ''),
                    'job_function': s.get('job_function', ''),
                    'touchpoints': [],
                    'pmap_by_year': {},
                }
            tp_key = str(tid)
            if tp_key not in tp_map:
                tp_map[tp_key] = {
                    'id': tp_key, 'form_type': form_type, 'rubric': rubric or '',
                    'school_year': sy,
                    'date': obs_at.strftime('%Y-%m-%d') if obs_at else None,
                    'scores': {}, '_email': email,
                }
            tp_map[tp_key]['scores'][dim_code] = float(score)

        for tp in tp_map.values():
            email = tp.pop('_email')
            teachers[email]['touchpoints'].append(tp)

        years_set = set()
        for email, t in teachers.items():
            t['touchpoints'].sort(key=lambda x: (x.get('date') or ''), reverse=True)
            t['touchpoint_count'] = len(t['touchpoints'])
            pmap_agg = defaultdict(lambda: defaultdict(list))
            for tp in t['touchpoints']:
                if tp['form_type'].startswith('pmap_'):
                    for code, s in tp['scores'].items():
                        pmap_agg[tp['school_year']][code].append(s)
            t['pmap_by_year'] = {yr: {c: round(sum(v)/len(v),2) for c,v in dims.items()}
                                 for yr, dims in pmap_agg.items()}
            years_set.update(t['pmap_by_year'].keys())
            obs_dates = [tp['date'] for tp in t['touchpoints']
                         if tp['form_type'].startswith('observation_') and tp.get('date')]
            t['last_observation_date'] = max(obs_dates) if obs_dates else None

        # Include direct reports with no touchpoints
        for email, s in staff_map.items():
            if email not in teachers:
                teachers[email] = {
                    'email': email,
                    'name': f"{s['first_name']} {s['last_name']}".strip() or email,
                    'school': s.get('school', ''),
                    'job_function': s.get('job_function', ''),
                    'touchpoints': [], 'touchpoint_count': 0,
                    'pmap_by_year': {}, 'last_observation_date': None,
                }

        return {'school_years': sorted(years_set), 'teachers': teachers}
    finally:
        conn.close()


# --- Teacher History (for profile page) ---

def get_teacher_history(teacher_email=None, school=None, observer_email=None):
    """Build teacher history JSON matching the shape the frontend expects."""
    conn = get_conn()
    try:
        return _get_teacher_history_inner(conn, teacher_email, school, observer_email)
    finally:
        conn.close()


def _get_teacher_history_inner(conn, teacher_email=None, school=None, observer_email=None):
    cur = conn.cursor()

    where = "WHERE st.is_active = TRUE"
    params = []
    if teacher_email:
        where += " AND t.teacher_email = %s"
        params.append(teacher_email.lower())
    if school:
        where += " AND t.school = %s"
        params.append(school)
    if observer_email:
        where += " AND t.observer_email = %s"
        params.append(observer_email.lower())

    cur.execute(f"""
        SELECT t.id, t.form_type, t.teacher_email, t.school, t.school_year,
               t.observed_at, t.notes as rubric,
               s.dimension_code, s.score, s.cycle,
               st.first_name, st.last_name, st.school as staff_school,
               st.job_function, st.is_active
        FROM touchpoints t
        JOIN scores s ON s.touchpoint_id = t.id
        JOIN staff st ON st.email = t.teacher_email
        {where}
        ORDER BY t.teacher_email, t.observed_at DESC, t.id
    """, params)

    teachers = {}
    tp_map = {}

    for row in cur.fetchall():
        (tid, form_type, email, tp_school, sy, obs_at, rubric,
         dim_code, score, cycle, fname, lname, staff_school, job_fn, active) = row

        if email not in teachers:
            teachers[email] = {
                'email': email,
                'name': f'{fname} {lname}'.strip() if fname else email,
                'school': staff_school or tp_school or '',
                'job_function': job_fn or '',
                'is_active': active,
                'touchpoints': [],
                'pmap_by_year': {},
            }

        tp_key = str(tid)
        if tp_key not in tp_map:
            tp_map[tp_key] = {
                'id': tp_key,
                'form_type': form_type,
                'rubric': rubric or '',
                'school_year': sy,
                'date': obs_at.strftime('%Y-%m-%d') if obs_at else None,
                'scores': {},
                '_email': email,
            }
        tp_map[tp_key]['scores'][dim_code] = float(score)

    for tp in tp_map.values():
        email = tp.pop('_email')
        teachers[email]['touchpoints'].append(tp)

    years_set = set()
    for email, t in teachers.items():
        t['touchpoints'].sort(key=lambda x: (x.get('date') or '', x['id']), reverse=True)
        t['touchpoint_count'] = len(t['touchpoints'])

        pmap_agg = defaultdict(lambda: defaultdict(list))
        for tp in t['touchpoints']:
            if tp['form_type'].startswith('pmap_'):
                for code, s in tp['scores'].items():
                    pmap_agg[tp['school_year']][code].append(s)

        pmap_by_year = {}
        for yr, dims in pmap_agg.items():
            pmap_by_year[yr] = {code: round(sum(vals)/len(vals), 2) for code, vals in dims.items()}
            years_set.add(yr)
        t['pmap_by_year'] = pmap_by_year

        obs_dates = [tp['date'] for tp in t['touchpoints']
                     if tp['form_type'].startswith('observation_') and tp.get('date')]
        t['last_observation_date'] = max(obs_dates) if obs_dates else None

    return {
        'generated_at': date.today().isoformat(),
        'school_years': sorted(years_set),
        'teachers': teachers,
    }


# --- Network Dashboard ---

def get_network_dashboard():
    conn = get_conn()
    try:
        return _get_network_dashboard_inner(conn)
    finally:
        conn.close()


def _get_network_dashboard_inner(conn):
    cur = conn.cursor()
    out = {'school_years': ['2023-2024', '2024-2025', '2025-2026']}

    # KPIs
    cur.execute("""
        SELECT COUNT(DISTINCT t.id), COUNT(DISTINCT t.teacher_email)
        FROM touchpoints t JOIN staff s ON t.teacher_email = s.email AND s.is_active
        WHERE t.school_year='2025-2026' AND t.form_type = 'observation_teacher'
    """)
    obs, obs_t = cur.fetchone()
    cur.execute("""
        SELECT COUNT(DISTINCT t.id), COUNT(DISTINCT t.teacher_email)
        FROM touchpoints t JOIN staff s ON t.teacher_email = s.email AND s.is_active
        WHERE t.school_year='2025-2026' AND t.form_type = 'observation_fundamentals'
    """)
    fund, fund_t = cur.fetchone()
    cur.execute("SELECT COUNT(*) FROM staff WHERE is_active AND job_function = 'Teacher'")
    total_t = cur.fetchone()[0]

    out['network_kpis'] = {
        'observations': obs, 'observations_teachers': obs_t,
        'fundamentals': fund, 'fundamentals_teachers': fund_t,
        'total_teachers': total_t,
    }

    # Network avg by dimension
    cur.execute("""
        SELECT s.dimension_code, ROUND(AVG(s.score),2)::float
        FROM scores s JOIN touchpoints t ON s.touchpoint_id=t.id
        WHERE t.school_year='2025-2026' AND t.form_type='pmap_teacher'
        GROUP BY s.dimension_code ORDER BY s.dimension_code
    """)
    out['network_avg'] = {r[0]: r[1] for r in cur.fetchall()}

    # Trends by year
    cur.execute("""
        SELECT t.school_year, s.dimension_code, ROUND(AVG(s.score),2)::float
        FROM scores s JOIN touchpoints t ON s.touchpoint_id=t.id
        WHERE t.form_type='pmap_teacher'
        GROUP BY t.school_year, s.dimension_code ORDER BY t.school_year
    """)
    trends = {}
    for sy, dim, avg in cur.fetchall():
        if sy not in trends: trends[sy] = {}
        trends[sy][dim] = avg
    out['network_trends'] = trends

    # School comparison
    cur.execute("""
        SELECT t.school, s.dimension_code, ROUND(AVG(s.score),2)::float,
               COUNT(DISTINCT t.teacher_email)
        FROM scores s JOIN touchpoints t ON s.touchpoint_id=t.id
        WHERE t.school_year='2025-2026' AND t.form_type='pmap_teacher'
        AND t.school != '' AND t.school != 'FirstLine Network'
        GROUP BY t.school, s.dimension_code ORDER BY t.school
    """)
    schools = {}
    for school, dim, avg, tc in cur.fetchall():
        if school not in schools: schools[school] = {'scores': {}, 'teacher_count': 0}
        schools[school]['scores'][dim] = avg
        schools[school]['teacher_count'] = max(schools[school]['teacher_count'], tc)

    # School coverage
    cur.execute("""
        SELECT st.school, COUNT(DISTINCT st.email),
               COUNT(DISTINCT CASE WHEN t.observed_at > NOW() - INTERVAL '30 days' THEN st.email END)
        FROM staff st LEFT JOIN touchpoints t ON st.email=t.teacher_email
            AND t.form_type IN ('observation_teacher','observation_fundamentals')
        WHERE st.is_active AND st.job_function='Teacher' AND st.school != ''
        GROUP BY st.school
    """)
    for school, total, recent in cur.fetchall():
        if school in schools:
            schools[school]['total_teachers'] = total
            schools[school]['observed_last_30'] = recent
            schools[school]['coverage_pct'] = round(recent*100/total) if total else 0

    # School trends
    cur.execute("""
        SELECT t.school, t.school_year, ROUND(AVG(s.score),2)::float
        FROM scores s JOIN touchpoints t ON s.touchpoint_id=t.id
        WHERE t.form_type='pmap_teacher' AND t.school != '' AND t.school != 'FirstLine Network'
        GROUP BY t.school, t.school_year ORDER BY t.school, t.school_year
    """)
    for school, sy, avg in cur.fetchall():
        if school in schools:
            if 'trends' not in schools[school]: schools[school]['trends'] = {}
            schools[school]['trends'][sy] = avg
    out['schools'] = schools

    # Distribution
    cur.execute("""
        WITH teacher_dim_avg AS (
            SELECT t.teacher_email, s.dimension_code, ROUND(AVG(s.score))::int as rounded
            FROM scores s JOIN touchpoints t ON s.touchpoint_id=t.id
            WHERE t.school_year='2025-2026' AND t.form_type='pmap_teacher'
            GROUP BY t.teacher_email, s.dimension_code
        )
        SELECT dimension_code, rounded, COUNT(*)
        FROM teacher_dim_avg GROUP BY dimension_code, rounded
        ORDER BY dimension_code, rounded
    """)
    dist = {}
    for dim, score, count in cur.fetchall():
        if dim not in dist: dist[dim] = {}
        dist[dim][str(score)] = count
    out['distribution'] = dist

    # Touchpoint activity by type and school
    cur.execute("""
        SELECT t.school, t.form_type, COUNT(*), COUNT(DISTINCT t.teacher_email)
        FROM touchpoints t JOIN staff s ON t.teacher_email = s.email AND s.is_active
        WHERE t.school_year='2025-2026' AND t.school != ''
        GROUP BY t.school, t.form_type ORDER BY t.school, t.form_type
    """)
    activity = {}
    for school, ft, cnt, teachers in cur.fetchall():
        if school not in activity: activity[school] = {}
        activity[school][ft] = {'count': cnt, 'teachers': teachers}
    out['touchpoint_activity'] = activity
    return out


# --- Save Touchpoint ---

def save_touchpoint(data):
    conn = get_conn()
    try:
        cur = conn.cursor()
        tp_id = data.get('id', str(uuid.uuid4()))

        cur.execute("""
            INSERT INTO touchpoints (id, form_type, teacher_email, observer_email, school,
                school_year, observed_at, status, is_published, notes, feedback)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (tp_id, data['form_type'], data['teacher_email'], data['observer_email'],
              data.get('school', ''), data['school_year'],
              data.get('observed_at', datetime.now(timezone.utc)),
              data.get('status', 'draft'), data.get('is_published', False),
              data.get('notes', ''), data.get('feedback', '')))

        tp_id = cur.fetchone()[0]

        if data.get('scores'):
            for code, score in data['scores'].items():
                if score is not None:
                    cur.execute("""
                        INSERT INTO scores (touchpoint_id, dimension_code, score, cycle)
                        VALUES (%s, %s, %s, %s)
                    """, (tp_id, code, score, data.get('cycle')))

        conn.commit()
        return tp_id
    finally:
        conn.close()
