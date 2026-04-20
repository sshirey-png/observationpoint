"""
ObservationPoint — Flask Application
"""
import os
import json
import logging
import psycopg2
import psycopg2.extras
from flask import Flask, session, redirect, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix

from config import (
    SECRET_KEY, ALLOWED_DOMAIN, DEV_MODE, DEV_USER_EMAIL,
    BUILD_VERSION, CURRENT_SCHOOL_YEAR,
)
from auth import (
    init_oauth, oauth, get_current_user, get_real_user, is_impersonating,
    require_auth, require_admin, require_no_impersonation,
    get_accessible_emails, is_admin_title, check_access, is_supervisor,
)
import db

# Ensure the impersonation audit table exists on startup
try:
    db.init_impersonation_table()
except Exception as _e:
    logging.warning(f"Could not init impersonation_log table: {_e}")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = Flask(__name__, static_folder='prototypes', static_url_path='/static')
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.secret_key = SECRET_KEY
CORS(app)
init_oauth(app)


# ------------------------------------------------------------------
# Auth
# ------------------------------------------------------------------

@app.route('/login')
def login():
    redirect_uri = request.url_root.rstrip('/') + '/auth/callback'
    return oauth.google.authorize_redirect(redirect_uri)


@app.route('/auth/callback')
def auth_callback():
    token = oauth.google.authorize_access_token()
    userinfo = token.get('userinfo', {})
    email = userinfo.get('email', '').lower()

    if not email.endswith(f'@{ALLOWED_DOMAIN}'):
        return 'Access restricted to FirstLine Schools staff', 403

    # Look up staff record
    try:
        staff = db.get_staff_by_email(email)
    except Exception as e:
        log.error(f"DB lookup failed for {email}: {e}")
        staff = None

    job_title = staff.get('job_title', '') if staff else ''

    # Compute accessible emails via recursive CTE
    try:
        conn = db.get_conn()
        accessible = get_accessible_emails(conn, email, job_title)
        conn.close()
    except Exception as e:
        log.error(f"Hierarchy lookup failed for {email}: {e}")
        accessible = []

    session['user'] = {
        'email': email,
        'name': userinfo.get('name', ''),
        'picture': userinfo.get('picture', ''),
        'job_title': job_title,
        'school': staff.get('school', '') if staff else '',
        'job_function': staff.get('job_function', '') if staff else '',
        'is_admin': is_admin_title(job_title),
        'accessible_emails': accessible,
    }

    log.info(f"Login: {email} ({job_title}) — {len(accessible)} accessible staff, admin={is_admin_title(job_title)}")
    return redirect('/')


@app.route('/logout')
def logout():
    session.clear()
    return redirect('/login')


@app.route('/api/health')
def health():
    try:
        conn = db.get_conn()
        cur = conn.cursor()
        cur.execute('SELECT COUNT(*) FROM staff WHERE is_active')
        staff_count = cur.fetchone()[0]
        cur.execute('SELECT COUNT(*) FROM touchpoints')
        tp_count = cur.fetchone()[0]
        conn.close()
        return jsonify({'status': 'ok', 'active_staff': staff_count, 'touchpoints': tp_count})
    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500


@app.route('/api/auth/status')
def auth_status():
    if DEV_MODE:
        return jsonify({
            'authenticated': True,
            'user': {
                'email': DEV_USER_EMAIL,
                'name': 'Dev User',
                'is_admin': True,
                'accessible_count': 999,
            }
        })
    user = get_current_user()
    real = get_real_user()
    if user:
        return jsonify({
            'authenticated': True,
            'user': {
                'email': user['email'],
                'name': user['name'],
                'picture': user.get('picture', ''),
                'job_title': user.get('job_title', ''),
                'school': user.get('school', ''),
                'is_admin': user.get('is_admin', False),
                'is_supervisor': is_supervisor(user),
                'accessible_count': len(user.get('accessible_emails', [])),
            },
            # Admin-only info: the real signed-in user and whether they're
            # currently impersonating someone.
            'real_user': ({
                'email': real.get('email'),
                'name': real.get('name'),
                'is_admin': real.get('is_admin', False),
            } if real and real.get('is_admin') else None),
            'impersonating': (session.get('impersonating_as') if real and real.get('is_admin') else None),
        })
    return jsonify({'authenticated': False})


