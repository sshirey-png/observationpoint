"""
ObservationPoint — PostgreSQL Database Layer
All queries use try/finally for connection cleanup.
"""
import os
import logging
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone, date
from collections import defaultdict

from config import DB_HOST, DB_NAME, DB_USER, DB_PASS, DB_PORT, DB_SOCKET, CURRENT_SCHOOL_YEAR

log = logging.getLogger(__name__)


def get_conn():
    if DB_SOCKET:
        return psycopg2.connect(dbname=DB_NAME, user=DB_USER, password=DB_PASS, host=DB_SOCKET)
    return psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS)


# --- Staff ---

def get_staff_by_email(email):
    conn = get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM staff WHERE email = %s", (email.lower(),))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def search_staff(query, accessible_emails=None, limit=15):
    conn = get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if accessible_emails is not None:
            cur.execute("""
                SELECT email, first_name, last_name, job_title, school, job_function
                FROM staff WHERE is_active
                AND email = ANY(%s)
                AND (LOWER(first_name || ' ' || last_name) LIKE LOWER(%s)
                     OR LOWER(email) LIKE LOWER(%s))
                ORDER BY last_name, first_name LIMIT %s
            """, (accessible_emails, f'%{query}%', f'%{query}%', limit))
        else:
            cur.execute("""
                SELECT email, first_name, last_name, job_title, school, job_function
                FROM staff WHERE is_active
                AND (LOWER(first_name || ' ' || last_name) LIKE LOWER(%s)
                     OR LOWER(email) LIKE LOWER(%s))
                ORDER BY last_name, first_name LIMIT %s
            """, (f'%{query}%', f'%{query}%', limit))
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


# --- My Team ---

def get_my_team(accessible_emails, school_year=None, direct_only_email=None):
    """Return staff list with touchpoint counts by type.
    If direct_only_email is set, only return that person's direct reports.
    Otherwise return all accessible_emails."""
    if not accessible_emails and not direct_only_email:
        return {'staff': [], 'school_year': school_year or CURRENT_SCHOOL_YEAR}

    sy = school_year or CURRENT_SCHOOL_YEAR
    conn = get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        if direct_only_email:
            where = "WHERE s.supervisor_email = %s AND s.is_active"
            params = (sy, direct_only_email)
        else:
            where = "WHERE s.email = ANY(%s) AND s.is_active"
            params = (sy, accessible_emails)

        cur.execute(f"""
            SELECT
                s.email, s.first_name, s.last_name, s.job_title, s.school,
                s.job_function, s.hire_date, s.supervisor_email,
                COUNT(t.id) as touchpoint_count,
                MAX(t.observed_at) as last_touchpoint_date,
                COUNT(CASE WHEN t.form_type LIKE 'observation_%%' THEN 1 END) as observation_count,
                COUNT(CASE WHEN t.form_type LIKE 'pmap_%%' THEN 1 END) as pmap_count,
                COUNT(CASE WHEN t.form_type LIKE 'self_reflection_%%' THEN 1 END) as sr_count,
                COUNT(CASE WHEN t.form_type = 'quick_feedback' THEN 1 END) as feedback_count,
                COUNT(CASE WHEN t.form_type LIKE 'meeting_%%' THEN 1 END) as meeting_count
            FROM staff s
            LEFT JOIN touchpoints t ON t.teacher_email = s.email AND t.school_year = %s
            {where}
            GROUP BY s.email, s.first_name, s.last_name, s.job_title, s.school,
                     s.job_function, s.hire_date, s.supervisor_email
            ORDER BY s.last_name, s.first_name
        """, params)
        staff = []
        for r in cur.fetchall():
            row = dict(r)
            row['name'] = f"{r['first_name'] or ''} {r['last_name'] or ''}".strip() or r['email']
            row['hire_date'] = r['hire_date'].isoformat() if r['hire_date'] else None
            row['last_touchpoint_date'] = r['last_touchpoint_date'].isoformat() if r['last_touchpoint_date'] else None
            staff.append(row)
        return {'staff': staff, 'school_year': sy}
    finally:
        conn.close()


# --- Staff Profile ---