# ------------------------------------------------------------------
# API: Admin Impersonation
# ------------------------------------------------------------------

@app.route('/api/admin/impersonate', methods=['POST'])
@require_auth
@require_admin
def api_impersonate():
    """Admin-only. Start viewing the app as another staff member.
    Session-backed; survives page navigation. Audit-logged."""
    real = get_real_user()
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    if not email:
        return jsonify({'error': 'email required'}), 400

    # Look up target staff member
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM staff WHERE email = %s AND is_active", (email,))
        target = cur.fetchone()
        if not target:
            return jsonify({'error': 'Staff member not found or inactive'}), 404

        # Compute accessible_emails for the impersonated user (may differ from admin's view)
        accessible = get_accessible_emails(conn, email, target.get('job_title', ''))

        imp = {
            'email': email,
            'name': f"{target.get('first_name') or ''} {target.get('last_name') or ''}".strip() or email,
            'job_title': target.get('job_title') or '',
            'school': target.get('school') or '',
            'job_function': target.get('job_function') or '',
            'accessible_emails': accessible,
        }
        session['impersonating_as'] = imp
        db.log_impersonation(
            real.get('email'), email, 'start',
            user_agent=request.headers.get('User-Agent', ''),
            ip=request.remote_addr or '',
        )
        return jsonify({'ok': True, 'impersonating': imp})
    finally:
        conn.close()


@app.route('/api/admin/stop-impersonating', methods=['POST'])
@require_auth
@require_admin
def api_stop_impersonating():
    real = get_real_user()
    imp = session.pop('impersonating_as', None)
    if imp:
        db.log_impersonation(
            real.get('email'), imp.get('email'), 'stop',
            user_agent=request.headers.get('User-Agent', ''),
            ip=request.remote_addr or '',
        )
    return jsonify({'ok': True})


@app.route('/api/admin/data-audit')
@require_auth
@require_admin
def api_data_audit():
    """What do we actually have in the imported touchpoints? Ground truth
    audit for deciding whether the tool is viable on this data substrate.

    Returns, per form_type:
      - count
      - % with notes, % with scores, % with feedback_json, % with
        meeting_json, % with observer_email
      - date range (earliest → latest observed_at)
      - one sample record showing what fields are populated
    """
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute("SELECT COUNT(*) AS n FROM touchpoints")
        total = cur.fetchone()['n']

        cur.execute("""
            SELECT
              form_type,
              COUNT(*) AS n,
              COUNT(CASE WHEN notes IS NOT NULL AND notes <> '' THEN 1 END) AS has_notes,
              COUNT(CASE WHEN feedback_json IS NOT NULL THEN 1 END) AS has_feedback_json,
              COUNT(CASE WHEN meeting_json IS NOT NULL THEN 1 END) AS has_meeting_json,
              COUNT(CASE WHEN observer_email IS NOT NULL AND observer_email <> '' THEN 1 END) AS has_observer,
              COUNT(CASE WHEN status = 'draft' THEN 1 END) AS drafts,
              MIN(observed_at) AS date_min,
              MAX(observed_at) AS date_max
            FROM touchpoints
            GROUP BY form_type
            ORDER BY n DESC
        """)
        by_type = []
        for r in cur.fetchall():
            ft = r['form_type']
            # % with structured scores (join to scores)
            cur.execute("""
                SELECT COUNT(DISTINCT t.id)
                FROM touchpoints t
                JOIN scores sc ON sc.touchpoint_id = t.id
                WHERE t.form_type = %s
            """, (ft,))
            has_scores = cur.fetchone()['count']

            # Sample: pick one record, show which fields are populated
            cur.execute("""
                SELECT id, observed_at, school_year, observer_email, status,
                       notes IS NOT NULL AND notes <> '' AS has_notes,
                       feedback_json IS NOT NULL AS has_feedback_json,
                       meeting_json IS NOT NULL AS has_meeting_json,
                       LENGTH(notes) AS notes_len,
                       LEFT(notes, 200) AS notes_preview
                FROM touchpoints
                WHERE form_type = %s
                ORDER BY observed_at DESC
                LIMIT 1
            """, (ft,))
            sample = cur.fetchone() or {}

            n = r['n']
            by_type.append({
                'form_type': ft,
                'count': n,
                'pct_notes':         round(100 * r['has_notes'] / n, 1) if n else 0,
                'pct_scores':        round(100 * has_scores / n, 1) if n else 0,
                'pct_feedback_json': round(100 * r['has_feedback_json'] / n, 1) if n else 0,
                'pct_meeting_json':  round(100 * r['has_meeting_json'] / n, 1) if n else 0,
                'pct_observer':      round(100 * r['has_observer'] / n, 1) if n else 0,
                'drafts': r['drafts'],
                'date_min': r['date_min'].isoformat() if r['date_min'] else None,
                'date_max': r['date_max'].isoformat() if r['date_max'] else None,
                'sample': {
                    'observed_at': sample.get('observed_at').isoformat() if sample.get('observed_at') else None,
                    'school_year': sample.get('school_year'),
                    'observer_email': sample.get('observer_email'),
                    'status': sample.get('status'),
                    'has_notes': sample.get('has_notes'),
                    'has_feedback_json': sample.get('has_feedback_json'),
                    'has_meeting_json': sample.get('has_meeting_json'),
                    'notes_len': sample.get('notes_len'),
                    'notes_preview': sample.get('notes_preview'),
                },
            })

        # Score coverage: what dimension codes appear, and per code, how many records
        cur.execute("""
            SELECT dimension_code, COUNT(*) AS n
            FROM scores
            GROUP BY dimension_code
            ORDER BY n DESC
        """)
        score_dims = [dict(r) for r in cur.fetchall()]

        # Observer coverage across the whole set
        cur.execute("""
            SELECT COUNT(*) AS n,
                   COUNT(CASE WHEN observer_email IS NOT NULL AND observer_email <> '' THEN 1 END) AS has_obs,
                   COUNT(DISTINCT observer_email) AS unique_observers
            FROM touchpoints
        """)
        obs_row = cur.fetchone()

        return jsonify({
            'total_touchpoints': total,
            'overall_observer_coverage_pct': round(100 * obs_row['has_obs'] / total, 1) if total else 0,
            'unique_observers': obs_row['unique_observers'],
            'by_form_type': by_type,
            'score_dimensions': score_dims,
        })
    finally:
        conn.close()