def get_staff_profile(email):
    """Return complete touchpoint history for one staff member. Uses LEFT JOIN so unscored touchpoints appear."""
    conn = get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Staff info
        cur.execute("SELECT * FROM staff WHERE email = %s", (email.lower(),))
        staff_row = cur.fetchone()
        if not staff_row:
            return None

        staff = {
            'email': staff_row['email'],
            'name': f"{staff_row['first_name'] or ''} {staff_row['last_name'] or ''}".strip(),
            'job_title': staff_row['job_title'] or '',
            'school': staff_row['school'] or '',
            'job_function': staff_row['job_function'] or '',
            'hire_date': staff_row['hire_date'].isoformat() if staff_row['hire_date'] else None,
            'is_active': staff_row['is_active'],
        }

        # All touchpoints with optional scores (LEFT JOIN) + observer name lookup
        cur.execute("""
            SELECT t.id, t.form_type, t.school, t.school_year, t.observed_at,
                   t.observer_email, t.status, t.notes, t.feedback,
                   t.feedback_json, t.meeting_json, t.scores_json,
                   TRIM(CONCAT(obs.first_name, ' ', obs.last_name)) AS observer_name,
                   sc.dimension_code, sc.score
            FROM touchpoints t
            LEFT JOIN staff obs ON LOWER(obs.email) = LOWER(t.observer_email)
            LEFT JOIN scores sc ON sc.touchpoint_id = t.id
            WHERE t.teacher_email = %s
            ORDER BY t.observed_at DESC, t.id
        """, (email.lower(),))

        tp_map = {}
        for r in cur.fetchall():
            tp_id = str(r['id'])
            if tp_id not in tp_map:
                obs_at = r['observed_at']
                tp_map[tp_id] = {
                    'id': tp_id,
                    'form_type': r['form_type'],
                    'school_year': r['school_year'],
                    'date': obs_at.strftime('%Y-%m-%d') if obs_at else None,
                    'observer_email': r['observer_email'] or '',
                    'observer_name': r['observer_name'] or '',
                    'notes': r['notes'] or '',
                    'feedback_json': r['feedback_json'],
                    'meeting_json': r['meeting_json'],
                    'scores': {},
                }
            if r['dimension_code'] and r['score'] is not None:
                tp_map[tp_id]['scores'][r['dimension_code']] = float(r['score'])

        touchpoints = sorted(tp_map.values(), key=lambda x: (x.get('date') or '', x['id']), reverse=True)

        # Build pmap_by_year for year-over-year grid
        pmap_by_year = defaultdict(lambda: defaultdict(list))
        years_set = set()
        for tp in touchpoints:
            years_set.add(tp['school_year'])
            if tp['form_type'].startswith('pmap_') and tp['scores']:
                for code, s in tp['scores'].items():
                    pmap_by_year[tp['school_year']][code].append(s)

        pmap_avg = {}
        for yr, dims in pmap_by_year.items():
            pmap_avg[yr] = {code: round(sum(vals) / len(vals), 2) for code, vals in dims.items()}

        return {
            'staff': staff,
            'touchpoints': touchpoints,
            'touchpoint_count': len(touchpoints),
            'pmap_by_year': pmap_avg,
            'school_years': sorted(years_set),
        }
    finally:
        conn.close()


# --- Network Dashboard ---

def get_network_dashboard(school_year=None):
    """School-level aggregates. No individual teacher data."""
    sy = school_year or CURRENT_SCHOOL_YEAR
    conn = get_conn()
    try:
        cur = conn.cursor()
        out = {'school_year': sy}

        # KPIs — counts only
        cur.execute("""
            SELECT COUNT(DISTINCT t.id), COUNT(DISTINCT t.teacher_email)
            FROM touchpoints t JOIN staff s ON t.teacher_email = s.email AND s.is_active
            WHERE t.school_year = %s AND t.form_type = 'observation_teacher'
        """, (sy,))
        obs, obs_t = cur.fetchone()

        cur.execute("""
            SELECT COUNT(DISTINCT t.id), COUNT(DISTINCT t.teacher_email)
            FROM touchpoints t JOIN staff s ON t.teacher_email = s.email AND s.is_active
            WHERE t.school_year = %s AND t.form_type = 'observation_fundamentals'
        """, (sy,))
        fund, fund_t = cur.fetchone()

        cur.execute("SELECT COUNT(*) FROM staff WHERE is_active AND job_function = 'Teacher'")
        total_t = cur.fetchone()[0]

        # Prior-year parallel counts for YoY delta.
        # NOTE: %% in LIKE patterns is required when cur.execute() has
        # parameter binding — psycopg2 reads bare % as a placeholder.
        cur.execute("""
            SELECT
              COUNT(*) FILTER (WHERE form_type = 'observation_teacher') AS obs,
              COUNT(*) FILTER (WHERE form_type = 'observation_fundamentals') AS fund,
              COUNT(*) FILTER (WHERE form_type LIKE 'pmap_%%') AS pmap,
              COUNT(*) FILTER (WHERE form_type = 'celebrate') AS cel,
              COUNT(*) FILTER (WHERE form_type LIKE 'meeting_%%') AS mtg
            FROM touchpoints
            WHERE school_year = %s AND status = 'published'
        """, (sy,))
        cur_counts = cur.fetchone()
        # Derive prior SY (handles "2025-2026" -> "2024-2025")
        try:
            a, b = sy.split('-')
            prior_sy = f"{int(a)-1}-{int(b)-1}"
        except Exception:
            prior_sy = None
        prior_counts = (0, 0, 0, 0, 0)
        if prior_sy:
            cur.execute("""
                SELECT
                  COUNT(*) FILTER (WHERE form_type = 'observation_teacher'),
                  COUNT(*) FILTER (WHERE form_type = 'observation_fundamentals'),
                  COUNT(*) FILTER (WHERE form_type LIKE 'pmap_%%'),
                  COUNT(*) FILTER (WHERE form_type = 'celebrate'),
                  COUNT(*) FILTER (WHERE form_type LIKE 'meeting_%%')
                FROM touchpoints
                WHERE school_year = %s AND status = 'published'
            """, (prior_sy,))
            row = cur.fetchone()
            if row: prior_counts = row

        out['kpis'] = {
            'observations': obs, 'observations_teachers': obs_t,
            'fundamentals': fund, 'fundamentals_teachers': fund_t,
            'total_teachers': total_t,
            # Current-year aggregate counts
            'observations_total': cur_counts[0] or 0,
            'fundamentals_total': cur_counts[1] or 0,
            'pmap_total': cur_counts[2] or 0,
            'celebrate_total': cur_counts[3] or 0,
            'meeting_total': cur_counts[4] or 0,
            # Prior year for YoY delta
            'prior_year': prior_sy,
            'prior_observations_total': prior_counts[0] or 0,
            'prior_fundamentals_total': prior_counts[1] or 0,
            'prior_pmap_total': prior_counts[2] or 0,
            'prior_celebrate_total': prior_counts[3] or 0,
            'prior_meeting_total': prior_counts[4] or 0,
        }

        # Fundamentals — per-school RB pass rate this year + visits + teachers visited.
        # Imported records have only RB scores (0/100). Avg = pass rate.
        cur.execute("""
            SELECT t.school,
                   COUNT(DISTINCT t.id) AS visits,
                   COUNT(DISTINCT t.teacher_email) AS teachers_visited,
                   ROUND(AVG(sc.score)::numeric, 1)::float AS rb_pct
            FROM touchpoints t
            LEFT JOIN scores sc ON sc.touchpoint_id = t.id AND sc.dimension_code = 'RB'
            WHERE t.school_year = %s AND t.form_type = 'observation_fundamentals'
              AND t.school != '' AND t.school IS NOT NULL AND t.school != 'FirstLine Network'
              AND t.status = 'published'
            GROUP BY t.school
            ORDER BY visits DESC
        """, (sy,))
        fund_by_school = {}
        for r in cur.fetchall():
            fund_by_school[r[0]] = {'visits': r[1], 'teachers_visited': r[2], 'rb_pct': r[3]}

        # Network-wide RB pass rate this year
        cur.execute("""
            SELECT ROUND(AVG(sc.score)::numeric, 1)::float
            FROM touchpoints t
            JOIN scores sc ON sc.touchpoint_id = t.id AND sc.dimension_code = 'RB'
            WHERE t.school_year = %s AND t.form_type = 'observation_fundamentals'
              AND t.status = 'published'
        """, (sy,))
        row = cur.fetchone()
        network_rb_pct = row[0] if row and row[0] is not None else None

        # Prior year RB for YoY context
        prior_rb = None
        if prior_sy:
            cur.execute("""
                SELECT ROUND(AVG(sc.score)::numeric, 1)::float
                FROM touchpoints t
                JOIN scores sc ON sc.touchpoint_id = t.id AND sc.dimension_code = 'RB'
                WHERE t.school_year = %s AND t.form_type = 'observation_fundamentals'
                  AND t.status = 'published'
            """, (prior_sy,))
            prior_rb_row = cur.fetchone()
            prior_rb = prior_rb_row[0] if prior_rb_row and prior_rb_row[0] is not None else None

        # Count of new-form M1-M5 records (so we can show 'tracking begins' message honestly)
        cur.execute("""
            SELECT COUNT(DISTINCT t.id)
            FROM touchpoints t
            JOIN scores sc ON sc.touchpoint_id = t.id
            WHERE t.school_year = %s AND t.form_type = 'observation_fundamentals'
              AND sc.dimension_code IN ('M1','M2','M3','M4','M5')
              AND sc.score > 5
        """, (sy,))
        m_count = cur.fetchone()[0] or 0

        out['fundamentals'] = {
            'network_rb_pct': network_rb_pct,
            'network_rb_pct_prior': prior_rb,
            'by_school': fund_by_school,
            'new_form_m_count': m_count,  # records that have actual minute on-task data
        }
        # Backward-compat fields the existing UI may still reference:
        out['fundamentals_network_avg_pct'] = network_rb_pct
        out['fundamentals_by_school'] = {
            s: {'avg_pct': v.get('rb_pct'), 'visits': v.get('visits')}
            for s, v in fund_by_school.items()
        }

        # Top observers this year — for leaderboard chart
        cur.execute("""
            SELECT
              TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS name,
              s.email, s.school, COUNT(*) AS n
            FROM touchpoints t
            JOIN staff s ON LOWER(s.email) = LOWER(t.observer_email)
            WHERE t.school_year = %s AND t.status = 'published'
              AND t.observer_email IS NOT NULL AND t.observer_email <> ''
            GROUP BY s.first_name, s.last_name, s.email, s.school
            ORDER BY n DESC LIMIT 10
        """, (sy,))
        out['top_observers'] = [
            {'name': r[0] or r[1], 'email': r[1], 'school': r[2] or '', 'count': r[3]}
            for r in cur.fetchall()
        ]

        # Touchpoint activity by school and type
        cur.execute("""
            SELECT t.school, t.form_type, COUNT(*), COUNT(DISTINCT t.teacher_email)
            FROM touchpoints t JOIN staff s ON t.teacher_email = s.email AND s.is_active
            WHERE t.school_year = %s AND t.school != '' AND t.school != 'FirstLine Network'
            GROUP BY t.school, t.form_type ORDER BY t.school, t.form_type
        """, (sy,))
        schools = {}
        for school, ft, cnt, teachers in cur.fetchall():
            if school not in schools:
                schools[school] = {'touchpoints_by_type': {}, 'total_touchpoints': 0, 'staff_count': 0}
            schools[school]['touchpoints_by_type'][ft] = {'count': cnt, 'teachers': teachers}
            schools[school]['total_touchpoints'] += cnt

        # Staff count per school
        cur.execute("""
            SELECT school, COUNT(*) FROM staff
            WHERE is_active AND school != '' AND school != 'FirstLine Network'
            GROUP BY school
        """)
        for school, cnt in cur.fetchall():
            if school in schools:
                schools[school]['staff_count'] = cnt

        # Avg scores by school (teacher observations + PMAPs only)
        cur.execute("""
            SELECT t.school, sc.dimension_code, ROUND(AVG(sc.score), 2)::float
            FROM scores sc JOIN touchpoints t ON sc.touchpoint_id = t.id
            WHERE t.school_year = %s AND t.form_type = 'pmap_teacher'
            AND t.school != '' AND t.school != 'FirstLine Network'
            GROUP BY t.school, sc.dimension_code ORDER BY t.school, sc.dimension_code
        """, (sy,))
        for school, dim, avg in cur.fetchall():
            if school in schools:
                if 'avg_scores' not in schools[school]:
                    schools[school]['avg_scores'] = {}
                schools[school]['avg_scores'][dim] = avg

        out['schools'] = schools

        # Network avg
        cur.execute("""
            SELECT sc.dimension_code, ROUND(AVG(sc.score), 2)::float
            FROM scores sc JOIN touchpoints t ON sc.touchpoint_id = t.id
            WHERE t.school_year = %s AND t.form_type = 'pmap_teacher'
            GROUP BY sc.dimension_code ORDER BY sc.dimension_code
        """, (sy,))
        out['network_avg'] = {r[0]: r[1] for r in cur.fetchall()}

        # Trends
        cur.execute("""
            SELECT t.school_year, sc.dimension_code, ROUND(AVG(sc.score), 2)::float
            FROM scores sc JOIN touchpoints t ON sc.touchpoint_id = t.id
            WHERE t.form_type = 'pmap_teacher'
            GROUP BY t.school_year, sc.dimension_code ORDER BY t.school_year
        """)
        trends = {}
        for sy_row, dim, avg in cur.fetchall():
            if sy_row not in trends:
                trends[sy_row] = {}
            trends[sy_row][dim] = avg
        out['network_trends'] = trends

        # Score distribution
        cur.execute("""
            WITH teacher_dim_avg AS (
                SELECT t.teacher_email, sc.dimension_code, ROUND(AVG(sc.score))::int as rounded
                FROM scores sc JOIN touchpoints t ON sc.touchpoint_id = t.id
                WHERE t.school_year = %s AND t.form_type = 'pmap_teacher'
                GROUP BY t.teacher_email, sc.dimension_code
            )
            SELECT dimension_code, rounded, COUNT(*)
            FROM teacher_dim_avg GROUP BY dimension_code, rounded
            ORDER BY dimension_code, rounded
        """, (school_year or CURRENT_SCHOOL_YEAR,))
        dist = {}
        for dim, score, count in cur.fetchall():
            if dim not in dist:
                dist[dim] = {}
            dist[dim][str(score)] = count
        out['distribution'] = dist

        return out
    finally:
        conn.close()