@app.route('/api/admin/impersonation-log')
@require_auth
@require_admin
def api_impersonation_log():
    """Recent impersonation events. Admin-only."""
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT id, admin_email, impersonated_email, action, created_at
            FROM impersonation_log
            ORDER BY created_at DESC LIMIT 200
        """)
        rows = cur.fetchall()
        return jsonify([{
            'id': r['id'],
            'admin_email': r['admin_email'],
            'impersonated_email': r['impersonated_email'],
            'action': r['action'],
            'created_at': r['created_at'].isoformat() if r['created_at'] else None,
        } for r in rows])
    finally:
        conn.close()


# ------------------------------------------------------------------
# Pages — React app (primary) + vanilla JS prototypes (preserved)
# ------------------------------------------------------------------

REACT_DIR = os.path.join(os.path.dirname(__file__), 'frontend', 'dist')

@app.route('/')
def index():
    if not DEV_MODE and not get_current_user():
        return redirect('/login')
    # React app is canonical. Prototypes remain reachable at /prototypes/*
    # as design reference. Home.jsx handles the 4-button landing.
    react_index = os.path.join(REACT_DIR, 'index.html')
    if os.path.exists(react_index):
        return send_from_directory(REACT_DIR, 'index.html')
    return send_from_directory('prototypes', 'home-updated.html')


@app.route('/app')
@app.route('/app/')
@app.route('/app/<path:path>')
def serve_react(path=None):
    """React Router handles all /app/* routes client-side."""
    if not DEV_MODE and not get_current_user():
        return redirect('/login')
    react_index = os.path.join(REACT_DIR, 'index.html')
    if os.path.exists(react_index):
        return send_from_directory(REACT_DIR, 'index.html')
    return 'React app not built. Run: cd frontend && npm run build', 404


@app.route('/assets/<path:path>')
def serve_react_assets(path):
    """Serve React build assets (JS, CSS chunks)."""
    return send_from_directory(os.path.join(REACT_DIR, 'assets'), path)


# Vanilla JS prototypes — preserved at /prototypes/*
@app.route('/prototypes/<path:filename>')
def serve_prototype(filename):
    if not DEV_MODE and not get_current_user():
        return redirect('/login')
    return send_from_directory('prototypes', filename)


# ------------------------------------------------------------------
# API: My Team
# ------------------------------------------------------------------

@app.route('/api/my-team')
@require_auth
def api_my_team():
    user = get_current_user()
    if DEV_MODE:
        email = DEV_USER_EMAIL
        conn = db.get_conn()
        accessible = get_accessible_emails(conn, email, 'Chief People Officer')
        conn.close()
    else:
        email = user['email'] if user else ''
        accessible = user.get('accessible_emails', []) if user else []

    sy = request.args.get('school_year', CURRENT_SCHOOL_YEAR)
    view = request.args.get('view', 'direct')  # 'direct' or 'all'
    direct_email = email if view == 'direct' else None
    return jsonify(db.get_my_team(accessible, school_year=sy, direct_only_email=direct_email))


# ------------------------------------------------------------------
# API: Staff Profile
# ------------------------------------------------------------------

@app.route('/api/staff/<email>')
@require_auth
def api_staff_profile(email):
    user = get_current_user()
    if not DEV_MODE and not check_access(user, email):
        return jsonify({'error': 'Access denied'}), 403

    data = db.get_staff_profile(email)
    if not data:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(data)


# ------------------------------------------------------------------
# API: Network Dashboard
# ------------------------------------------------------------------

@app.route('/api/network')
@require_auth
def api_network():
    user = get_current_user()
    if not DEV_MODE and not is_supervisor(user):
        return jsonify({'error': 'Access denied'}), 403
    sy = request.args.get('school_year', CURRENT_SCHOOL_YEAR)
    return jsonify(db.get_network_dashboard(school_year=sy))


# ------------------------------------------------------------------
# API: Staff Search
# ------------------------------------------------------------------

@app.route('/api/staff/search')
@require_auth
def api_staff_search():
    q = request.args.get('q', '').strip()
    if len(q) < 2:
        return jsonify([])
    user = get_current_user()
    accessible = user.get('accessible_emails') if user and not DEV_MODE else None
    return jsonify(db.search_staff(q, accessible_emails=accessible, limit=15))


# ------------------------------------------------------------------
# API: Save Touchpoint
# ------------------------------------------------------------------

@app.route('/api/touchpoints', methods=['POST'])
@require_auth
@require_no_impersonation
def api_save_touchpoint():
    user = get_current_user()
    data = request.get_json()
    data['observer_email'] = user['email'] if user else DEV_USER_EMAIL
    data['school_year'] = CURRENT_SCHOOL_YEAR
    try:
        tp_id = db.save_touchpoint(data)
        return jsonify({'id': tp_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# API: AI Insights — natural language → SQL → results
# ------------------------------------------------------------------

INSIGHTS_SCHEMA = """
Tables in the ObservationPoint PostgreSQL database:

TABLE staff:
  email TEXT (primary key), first_name TEXT, last_name TEXT, job_title TEXT,
  school TEXT, job_function TEXT (Teacher/Leadership/Network/Support/Operations),
  supervisor_email TEXT, hire_date DATE, is_active BOOLEAN

TABLE touchpoints:
  id UUID (primary key), form_type TEXT, teacher_email TEXT (FK staff.email),
  observer_email TEXT, school TEXT, school_year TEXT (e.g. '2025-2026'),
  observed_at TIMESTAMPTZ, status TEXT, notes TEXT, feedback TEXT

  form_type values: observation_teacher, observation_fundamentals, observation_prek,
    pmap_teacher, pmap_leader, pmap_prek, pmap_support, pmap_network,
    self_reflection_teacher, self_reflection_leader, self_reflection_prek,
    self_reflection_support, self_reflection_network,
    quick_feedback, meeting_quick_meeting, meeting_data_meeting_(relay),
    write_up, iap, celebrate, solicited_feedback

TABLE scores:
  id SERIAL, touchpoint_id UUID (FK touchpoints.id), dimension_code TEXT,
  dimension_name TEXT, score NUMERIC, cycle INTEGER

  dimension_code values: T1 (On Task), T2 (Community of Learners),
    T3 (Essential Content), T4 (Cognitive Engagement), T5 (Demonstration of Learning),
    L1-L5 (Leadership), PK1-PK10 (PreK CLASS), M1-M5 (Fundamentals minutes)

School names: Arthur Ashe Charter School, Langston Hughes Academy,
  Phillis Wheatley Community School, Samuel J Green Charter School, FirstLine Network
"""

@app.route('/api/insights', methods=['POST'])
@require_auth
def api_insights():
    data = request.get_json()
    question = (data.get('question') or '').strip()
    if not question:
        return jsonify({'error': 'No question provided'}), 400

    try:
        import anthropic
        client = anthropic.Anthropic()

        # Ask Claude to generate SQL
        msg = client.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=1000,
            messages=[{
                'role': 'user',
                'content': f"""You are a SQL expert for a K-12 teacher observation database (PostgreSQL).

{INSIGHTS_SCHEMA}

User question: "{question}"

Generate ONLY a SELECT query to answer this question. Rules:
- Only SELECT statements. No INSERT, UPDATE, DELETE, DROP, ALTER, or CREATE.
- Use proper JOINs between tables.
- Limit results to 50 rows max.
- Return useful columns with clear aliases.
- If the question can't be answered from this schema, return: SELECT 'Question cannot be answered from available data' as error

Return ONLY the SQL. No explanation, no markdown fences, no comments."""
            }],
        )

        sql = msg.content[0].text.strip()

        # Strip markdown fences if present
        if sql.startswith('```'):
            sql = sql.split('\n', 1)[1] if '\n' in sql else sql[3:]
        if sql.endswith('```'):
            sql = sql[:-3]
        sql = sql.strip()

        # Validate: only SELECT allowed
        sql_upper = sql.upper().strip()
        if not sql_upper.startswith('SELECT'):
            return jsonify({'error': 'Invalid query generated', 'sql': sql}), 400
        forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'GRANT', 'REVOKE']
        for word in forbidden:
            if word in sql_upper.split('SELECT', 1)[0] or f' {word} ' in f' {sql_upper} ':
                return jsonify({'error': f'Forbidden SQL operation: {word}', 'sql': sql}), 400

        # Execute
        conn = db.get_conn()
        try:
            cur = conn.cursor()
            cur.execute(sql)
            columns = [desc[0] for desc in cur.description] if cur.description else []
            rows = cur.fetchall()

            # Convert to serializable format
            results = []
            for row in rows:
                record = {}
                for i, col in enumerate(columns):
                    val = row[i]
                    if hasattr(val, 'isoformat'):
                        val = val.isoformat()
                    elif isinstance(val, (int, float, str, bool)) or val is None:
                        pass
                    else:
                        val = str(val)
                    record[col] = val
                results.append(record)

            # Ask Claude to summarize the results
            summary_msg = client.messages.create(
                model='claude-sonnet-4-6',
                max_tokens=500,
                messages=[{
                    'role': 'user',
                    'content': f"""The user asked: "{question}"

The query returned {len(results)} rows with columns: {columns}

First 10 rows: {json.dumps(results[:10])}

Write a brief, clear 1-3 sentence answer to the user's question based on these results. Be specific with numbers. Do not mention SQL or databases."""
                }],
            )

            answer = summary_msg.content[0].text.strip()

            return jsonify({
                'question': question,
                'answer': answer,
                'sql': sql,
                'columns': columns,
                'rows': results[:50],
                'total': len(results),
            })
        finally:
            conn.close()

    except Exception as e:
        log.error(f"Insights error: {e}")
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# API: Form Configs
# ------------------------------------------------------------------

@app.route('/api/forms/<form_id>')
@require_auth
def api_get_form(form_id):
    safe_id = form_id.replace('..', '').replace('/', '')
    path = os.path.join(os.path.dirname(__file__), 'forms', f'{safe_id}.json')
    if not os.path.exists(path):
        return jsonify({'error': 'Not found'}), 404
    with open(path) as f:
        return jsonify(json.load(f))


# ------------------------------------------------------------------
# Run
# ------------------------------------------------------------------

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    debug = os.environ.get('FLASK_DEBUG', 'true').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug)