# --- Save Touchpoint ---

def save_touchpoint(data):
    """Persist a user-submitted form.
    Default is PUBLISHED (not draft) — StaffProfile filters out drafts,
    so anything submitted needs to be visible immediately.
    If a form wants to save as draft, it can pass status='draft', is_published=False.
    """
    import uuid
    import json as _json
    conn = get_conn()
    try:
        cur = conn.cursor()
        tp_id = data.get('id', str(uuid.uuid4()))

        # action_step can come through as a separate top-level key (older form pattern).
        # Fold it into the feedback JSON so nothing is silently dropped.
        feedback_val = data.get('feedback', '')
        action_step = data.get('action_step')
        if action_step:
            try:
                # If feedback is already JSON string, merge. Otherwise wrap.
                fb_obj = _json.loads(feedback_val) if feedback_val else {}
                if not isinstance(fb_obj, dict):
                    fb_obj = {'note': feedback_val}
            except (ValueError, TypeError):
                fb_obj = {'note': feedback_val} if feedback_val else {}
            try:
                fb_obj['action_step'] = _json.loads(action_step) if isinstance(action_step, str) else action_step
            except (ValueError, TypeError):
                fb_obj['action_step'] = action_step
            feedback_val = _json.dumps(fb_obj)

        cur.execute("""
            INSERT INTO touchpoints (id, form_type, teacher_email, observer_email, school,
                school_year, observed_at, status, is_published, notes, feedback)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (tp_id, data['form_type'], data['teacher_email'], data['observer_email'],
              data.get('school', ''), data['school_year'],
              data.get('observed_at', datetime.now(timezone.utc)),
              data.get('status', 'published'), data.get('is_published', True),
              data.get('notes', ''), feedback_val))
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


# --- Impersonation audit log ---

def init_impersonation_table():
    """Create the impersonation audit log table if it doesn't exist."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS impersonation_log (
                id SERIAL PRIMARY KEY,
                admin_email TEXT NOT NULL,
                impersonated_email TEXT NOT NULL,
                action TEXT NOT NULL,
                user_agent TEXT,
                ip TEXT,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_imp_admin ON impersonation_log(admin_email, created_at DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_imp_created ON impersonation_log(created_at DESC)")
        conn.commit()
    finally:
        conn.close()


def log_impersonation(admin_email, impersonated_email, action, user_agent=None, ip=None):
    """Append an impersonation event to the audit log."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO impersonation_log (admin_email, impersonated_email, action, user_agent, ip)
            VALUES (%s, %s, %s, %s, %s)
        """, (admin_email, impersonated_email, action, user_agent, ip))
        conn.commit()
    except Exception as e:
        log.error(f"Failed to log impersonation event: {e}")
    finally:
        conn.close()

