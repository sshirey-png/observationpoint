"""
ObservationPoint — Flask Application
"""
import os
import json
import logging
import smtplib
import yaml
import psycopg2
import psycopg2.extras
from datetime import timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
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
    get_user_scope,
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
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)
CORS(app)
init_oauth(app)


# ------------------------------------------------------------------
# Startup migrations — idempotent column adds for new features
# ------------------------------------------------------------------
def _run_migrations():
    try:
        conn = db.get_conn()
        cur = conn.cursor()
        cur.execute("""
            ALTER TABLE touchpoints
              ADD COLUMN IF NOT EXISTS acknowledgment_token TEXT UNIQUE,
              ADD COLUMN IF NOT EXISTS acknowledgment_name TEXT,
              ADD COLUMN IF NOT EXISTS acknowledgment_at TIMESTAMPTZ,
              ADD COLUMN IF NOT EXISTS acknowledgment_ip TEXT,
              ADD COLUMN IF NOT EXISTS acknowledgment_ua TEXT,
              ADD COLUMN IF NOT EXISTS refused_at TIMESTAMPTZ,
              ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ,
              ADD COLUMN IF NOT EXISTS is_peer_recognition BOOLEAN DEFAULT FALSE
        """)
        # Goals — allow goal_type values like 'WIG' / 'AG1' / 'AG2' / 'AG3';
        # add status flow (draft -> submitted -> approved) + approver + submitter
        cur.execute("""
            ALTER TABLE goals
              ADD COLUMN IF NOT EXISTS submitted_by TEXT,
              ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
              ADD COLUMN IF NOT EXISTS approved_by TEXT,
              ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS recommended_goals (
              id SERIAL PRIMARY KEY,
              school_year TEXT NOT NULL,
              role TEXT NOT NULL,
              goal_type TEXT NOT NULL,
              goal_text TEXT NOT NULL,
              imported_at TIMESTAMPTZ DEFAULT NOW(),
              UNIQUE (school_year, role, goal_type)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_recg_role_year ON recommended_goals(role, school_year)")
        # Seed a few example rows if the table is empty — Scott can replace
        # once the Google Sheet sync is live.
        cur.execute("SELECT COUNT(*) FROM recommended_goals")
        if cur.fetchone()[0] == 0:
            seed = [
                ('2026-2027', 'PK Teacher', 'WIG', '80% of students meet end-of-year CLASS benchmarks.'),
                ('2026-2027', 'PK Teacher', 'AG1', 'Attend 3 PreK coaching cycles per semester.'),
                ('2026-2027', 'PK Teacher', 'AG2', 'Lead one family engagement event per quarter.'),
                ('2026-2027', 'PK Teacher', 'AG3', 'Maintain attendance tracker with <5% gap.'),
                ('2026-2027', 'K-2 Teacher', 'WIG', '75% of students on-grade or advancing in reading by EOY.'),
                ('2026-2027', 'K-2 Teacher', 'AG1', 'Implement daily guided reading groups with data tracking.'),
                ('2026-2027', 'K-2 Teacher', 'AG2', 'Build classroom library aligned to student levels.'),
                ('2026-2027', 'K-2 Teacher', 'AG3', 'Attend biweekly data meetings with full prep.'),
                ('2026-2027', '3-8 ELA Teacher', 'WIG', '70% of students meet or exceed grade-level ELA standards.'),
                ('2026-2027', '3-8 ELA Teacher', 'AG1', 'Run 3 writing units to completion with rubric-scored exemplars.'),
                ('2026-2027', '3-8 ELA Teacher', 'AG2', 'Lead one PLC discussion per quarter.'),
                ('2026-2027', '3-8 ELA Teacher', 'AG3', 'Maintain gradebook current within 5 school days.'),
                ('2026-2027', 'Leader', 'WIG', 'School meets academic achievement targets on state/FLS measures.'),
                ('2026-2027', 'Leader', 'AG1', 'Complete a full PMAP cycle with every direct report on time.'),
                ('2026-2027', 'Leader', 'AG2', 'Retention of high-performing teachers >= 85%.'),
                ('2026-2027', 'Leader', 'AG3', 'Conduct 4 family engagement events across the year.'),
                ('2026-2027', 'Network', 'WIG', 'Department strategy delivers on annual FLS network priorities.'),
                ('2026-2027', 'Network', 'AG1', 'Quarterly review of department goals with CPO.'),
                ('2026-2027', 'Network', 'AG2', 'Launch one cross-functional initiative per semester.'),
                ('2026-2027', 'Network', 'AG3', 'Produce a public-facing KPI dashboard for board review.'),
                ('2026-2027', 'Support', 'WIG', 'Department service level meets or exceeds FLS standards.'),
                ('2026-2027', 'Support', 'AG1', 'Close assigned tickets within SLA 90% of the time.'),
                ('2026-2027', 'Support', 'AG2', 'Complete required annual compliance trainings.'),
                ('2026-2027', 'Support', 'AG3', 'Submit monthly progress report to supervisor.'),
            ]
            cur.executemany(
                "INSERT INTO recommended_goals (school_year, role, goal_type, goal_text) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                seed,
            )
            log.info(f"Seeded {len(seed)} recommended_goals rows")

        # Uploads — polymorphic file attachments table.
        # parent_type: 'touchpoint' | 'goal' | 'assignment' | 'acknowledgment'
        # bucket: 'short' (90-day) | 'exemplar' (indefinite) | 'hr-locked' (7-year)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS uploads (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              parent_type TEXT NOT NULL,
              parent_id TEXT NOT NULL,
              bucket TEXT NOT NULL,
              gcs_path TEXT NOT NULL,
              filename TEXT NOT NULL,
              mime_type TEXT NOT NULL,
              size_bytes BIGINT NOT NULL,
              uploaded_by TEXT NOT NULL,
              uploaded_at TIMESTAMPTZ DEFAULT NOW(),
              delete_at TIMESTAMPTZ,
              promoted_to TEXT,
              promoted_at TIMESTAMPTZ,
              archived_at TIMESTAMPTZ
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_uploads_parent ON uploads(parent_type, parent_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(uploaded_by)")

        conn.commit()
        conn.close()
        log.info("Startup migration: acknowledgment + recommended_goals + uploads ensured")
    except Exception as e:
        log.error(f"Startup migration failed: {e}")


# ------------------------------------------------------------------
# Resolve a staff record to the recommended_goals.role bucket.
# Keeps the sheet's granular "Role" mapping in one Python function so
# we can iterate without changing data.
# ------------------------------------------------------------------
def resolve_recommended_role(staff):
    if not staff:
        return None
    title = (staff.get('job_title') or '').lower()
    grade = (staff.get('grade_level') or '').strip()
    subject = (staff.get('subject') or '').strip().lower()
    job_function = (staff.get('job_function') or '').lower()

    # Specific teacher role markers first
    if 'prek' in title or 'pre-k' in title or 'pre k' in title or grade.lower() == 'prek':
        return 'PK Teacher'
    if 'ell' in title:
        return 'ELL Teacher'
    if 'esy' in title:
        return 'ESY Teacher'
    if 'sped' in title or 'special ed' in title:
        if 'resource' in subject: return 'SPED Teacher (Resource)'
        if 'discovery' in subject: return 'SPED Teacher (Discovery)'
        return 'SPED Teacher (Resource)'  # default bucket when subject is unclear
    # Enrichment by subject
    if subject in {'art', 'music', 'pe', 'dance', 'discovery', 'computer', 'media', 'garden', 'kitchen', 'life skills'}:
        return 'Enrichment Teacher'

    # Grade-banded general teachers
    try:
        grade_int = int(grade) if grade.isdigit() else None
    except Exception:
        grade_int = None
    if grade_int is not None:
        if 0 <= grade_int <= 2:
            return 'K-2 Teacher'
        if 3 <= grade_int <= 8:
            if 'ela' in subject or 'english' in subject or 'reading' in subject: return '3-8 ELA Teacher'
            if 'math' in subject: return '3-8 Math Teacher'
            if 'science' in subject: return '3-8 Science Teacher'
            if 'social' in subject or subject == 'ss' or 'history' in subject: return '3-8 SS Teacher'

    # Fallbacks by job_function
    if job_function == 'leadership' or 'principal' in title or 'director' in title:
        return 'Leader'
    if job_function == 'network':
        return 'Network'
    if job_function in ('support', 'operations'):
        return 'Support'
    return 'Teacher'  # last-resort bucket

try:
    _run_migrations()
except Exception:
    pass


# ------------------------------------------------------------------
# PMAP archive form section labels + narrative cache
# Loaded once at startup; used by /api/touchpoint/<id>/full-detail
# ------------------------------------------------------------------
PMAP_SECTION_LABELS = {}
PMAP_2526_LABELS = {}
GROW_NARRATIVE_CACHE = {}
GROW_MEASUREMENT_MAP = {}  # mid → dim_code (for live UNK_*_5pt remap)
GROW_MID_CYCLE_MAP = {}  # mid → cycle int (1, 2, 3) for PreK CLASS rubric remap
try:
    _here = os.path.dirname(os.path.abspath(__file__))
    _labels_path = os.path.join(_here, 'grow_pmap_section_labels.json')
    if os.path.exists(_labels_path):
        with open(_labels_path, encoding='utf-8') as _f:
            PMAP_SECTION_LABELS = json.load(_f)
        log.info(f'Loaded 24-25 PMAP section labels: {len(PMAP_SECTION_LABELS)} sections')
    _labels_2526_path = os.path.join(_here, 'grow_pmap_2526_form_labels.json')
    if os.path.exists(_labels_2526_path):
        with open(_labels_2526_path, encoding='utf-8') as _f:
            PMAP_2526_LABELS = json.load(_f)
        log.info(f'Loaded 25-26 PMAP form labels: {len((PMAP_2526_LABELS.get("narrative") or {}))} narrative + {len((PMAP_2526_LABELS.get("scores") or {}))} score fields')
    _cache_path = os.path.join(_here, 'grow_narrative_cache.json')
    if os.path.exists(_cache_path):
        with open(_cache_path, encoding='utf-8') as _f:
            GROW_NARRATIVE_CACHE = json.load(_f)
        log.info(f'Loaded Grow narrative cache: {len(GROW_NARRATIVE_CACHE):,} records')
    # Build flat measurement_id → dim_code map from the rubric definitions.
    # Used to live-remap UNK_*_5pt scores when the original scores_v2 backfill
    # didn't have a particular L3/L4/L5 mid in the map.
    _mmap_path = os.path.join(_here, 'grow_measurement_map.json')
    if os.path.exists(_mmap_path):
        with open(_mmap_path, encoding='utf-8') as _f:
            _raw_mmap = json.load(_f)
        for _rkey, _dims in _raw_mmap.items():
            if not isinstance(_dims, dict): continue
            _cyc = None
            if 'cycle1' in _rkey: _cyc = 1
            elif 'cycle2' in _rkey: _cyc = 2
            elif 'cycle3' in _rkey: _cyc = 3
            for _dim_code, _info in _dims.items():
                if not isinstance(_info, dict): continue
                for _mid in (_info.get('ids') or []):
                    GROW_MEASUREMENT_MAP[_mid] = _dim_code
                    if _cyc:
                        GROW_MID_CYCLE_MAP[_mid] = _cyc
        log.info(f'Loaded measurement_id map: {len(GROW_MEASUREMENT_MAP):,} ids ({len(GROW_MID_CYCLE_MAP):,} with cycle)')
except Exception as _e:
    log.warning(f'Could not load PMAP form references: {_e}')


# ------------------------------------------------------------------
# HR doc gate — only Leadership, Network, or admins may file PIP / Write-Up
# ------------------------------------------------------------------
HR_DOC_FORM_TYPES = ('performance_improvement_plan', 'iap', 'write_up')
PMAP_FORM_TYPE_PREFIX = 'pmap_'

def _can_file_hr_doc(user):
    if not user:
        return False
    if user.get('is_admin'):
        return True
    jf = (user.get('job_function') or '').lower()
    return jf in ('leadership', 'network')


def _can_file_pmap(user):
    """PMAP authorship: admins OR anyone with direct reports (supervisors).
    Mirrors permissions.yaml: form_pmap grants admin / school_leader /
    supervisor. is_supervisor() returns true for both school leaders and
    other supervisors with downlines."""
    if not user:
        return False
    if user.get('is_admin'):
        return True
    return is_supervisor(user)


# ------------------------------------------------------------------
# Auth
# ------------------------------------------------------------------

@app.route('/login')
def login():
    session.permanent = True
    redirect_uri = request.url_root.rstrip('/') + '/auth/callback'
    return oauth.google.authorize_redirect(redirect_uri)


@app.route('/auth/callback')
def auth_callback():
    try:
        token = oauth.google.authorize_access_token()
    except Exception as e:
        log.warning(f"OAuth callback failed ({type(e).__name__}: {e}). Restarting login flow.")
        session.clear()
        return redirect('/login')
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
                'can_file_hr_doc': True,
                'accessible_count': 999,
                'scope': {'tier': 'admin'},
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
                'job_function': user.get('job_function', ''),
                'is_admin': user.get('is_admin', False),
                'is_supervisor': is_supervisor(user),
                'can_file_hr_doc': _can_file_hr_doc(user),
                'can_file_pmap': _can_file_pmap(user),
                'accessible_count': len(user.get('accessible_emails', [])),
                'scope': get_user_scope(user),
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
# API: Permissions matrix (read-only)
#
# Single source of truth lives in `permissions.yaml` at the project root.
# This endpoint exposes the parsed YAML for the /app/admin/permissions
# viewer page. Admin-only — the matrix itself describes who can access
# what, including this endpoint.
# ------------------------------------------------------------------

@app.route('/api/solicit-questions')
@require_auth
def api_solicit_questions():
    """Returns the parsed solicit_questions.yaml — question bank, custom-allow
    flag, max-questions cap, and standardized Likert scale config. Loaded by
    the SolicitFeedback form on mount. Auth-gated (any signed-in user)."""
    yaml_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'solicit_questions.yaml')
    try:
        with open(yaml_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f) or {}
        # Defaults if YAML is partial
        data.setdefault('questions', [])
        data.setdefault('allow_custom', True)
        data.setdefault('max_questions', 3)
        data.setdefault('likert_scales', [])
        return jsonify(data)
    except FileNotFoundError:
        return jsonify({'error': 'solicit_questions.yaml not found', 'questions': [], 'allow_custom': True, 'max_questions': 3, 'likert_scales': []}), 200
    except yaml.YAMLError as e:
        return jsonify({'error': f'YAML parse error: {e}'}), 500


@app.route('/api/permissions')
@require_auth
@require_admin
def api_permissions():
    yaml_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'permissions.yaml')
    try:
        with open(yaml_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        return jsonify(data)
    except FileNotFoundError:
        return jsonify({'error': 'permissions.yaml not found'}), 500
    except yaml.YAMLError as e:
        return jsonify({'error': f'YAML parse error: {e}'}), 500


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


@app.route('/api/admin/enrich-narrative', methods=['POST', 'GET'])
@require_auth
@require_admin
def api_enrich_narrative():
    """Paginated enrichment. Pulls a batch of Grow observations starting
    at ?skip=N (page size ?limit=500), extracts narrative content we
    missed on original import (textBoxes, valueText, comments), matches
    to existing touchpoints in Postgres by (teacher_email, observed_at
    date, derived form_type), writes feedback_json + plaintext feedback
    column.

    Each call processes ONE batch and returns progress. Caller keeps
    hitting with the returned next_skip until done=true. Idempotent:
    re-running the same range overwrites with the same data.

    Query args:
      skip=0           — starting offset in Grow's sorted observation list
      limit=500        — page size (≤ 500 keeps each request well under timeout)
      dry_run=true     — report match counts without writing (default)
      dry_run=false    — persist the feedback content

    Response:
      {skip, limit, grow_observations_pulled, matches_found, records_updated,
       no_postgres_match, next_skip, done, sample_updates?}
    """
    import base64, re, requests, html
    from datetime import datetime

    dry = request.args.get('dry_run', 'true').lower() != 'false'
    skip = int(request.args.get('skip', '0') or 0)
    limit = min(int(request.args.get('limit', '500') or 500), 1000)

    client_id = os.environ.get('LDG_CLIENT_ID', '6fe43bd0-e8d1-4ce0-a9a9-2267c9a3df9b')
    client_secret = os.environ.get('LDG_CLIENT_SECRET', '18eaec46-c6c9-4bcb-abf7-b36030485966')
    base = 'https://grow-api.leveldata.com'

    # Auth
    creds = base64.b64encode(f'{client_id}:{client_secret}'.encode()).decode()
    auth = requests.post(f'{base}/auth/client/token',
        headers={'Authorization': f'Basic {creds}', 'Content-Type': 'application/x-www-form-urlencoded'},
        timeout=30)
    if auth.status_code != 200:
        return jsonify({'error': 'Grow auth failed', 'body': auth.text[:300]}), 500
    token = auth.json()['access_token']

    # Determine form_type same way the original importer did (from rubric + type name)
    # Grow API sometimes returns observationType as a dict with .name, sometimes as
    # just an ID string — so we check BOTH rubric_name and type_name for 'pmap' etc.
    def derive_form_type(rubric_name, type_name):
        rn = (rubric_name or '').lower()
        tn = (type_name or '').lower()
        combined = rn + ' ' + tn
        ft = 'observation_teacher'
        if 'prek' in combined or 'pre-k' in combined:
            ft = 'observation_prek'
        if 'fundamental' in combined:
            ft = 'observation_fundamentals'
        if 'pmap' in combined:
            ft = 'pmap_teacher'
            if 'prek' in combined: ft = 'pmap_prek'
            elif 'leader' in combined: ft = 'pmap_leader'
            elif 'non-instructional' in combined or 'support' in combined: ft = 'pmap_support'
            elif 'network' in combined: ft = 'pmap_network'
        if 'self-reflection' in combined or 'self reflection' in combined:
            ft = 'self_reflection_teacher'
            if 'prek' in combined: ft = 'self_reflection_prek'
            elif 'leader' in combined: ft = 'self_reflection_leader'
            elif 'network' in combined: ft = 'self_reflection_network'
            elif 'non-instructional' in combined or 'support' in combined: ft = 'self_reflection_support'
        return ft

    strip_tags = re.compile(r'<[^>]+>')
    # Structural block tags that should become paragraph breaks
    block_break_re = re.compile(r'</?(?:p|div|br|h[1-6])\s*/?>', re.IGNORECASE)
    # List items become "- " lines
    li_open_re = re.compile(r'<li\s*[^>]*>', re.IGNORECASE)
    li_close_re = re.compile(r'</li\s*>', re.IGNORECASE)
    list_close_re = re.compile(r'</(?:ul|ol)\s*>', re.IGNORECASE)

    def html_to_text(val):
        """Convert HTML fragment to plain text preserving structure.
        <br>/<p>/<h1-6>/<div> → paragraph breaks
        <li>X</li> → '- X' on its own line
        </ul>/</ol> → trailing newline
        Then strip remaining tags and unescape entities.
        """
        if not val:
            return ''
        # Lists first — so bullet markers survive the block-break pass
        t = li_open_re.sub('\n- ', val)
        t = li_close_re.sub('', t)
        t = list_close_re.sub('\n', t)
        # Block-level tags → double newlines
        t = block_break_re.sub('\n\n', t)
        # Strip remaining tags
        t = strip_tags.sub('', t)
        # Decode entities
        t = html.unescape(t)
        # Collapse 3+ consecutive newlines to 2
        t = re.sub(r'\n{3,}', '\n\n', t)
        return t.strip()

    def extract_narrative(obs):
        narrative = []
        checkboxes_selected = []
        for s in obs.get('observationScores', []) or []:
            mid = s.get('measurement', '')
            # textBoxes — the coaching narrative lives here
            for tb in s.get('textBoxes', []) or []:
                val = tb.get('value')
                if val:
                    txt = html_to_text(val)
                    if txt:
                        narrative.append({'measurement': mid, 'text': txt})
            # valueText — yes/no answers
            if s.get('valueText'):
                checkboxes_selected.append({'measurement': mid, 'selected': s['valueText']})
            # checkboxes — which level was picked
            for cb in s.get('checkboxes', []) or []:
                if cb.get('value') is True:
                    checkboxes_selected.append({'measurement': mid, 'selected': (cb.get('label') or '').strip()})
        # Observation-level comments
        comments = [c for c in (obs.get('comments') or []) if c]
        # Observer info — pulled from Grow so imported records stop showing
        # 'Self' when the observer was actually someone else.
        observer = obs.get('observer') or {}
        if isinstance(observer, str): observer = {}
        return {
            'grow_id': obs.get('_id'),
            'narrative': narrative,
            'checkboxes_selected': checkboxes_selected,
            'comments': comments,
            'observer_email': (observer.get('email') or '').lower() or None,
            'observer_name': observer.get('name') or None,
        }

    # Pull ONE batch from Grow starting at `skip`
    r = requests.get(f'{base}/external/observations',
        headers={'Authorization': f'Bearer {token}'},
        params={'limit': limit, 'skip': skip},
        timeout=60)
    if r.status_code != 200:
        return jsonify({'error': f'Grow fetch failed: {r.status_code}', 'body': r.text[:300]}), 500
    page = r.json() or {}
    all_obs = page.get('data', [])
    grow_total = page.get('count', None)

    # For each, build narrative payload and try to match to a Postgres touchpoint
    matched = 0
    updated = 0
    no_match = 0
    updates_preview = []

    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        for obs in all_obs:
            teacher = obs.get('teacher') or {}
            if isinstance(teacher, str): teacher = {}
            teacher_email = (teacher.get('email') or '').lower()
            observed_at = obs.get('observedAt') or obs.get('created')
            if not teacher_email or not observed_at:
                continue

            rubric = obs.get('rubric') or {}
            if isinstance(rubric, str): rubric = {}
            rubric_name = rubric.get('name', '')
            obs_type = obs.get('observationType')
            # Grow API sometimes returns obs type as dict, sometimes as just an ID
            type_name = obs_type.get('name', '') if isinstance(obs_type, dict) else ''
            form_type = derive_form_type(rubric_name, type_name)

            payload = extract_narrative(obs)
            # Skip observations that have no narrative at all — no point updating
            if not payload['narrative'] and not payload['checkboxes_selected'] and not payload['comments']:
                continue

            # Match by (teacher_email, observed_at date, form_type)
            cur.execute("""
                SELECT id FROM touchpoints
                WHERE LOWER(teacher_email) = %s
                  AND DATE(observed_at) = DATE(%s)
                  AND form_type = %s
                ORDER BY observed_at
            """, (teacher_email, observed_at, form_type))
            rows = cur.fetchall()
            if not rows:
                no_match += 1
                continue
            matched += len(rows)

            plain_text = '\n\n'.join(n['text'] for n in payload['narrative'])

            if not dry:
                # Write feedback_json + feedback + grow_id + observer_email.
                # observer_email from Grow remediates imported records that
                # had wrong attribution (e.g., 'Self' showing on records the
                # teacher didn't actually self-submit).
                obs_email = payload.get('observer_email')
                for row in rows:
                    if obs_email:
                        cur.execute("""
                            UPDATE touchpoints
                            SET feedback_json = %s, feedback = %s, grow_id = %s,
                                observer_email = %s
                            WHERE id = %s
                        """, (json.dumps(payload), plain_text or None,
                              payload['grow_id'], obs_email, row['id']))
                    else:
                        cur.execute("""
                            UPDATE touchpoints
                            SET feedback_json = %s, feedback = %s, grow_id = %s
                            WHERE id = %s
                        """, (json.dumps(payload), plain_text or None,
                              payload['grow_id'], row['id']))
                    updated += 1
                conn.commit()
            elif len(updates_preview) < 5:
                updates_preview.append({
                    'grow_id': payload['grow_id'],
                    'teacher_email': teacher_email,
                    'observed_at': observed_at,
                    'form_type': form_type,
                    'matched_tp_ids': [str(r['id']) for r in rows],
                    'narrative_count': len(payload['narrative']),
                    'sample_narrative': (payload['narrative'][0]['text'][:200] if payload['narrative'] else None),
                })

        batch_size = len(all_obs)
        next_skip = skip + batch_size
        done = batch_size < limit or (grow_total is not None and next_skip >= grow_total)
        return jsonify({
            'dry_run': dry,
            'skip': skip,
            'limit': limit,
            'grow_total': grow_total,
            'grow_observations_pulled': batch_size,
            'matches_found': matched,
            'records_updated': updated,
            'no_postgres_match': no_match,
            'next_skip': next_skip,
            'done': done,
            'sample_updates': updates_preview if dry else None,
            'note': 'Hit again with the returned next_skip until done=true. Pass dry_run=false to persist.',
        })
    finally:
        conn.close()


@app.route('/admin/enrich-narrative')
@require_auth
@require_admin
def admin_enrich_narrative_page():
    """Auto-driving HTML page for the enrichment run. Hit it once,
    watch it page through batches until done. Shows live progress."""
    return """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Enrich Narrative — Admin</title>
<style>
body{font-family:Inter,system-ui,sans-serif;background:#f5f7fa;max-width:760px;margin:0 auto;padding:24px;color:#111827}
h1{color:#002f60;margin-bottom:4px}.sub{color:#6b7280;font-size:14px;margin-bottom:24px}
.card{background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.06);margin-bottom:14px}
.row{display:flex;align-items:center;gap:14px;margin-bottom:8px}.row b{color:#002f60}
.bar{height:10px;background:#e5e7eb;border-radius:5px;overflow:hidden;margin:12px 0}
.bar-fill{height:100%;background:linear-gradient(90deg,#e47727,#c2410c);transition:width .3s}
button{padding:12px 20px;border:0;border-radius:10px;background:#002f60;color:#fff;font-weight:700;font-family:inherit;cursor:pointer;font-size:14px}
button:disabled{opacity:.5;cursor:not-allowed}.stat{display:inline-block;margin-right:18px}.stat-val{font-size:22px;font-weight:800;color:#002f60}.stat-label{font-size:10px;text-transform:uppercase;color:#9ca3af;letter-spacing:.05em;display:block}
pre{background:#f5f7fa;padding:12px;border-radius:8px;font-size:11px;overflow-x:auto;max-height:220px}
.danger{background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;padding:10px 14px;border-radius:10px;font-size:13px;margin-bottom:14px}
.note{background:#fff7ed;color:#7c2d12;border:1px solid #fed7aa;padding:10px 14px;border-radius:10px;font-size:13px;margin-bottom:14px}
</style></head>
<body>
<h1>Enrich Narrative from Grow</h1>
<div class="sub">Pull textBoxes/valueText/comments from every Grow observation and write into matching Postgres touchpoints' feedback_json + feedback columns.</div>

<div class="note">
  <b>First: run a Dry Run</b> to confirm counts. Then click Write.<br>
  Safe to close the tab — last completed skip is shown; rerunning resumes there.
</div>

<div class="card">
  <div class="row">
    <button id="dryBtn" onclick="run(true)">Dry Run</button>
    <button id="writeBtn" onclick="run(false)">Write (dry_run=false)</button>
    <button id="stopBtn" onclick="stop()" disabled>Stop</button>
  </div>
  <div class="bar"><div class="bar-fill" id="bar" style="width:0%"></div></div>
  <div>
    <span class="stat"><span class="stat-val" id="sProcessed">0</span><span class="stat-label">Processed</span></span>
    <span class="stat"><span class="stat-val" id="sMatched">0</span><span class="stat-label">Matches</span></span>
    <span class="stat"><span class="stat-val" id="sUpdated">0</span><span class="stat-label">Updated</span></span>
    <span class="stat"><span class="stat-val" id="sNoMatch">0</span><span class="stat-label">No match</span></span>
  </div>
  <div id="status" class="sub" style="margin-top:12px">Ready.</div>
</div>

<div class="card" id="logCard" style="display:none">
  <b>Last batch:</b>
  <pre id="log"></pre>
</div>

<script>
let running = false, stopReq = false, totals = {processed:0, matched:0, updated:0, noMatch:0}
function el(id){return document.getElementById(id)}
function fmt(n){return n.toLocaleString()}

async function run(dry) {
  if (running) return
  running = true; stopReq = false
  totals = {processed:0, matched:0, updated:0, noMatch:0}
  el('dryBtn').disabled = true; el('writeBtn').disabled = true; el('stopBtn').disabled = false
  el('logCard').style.display = 'block'

  let skip = 0
  while (!stopReq) {
    el('status').textContent = `Processing batch at skip=${skip}…`
    const url = `/api/admin/enrich-narrative?skip=${skip}&limit=500&dry_run=${dry}`
    let r, d
    try {
      r = await fetch(url, {method: 'POST'})
      d = await r.json()
    } catch (e) {
      el('status').textContent = `Batch failed at skip=${skip}: ${e.message}. Click the button again to resume from skip=${skip}.`
      break
    }
    if (!r.ok) {
      el('status').textContent = `Error at skip=${skip}: ${d.error || r.status}`
      break
    }
    totals.processed += d.grow_observations_pulled || 0
    totals.matched += d.matches_found || 0
    totals.updated += d.records_updated || 0
    totals.noMatch += d.no_postgres_match || 0
    el('sProcessed').textContent = fmt(totals.processed)
    el('sMatched').textContent = fmt(totals.matched)
    el('sUpdated').textContent = fmt(totals.updated)
    el('sNoMatch').textContent = fmt(totals.noMatch)
    if (d.grow_total) {
      el('bar').style.width = Math.min(100, (totals.processed / d.grow_total) * 100) + '%'
    }
    el('log').textContent = JSON.stringify(d, null, 2)
    if (d.done) break
    skip = d.next_skip
  }
  el('status').textContent = stopReq ? `Stopped at skip=${skip}. Resume by clicking a button.` : `Done. ${dry ? 'Dry run complete — click Write to persist.' : 'Write complete.'}`
  el('dryBtn').disabled = false; el('writeBtn').disabled = false; el('stopBtn').disabled = true
  running = false
}
function stop(){ stopReq = true }
</script>
</body></html>"""


@app.route('/admin/cleanup')
@require_auth
@require_admin
def admin_cleanup_page():
    """One-page admin cleanup tool: dedup duplicates + create unique index
    + spot-check a staff member. Buttons beat fiddly POST URLs on mobile."""
    return """<!doctype html>
<html><head><meta charset="utf-8"><title>Cleanup — Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Inter,system-ui,sans-serif;background:#f5f7fa;max-width:720px;margin:0 auto;padding:20px;color:#111827}
h1{color:#002f60;margin-bottom:4px;font-size:22px}.sub{color:#6b7280;font-size:13px;margin-bottom:20px}
.card{background:#fff;border-radius:12px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.06);margin-bottom:12px}
.card h2{font-size:15px;color:#002f60;margin-bottom:4px}.card p{color:#6b7280;font-size:13px;margin-bottom:12px;line-height:1.5}
button{padding:12px 18px;border:0;border-radius:10px;color:#fff;font-weight:700;font-family:inherit;cursor:pointer;font-size:14px;margin-right:8px;margin-bottom:6px}
.b-nav{background:#002f60}.b-orange{background:#e47727}.b-red{background:#dc2626}.b-gray{background:#6b7280}
button:disabled{opacity:.5;cursor:not-allowed}
pre{background:#f5f7fa;padding:12px;border-radius:8px;font-size:11px;overflow-x:auto;max-height:240px;white-space:pre-wrap;word-break:break-all}
input{padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-family:inherit;font-size:14px;width:100%;box-sizing:border-box;margin-bottom:8px}
.stat{display:inline-block;margin-right:18px;padding:6px 0}.stat-val{font-size:20px;font-weight:800;color:#002f60;display:block}.stat-label{font-size:10px;text-transform:uppercase;color:#9ca3af;letter-spacing:.05em}
</style></head><body>
<h1>Admin · Cleanup</h1>
<div class="sub">Run after enrichment Write. Sequence: dedup dry → dedup write → create index → spot check.</div>

<div class="card">
  <h2>1 · Dedup by grow_id</h2>
  <p>Find touchpoints sharing a grow_id (duplicates). Dry run shows what WOULD be removed. Write actually removes them (and their score rows).</p>
  <button class="b-gray" onclick="run('dedup-dry')">Dry run</button>
  <button class="b-red" onclick="if(confirm('Delete duplicate rows permanently?')) run('dedup-write')">Write (delete duplicates)</button>
  <div id="dedup-out"></div>
</div>

<div class="card">
  <h2>2 · Broader dedup (no grow_id needed)</h2>
  <p>Catches duplicates by (teacher, date, form_type) for records that never matched enrichment (so grow_id is null). Run after step 1 to clean the long tail.</p>
  <button class="b-gray" onclick="run('dedup-broad-dry')">Dry run</button>
  <button class="b-red" onclick="if(confirm('Delete duplicate rows permanently?')) run('dedup-broad-write')">Write (delete duplicates)</button>
  <div id="dedup-broad-out"></div>
</div>

<div class="card">
  <h2>3 · Clear notes column garbage</h2>
  <p>Removes notes that contain just the form label (e.g., "Observation: Teacher", "PMAP: Teacher") — leftover from the original importer.</p>
  <button class="b-gray" onclick="run('cleanup-notes-dry')">Dry run</button>
  <button class="b-red" onclick="if(confirm('Clear those note rows?')) run('cleanup-notes-write')">Clear notes</button>
  <div id="cleanup-notes-out"></div>
</div>

<div class="card">
  <h2>4 · Create unique index on grow_id</h2>
  <p>Prevents future duplicates at the DB level. Must run AFTER step 1 succeeds.</p>
  <button class="b-nav" onclick="run('create-index')">Create index</button>
  <div id="create-index-out"></div>
</div>

<div class="card">
  <h2>5 · Spot check a staff member</h2>
  <p>Per-teacher breakdown: counts by form_type, narrative presence, grow_id coverage, estimated duplicates.</p>
  <input id="email" placeholder="someone@firstlineschools.org" />
  <button class="b-orange" onclick="runStaff()">Look up</button>
  <div id="staff-out"></div>
</div>

<script>
const urls = {
  'dedup-dry': '/api/admin/dedup-by-grow-id?dry_run=true',
  'dedup-write': '/api/admin/dedup-by-grow-id?dry_run=false',
  'dedup-broad-dry': '/api/admin/dedup-broad?dry_run=true',
  'dedup-broad-write': '/api/admin/dedup-broad?dry_run=false',
  'cleanup-notes-dry': '/api/admin/cleanup-notes?dry_run=true',
  'cleanup-notes-write': '/api/admin/cleanup-notes?dry_run=false',
  'create-index': '/api/admin/create-grow-id-index',
}
function outboxFor(kind){
  if (kind === 'dedup-dry' || kind === 'dedup-write') return document.getElementById('dedup-out')
  if (kind.startsWith('dedup-broad')) return document.getElementById('dedup-broad-out')
  if (kind.startsWith('cleanup-notes')) return document.getElementById('cleanup-notes-out')
  return document.getElementById(kind+'-out')
}
async function run(kind){
  const box = outboxFor(kind)
  box.innerHTML = '<pre>Running…</pre>'
  try {
    const r = await fetch(urls[kind], {method:'POST'})
    const d = await r.json()
    let summary = ''
    if (kind.startsWith('dedup')) {
      summary = `<div class="stat"><span class="stat-val">${(d.duplicate_groups||0).toLocaleString()}</span><span class="stat-label">Duplicate groups</span></div>`
              + `<div class="stat"><span class="stat-val">${(d.rows_to_delete||0).toLocaleString()}</span><span class="stat-label">${d.dry_run?'Would delete':'Deleted'}</span></div>`
              + `<div class="stat"><span class="stat-val">${(d.scores_deleted||0).toLocaleString()}</span><span class="stat-label">Score rows removed</span></div>`
    }
    box.innerHTML = summary + '<pre>'+JSON.stringify(d, null, 2).slice(0,2000)+'</pre>'
  } catch(e) { box.innerHTML = '<pre>Error: '+e.message+'</pre>' }
}
async function runStaff(){
  const email = document.getElementById('email').value.trim()
  if (!email) return
  const box = document.getElementById('staff-out')
  box.innerHTML = '<pre>Looking up…</pre>'
  try {
    const r = await fetch('/api/admin/staff-records?email='+encodeURIComponent(email))
    const d = await r.json()
    let summary = ''
    if (d.by_form_type) {
      summary = `<div class="stat"><span class="stat-val">${(d.total_records||0).toLocaleString()}</span><span class="stat-label">Total records</span></div>`
              + `<div class="stat"><span class="stat-val">${(d.implied_duplicates||0).toLocaleString()}</span><span class="stat-label">Implied duplicates</span></div>`
      summary += '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:10px"><tr style="background:#f5f7fa"><th style="text-align:left;padding:6px;border-bottom:1px solid #e5e7eb">Type</th><th style="text-align:right;padding:6px;border-bottom:1px solid #e5e7eb">Count</th><th style="text-align:right;padding:6px;border-bottom:1px solid #e5e7eb">Has feedback</th><th style="text-align:right;padding:6px;border-bottom:1px solid #e5e7eb">Has grow_id</th></tr>'
      for (const f of d.by_form_type) {
        summary += `<tr><td style="padding:6px;border-bottom:1px solid #f3f4f6"><code>${f.form_type}</code></td><td style="text-align:right;padding:6px;border-bottom:1px solid #f3f4f6">${f.count}</td><td style="text-align:right;padding:6px;border-bottom:1px solid #f3f4f6">${f.has_feedback_text}</td><td style="text-align:right;padding:6px;border-bottom:1px solid #f3f4f6">${f.has_grow_id}</td></tr>`
      }
      summary += '</table>'
    }
    box.innerHTML = summary + '<pre style="margin-top:10px">'+JSON.stringify(d, null, 2).slice(0,3000)+'</pre>'
  } catch(e) { box.innerHTML = '<pre>Error: '+e.message+'</pre>' }
}
</script>
</body></html>"""


@app.route('/api/admin/grow-raw-probe')
@require_auth
@require_admin
def api_grow_raw_probe():
    """Probe the Grow API: fetch one raw observation and return every
    field it has. Tells us whether qualitative content (feedback, notes,
    comments, action steps) is exposed via API and just wasn't imported,
    OR whether Grow doesn't expose it at all."""
    import base64
    import requests

    client_id = os.environ.get('LDG_CLIENT_ID', '6fe43bd0-e8d1-4ce0-a9a9-2267c9a3df9b')
    client_secret = os.environ.get('LDG_CLIENT_SECRET', '18eaec46-c6c9-4bcb-abf7-b36030485966')
    base = 'https://grow-api.leveldata.com'

    try:
        creds = base64.b64encode(f'{client_id}:{client_secret}'.encode()).decode()
        r = requests.post(f'{base}/auth/client/token',
            headers={'Authorization': f'Basic {creds}', 'Content-Type': 'application/x-www-form-urlencoded'},
            timeout=30)
        if r.status_code != 200:
            return jsonify({'error': f'Auth failed: {r.status_code}', 'body': r.text[:500]}), 500
        token = r.json()['access_token']

        # Fetch just 1 recent observation
        r = requests.get(f'{base}/external/observations',
            headers={'Authorization': f'Bearer {token}'},
            params={'limit': 1, 'skip': 0},
            timeout=60)
        if r.status_code != 200:
            return jsonify({'error': f'Fetch failed: {r.status_code}', 'body': r.text[:500]}), 500

        data = r.json()
        records = data.get('data', [])
        if not records:
            return jsonify({'error': 'No observations returned'})
        raw = records[0]

        # Return the full raw JSON + a list of all top-level keys so we
        # can see what we're NOT importing.
        return jsonify({
            'endpoint_used': f'{base}/external/observations?limit=1',
            'top_level_keys': sorted(raw.keys()),
            'raw_observation': raw,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/data-audit-deep')
@require_auth
@require_admin
def api_data_audit_deep():
    """Deeper audit: is the qualitative content sitting in `feedback` or
    `scores_json` columns that the initial audit missed?"""
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute("""
            SELECT
              form_type,
              COUNT(*) AS n,
              COUNT(feedback) AS has_feedback_col,
              COUNT(CASE WHEN feedback IS NOT NULL AND feedback <> '' THEN 1 END) AS feedback_non_empty,
              AVG(LENGTH(feedback))::int AS feedback_avg_len,
              MAX(LENGTH(feedback)) AS feedback_max_len,
              COUNT(scores_json) AS has_scores_json,
              COUNT(CASE WHEN notes IS NOT NULL AND LENGTH(notes) > 50 THEN 1 END) AS notes_substantial,
              COUNT(CASE WHEN notes IS NOT NULL AND LENGTH(notes) > 200 THEN 1 END) AS notes_rich
            FROM touchpoints
            GROUP BY form_type
            ORDER BY n DESC
        """)
        by_type = []
        for r in cur.fetchall():
            ft = r['form_type']
            n = r['n']
            # Sample a record that actually HAS feedback content
            cur.execute("""
                SELECT id, observed_at, LEFT(feedback, 400) AS fb_preview,
                       LENGTH(feedback) AS fb_len, scores_json
                FROM touchpoints
                WHERE form_type = %s AND feedback IS NOT NULL AND feedback <> ''
                ORDER BY LENGTH(feedback) DESC
                LIMIT 1
            """, (ft,))
            rich_sample = cur.fetchone()

            by_type.append({
                'form_type': ft,
                'count': n,
                'pct_feedback_col':     round(100 * r['feedback_non_empty'] / n, 1) if n else 0,
                'feedback_avg_len':     r['feedback_avg_len'],
                'feedback_max_len':     r['feedback_max_len'],
                'pct_scores_json':      round(100 * r['has_scores_json'] / n, 1) if n else 0,
                'pct_notes_substantial_gt50':  round(100 * r['notes_substantial'] / n, 1) if n else 0,
                'pct_notes_rich_gt200': round(100 * r['notes_rich'] / n, 1) if n else 0,
                'richest_feedback_sample': {
                    'observed_at': rich_sample['observed_at'].isoformat() if rich_sample and rich_sample['observed_at'] else None,
                    'feedback_len': rich_sample['fb_len'] if rich_sample else 0,
                    'feedback_preview': rich_sample['fb_preview'] if rich_sample else None,
                    'scores_json_keys': list((rich_sample['scores_json'] or {}).keys()) if rich_sample and rich_sample.get('scores_json') else [],
                } if rich_sample else None,
            })

        # What's in scores_json where it exists?
        cur.execute("""
            SELECT form_type, scores_json
            FROM touchpoints
            WHERE scores_json IS NOT NULL
            LIMIT 5
        """)
        scores_json_samples = [dict(r) for r in cur.fetchall()]

        # What is RB? Which form_types does RB appear in?
        cur.execute("""
            SELECT t.form_type, COUNT(*) AS n
            FROM scores sc
            JOIN touchpoints t ON sc.touchpoint_id = t.id
            WHERE sc.dimension_code = 'RB'
            GROUP BY t.form_type
            ORDER BY n DESC
        """)
        rb_by_type = [dict(r) for r in cur.fetchall()]

        # L1-L5 distribution for leader PMAPs
        cur.execute("""
            SELECT sc.dimension_code, COUNT(*) AS n
            FROM scores sc
            JOIN touchpoints t ON sc.touchpoint_id = t.id
            WHERE t.form_type = 'pmap_leader'
            GROUP BY sc.dimension_code
            ORDER BY sc.dimension_code
        """)
        leader_pmap_dims = [dict(r) for r in cur.fetchall()]

        return jsonify({
            'by_form_type': by_type,
            'scores_json_samples': scores_json_samples,
            'rb_dimension_appears_in': rb_by_type,
            'leader_pmap_dim_distribution': leader_pmap_dims,
        })
    finally:
        conn.close()


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


@app.route('/api/admin/dedup-by-grow-id', methods=['GET', 'POST'])
@require_auth
@require_admin
def api_dedup_by_grow_id():
    """Dedup touchpoints that share a grow_id (same Grow observation imported
    more than once). Keeps the row with the most scores and non-empty narrative;
    deletes the rest (along with their score rows).

    Query:
      ?dry_run=true  (default) — report what would be deleted, change nothing
      ?dry_run=false           — actually delete
    """
    dry = request.args.get('dry_run', 'true').lower() != 'false'
    conn = None
    try:
        conn = db.get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # For each grow_id with >1 row, rank candidates:
        # 1. Most scores attached  2. Has non-empty feedback  3. Earliest observed_at
        # Pre-aggregating scores into a CTE avoids a correlated subquery
        # for every ranked row (was timing out on 5K+ row groups).
        cur.execute("""
            WITH score_counts AS (
                SELECT touchpoint_id, COUNT(*) AS n FROM scores GROUP BY touchpoint_id
            ),
            dup_growids AS (
                SELECT grow_id FROM touchpoints
                WHERE grow_id IS NOT NULL
                GROUP BY grow_id HAVING COUNT(*) > 1
            ),
            ranked AS (
                SELECT t.id, t.grow_id, t.observed_at, t.teacher_email, t.form_type,
                       (t.feedback IS NOT NULL AND t.feedback <> '') AS has_fb,
                       COALESCE(sc.n, 0) AS score_count,
                       ROW_NUMBER() OVER (
                           PARTITION BY t.grow_id
                           ORDER BY COALESCE(sc.n, 0) DESC,
                                    (t.feedback IS NOT NULL AND t.feedback <> '') DESC,
                                    t.observed_at ASC, t.id ASC
                       ) AS rnk
                FROM touchpoints t
                JOIN dup_growids g ON g.grow_id = t.grow_id
                LEFT JOIN score_counts sc ON sc.touchpoint_id = t.id
            )
            SELECT * FROM ranked ORDER BY grow_id, rnk
        """)
        rows = cur.fetchall()

        keep_ids = [r['id'] for r in rows if r['rnk'] == 1]
        delete_ids = [r['id'] for r in rows if r['rnk'] > 1]
        group_count = len(set(r['grow_id'] for r in rows))

        samples = []
        seen_grow = set()
        for r in rows[:20]:
            if r['grow_id'] in seen_grow:
                continue
            seen_grow.add(r['grow_id'])
            # Pull the full ranked group for this grow_id
            group = [x for x in rows if x['grow_id'] == r['grow_id']]
            samples.append({
                'grow_id': r['grow_id'],
                'teacher_email': r['teacher_email'],
                'form_type': r['form_type'],
                'rows': [{
                    'id': str(g['id']),
                    'observed_at': g['observed_at'].isoformat() if g['observed_at'] else None,
                    'score_count': g['score_count'],
                    'has_feedback': g['has_fb'],
                    'action': 'KEEP' if g['rnk'] == 1 else 'DELETE',
                } for g in group],
            })
            if len(samples) >= 10:
                break

        result = {
            'dry_run': dry,
            'duplicate_groups': group_count,
            'rows_to_keep': len(keep_ids),
            'rows_to_delete': len(delete_ids),
            'sample_groups': samples,
        }

        if not dry and delete_ids:
            # Batch deletes so one request doesn't hold a long-running
            # transaction. 500 ids per chunk keeps each statement quick
            # and lets us recover gracefully if the request is interrupted.
            scores_deleted = 0
            tp_deleted = 0
            for i in range(0, len(delete_ids), 500):
                chunk = [str(x) for x in delete_ids[i:i+500]]
                cur.execute("DELETE FROM scores WHERE touchpoint_id = ANY(%s::uuid[])", (chunk,))
                scores_deleted += cur.rowcount
                cur.execute("DELETE FROM touchpoints WHERE id = ANY(%s::uuid[])", (chunk,))
                tp_deleted += cur.rowcount
                conn.commit()
            result['scores_deleted'] = scores_deleted
            result['touchpoints_deleted'] = tp_deleted

        return jsonify(result)
    except Exception as e:
        log.error(f"dedup-by-grow-id failed: {e}", exc_info=True)
        return jsonify({'error': str(e), 'where': 'dedup-by-grow-id'}), 500
    finally:
        if conn is not None:
            try: conn.close()
            except: pass


@app.route('/api/admin/cleanup-notes', methods=['GET', 'POST'])
@require_auth
@require_admin
def api_cleanup_notes():
    """Clear the 'notes' column where it just contains the form label
    (e.g., 'Observation: Teacher', 'PMAP: Teacher'). Legacy importer bug
    stuffed the form name into the notes column.

    Query:  ?dry_run=true (default) | false
    """
    dry = request.args.get('dry_run', 'true').lower() != 'false'
    # Form-label variants we've seen land in the notes column:
    junk = [
        'Observation: Teacher', 'Observation: PreK', 'Observation: Leader',
        'Fundamentals', 'PMAP: Teacher', 'PMAP: PreK', 'PMAP: Leader',
        'PMAP: Support', 'PMAP: Network',
        'Self-Reflection: Teacher', 'Self-Reflection: PreK', 'Self-Reflection: Leader',
        'Self-Reflection: Support', 'Self-Reflection: Network',
        'Quick Feedback', 'Celebrate', 'Solicited Feedback',
        'Data Meeting (Relay)', 'Coaching Meeting',
    ]
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT COUNT(*) AS n FROM touchpoints
            WHERE TRIM(notes) = ANY(%s)
        """, (junk,))
        count = cur.fetchone()['n']
        result = {'dry_run': dry, 'rows_matching_label_noise': count}
        if not dry and count:
            cur.execute("""
                UPDATE touchpoints SET notes = NULL
                WHERE TRIM(notes) = ANY(%s)
            """, (junk,))
            result['rows_cleared'] = cur.rowcount
            conn.commit()
        return jsonify(result)
    finally:
        conn.close()


@app.route('/api/admin/dedup-broad', methods=['GET', 'POST'])
@require_auth
@require_admin
def api_dedup_broad():
    """Dedup touchpoints duplicating on (teacher_email, DATE(observed_at), form_type)
    regardless of grow_id. Catches imported rows that never matched enrichment.
    Keeps row with most scores + has feedback + earliest observed_at; deletes the rest."""
    dry = request.args.get('dry_run', 'true').lower() != 'false'
    conn = None
    try:
        conn = db.get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            WITH groups AS (
                SELECT LOWER(teacher_email) AS t_email, DATE(observed_at) AS d, form_type
                FROM touchpoints
                WHERE teacher_email IS NOT NULL AND observed_at IS NOT NULL
                GROUP BY LOWER(teacher_email), DATE(observed_at), form_type
                HAVING COUNT(*) > 1
            ),
            score_counts AS (
                SELECT touchpoint_id, COUNT(*) AS n FROM scores GROUP BY touchpoint_id
            ),
            ranked AS (
                SELECT t.id,
                       ROW_NUMBER() OVER (
                           PARTITION BY LOWER(t.teacher_email), DATE(t.observed_at), t.form_type
                           ORDER BY COALESCE(sc.n, 0) DESC,
                                    (t.feedback IS NOT NULL AND t.feedback <> '') DESC,
                                    t.observed_at ASC, t.id ASC
                       ) AS rnk
                FROM touchpoints t
                JOIN groups g
                  ON g.t_email = LOWER(t.teacher_email)
                 AND g.d = DATE(t.observed_at)
                 AND g.form_type = t.form_type
                LEFT JOIN score_counts sc ON sc.touchpoint_id = t.id
            )
            SELECT id, rnk FROM ranked ORDER BY rnk
        """)
        rows = cur.fetchall()
        delete_ids = [r['id'] for r in rows if r['rnk'] > 1]
        groups_count = sum(1 for r in rows if r['rnk'] == 1)
        result = {
            'dry_run': dry,
            'duplicate_groups': groups_count,
            'rows_to_delete': len(delete_ids),
        }
        if not dry and delete_ids:
            scores_deleted = 0
            tp_deleted = 0
            for i in range(0, len(delete_ids), 500):
                chunk = [str(x) for x in delete_ids[i:i+500]]
                cur.execute("DELETE FROM scores WHERE touchpoint_id = ANY(%s::uuid[])", (chunk,))
                scores_deleted += cur.rowcount
                cur.execute("DELETE FROM touchpoints WHERE id = ANY(%s::uuid[])", (chunk,))
                tp_deleted += cur.rowcount
                conn.commit()
            result['scores_deleted'] = scores_deleted
            result['touchpoints_deleted'] = tp_deleted
        return jsonify(result)
    except Exception as e:
        log.error(f"dedup-broad failed: {e}", exc_info=True)
        return jsonify({'error': str(e), 'where': 'dedup-broad'}), 500
    finally:
        if conn is not None:
            try: conn.close()
            except: pass


@app.route('/api/admin/create-grow-id-index', methods=['POST'])
@require_auth
@require_admin
def api_create_grow_id_index():
    """Create partial unique index on touchpoints.grow_id (where not null).
    Safe to call multiple times — uses IF NOT EXISTS. Call AFTER dedup-by-grow-id
    since the index creation will fail if duplicates still exist."""
    conn = db.get_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_tp_grow_id_unique
            ON touchpoints(grow_id)
            WHERE grow_id IS NOT NULL
        """)
        conn.commit()
        return jsonify({'ok': True, 'index': 'idx_tp_grow_id_unique'})
    except psycopg2.errors.UniqueViolation as e:
        conn.rollback()
        return jsonify({'ok': False, 'error': 'duplicates still exist — run /api/admin/dedup-by-grow-id first', 'detail': str(e)}), 409
    finally:
        conn.close()


@app.route('/api/admin/staff-records')
@require_auth
@require_admin
def api_staff_records():
    """Per-teacher record breakdown. Diagnostic for enrichment verification.
    Query: ?email=someone@firstlineschools.org
    Returns counts by form_type with narrative/score/feedback presence flags,
    plus first+last observed dates and a short narrative sample where present.
    """
    email = (request.args.get('email') or '').strip().lower()
    if not email:
        return jsonify({'error': 'email query param required'}), 400
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT
              form_type,
              COUNT(*) AS n,
              COUNT(CASE WHEN feedback_json IS NOT NULL THEN 1 END) AS has_feedback_json,
              COUNT(CASE WHEN feedback IS NOT NULL AND feedback <> '' THEN 1 END) AS has_feedback_text,
              COUNT(CASE WHEN grow_id IS NOT NULL THEN 1 END) AS has_grow_id,
              MIN(observed_at) AS first_observed,
              MAX(observed_at) AS last_observed
            FROM touchpoints
            WHERE LOWER(teacher_email) = %s
            GROUP BY form_type
            ORDER BY n DESC
        """, (email,))
        by_type = []
        for r in cur.fetchall():
            ft = r['form_type']
            # Sample narrative from one enriched record of this type
            cur.execute("""
                SELECT LEFT(feedback, 300) AS preview, grow_id, observed_at
                FROM touchpoints
                WHERE LOWER(teacher_email) = %s AND form_type = %s
                  AND feedback IS NOT NULL AND feedback <> ''
                ORDER BY observed_at DESC
                LIMIT 1
            """, (email, ft))
            sample = cur.fetchone()
            by_type.append({
                'form_type': ft,
                'count': r['n'],
                'has_feedback_json': r['has_feedback_json'],
                'has_feedback_text': r['has_feedback_text'],
                'has_grow_id': r['has_grow_id'],
                'first_observed': r['first_observed'].isoformat() if r['first_observed'] else None,
                'last_observed': r['last_observed'].isoformat() if r['last_observed'] else None,
                'sample': {
                    'preview': sample['preview'] if sample else None,
                    'grow_id': sample['grow_id'] if sample else None,
                    'observed_at': sample['observed_at'].isoformat() if sample and sample['observed_at'] else None,
                } if sample else None,
            })

        cur.execute("""
            SELECT COUNT(*) AS total,
                   COUNT(DISTINCT DATE(observed_at) || '|' || form_type || '|' || COALESCE(observer_email,'')) AS unique_events
            FROM touchpoints
            WHERE LOWER(teacher_email) = %s
        """, (email,))
        totals = cur.fetchone()
        return jsonify({
            'email': email,
            'total_records': totals['total'],
            'estimated_unique_events': totals['unique_events'],
            'implied_duplicates': totals['total'] - totals['unique_events'],
            'by_form_type': by_type,
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

def _nocache_html(resp):
    """HTML responses must never be cached — each deploy gets a new JS hash
    and the index.html needs to reflect it immediately. The hashed assets
    themselves cache forever (filename changes on every build)."""
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp


@app.route('/')
def index():
    if not DEV_MODE and not get_current_user():
        return redirect('/login')
    react_index = os.path.join(REACT_DIR, 'index.html')
    if os.path.exists(react_index):
        return _nocache_html(send_from_directory(REACT_DIR, 'index.html'))
    return _nocache_html(send_from_directory('prototypes', 'home-updated.html'))


@app.route('/app')
@app.route('/app/')
@app.route('/app/<path:path>')
def serve_react(path=None):
    """React Router handles all /app/* routes client-side."""
    if not DEV_MODE and not get_current_user():
        return redirect('/login')
    react_index = os.path.join(REACT_DIR, 'index.html')
    if os.path.exists(react_index):
        return _nocache_html(send_from_directory(REACT_DIR, 'index.html'))
    return 'React app not built. Run: cd frontend && npm run build', 404


@app.route('/assets/<path:path>')
def serve_react_assets(path):
    """Serve React build assets (JS, CSS chunks).
    Vite hashes the filenames (e.g. index-abc123.js), so these can cache
    forever — every build gets a new filename."""
    resp = send_from_directory(os.path.join(REACT_DIR, 'assets'), path)
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp


# Vanilla JS prototypes — preserved at /prototypes/*
@app.route('/prototypes/<path:filename>')
def serve_prototype(filename):
    if not DEV_MODE and not get_current_user():
        return redirect('/login')
    resp = send_from_directory('prototypes', filename)
    if filename.endswith('.html'):
        return _nocache_html(resp)
    return resp


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


@app.route('/api/my-team/action-step-summary')
@require_auth
def api_my_team_action_step_summary():
    """Surface action-step state for the current user's direct reports.
    Returns: stale_count (open + no progress 30+d) and locked_in_recent
    (steps marked 100% in last 14 days, for the recognition opportunity bullet)."""
    user = get_current_user()
    if DEV_MODE:
        email = DEV_USER_EMAIL
        conn = db.get_conn()
        accessible = get_accessible_emails(conn, email, 'Chief People Officer')
        conn.close()
    else:
        email = user['email'] if user else ''
        # For action-step summary, scope to direct reports — accessible is too broad
        conn = db.get_conn()
        try:
            cur = conn.cursor()
            cur.execute("SELECT email FROM staff WHERE LOWER(supervisor_email) = LOWER(%s) AND is_active", (email,))
            accessible = [r[0] for r in cur.fetchall()]
        finally:
            conn.close()

    if not accessible:
        return jsonify({'stale_count': 0, 'locked_in_recent': []})

    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # Stale: open action steps for direct reports with no progress in 30+ days
        cur.execute("""
            SELECT COUNT(*) AS n
            FROM action_steps
            WHERE LOWER(teacher_email) = ANY(%s)
              AND type = 'actionStep'
              AND (is_test IS NULL OR is_test = false)
              AND (progress_pct IS NULL OR progress_pct < 100)
              AND (progress_date IS NULL OR progress_date < NOW() - INTERVAL '30 days')
              AND created_at > NOW() - INTERVAL '180 days'
        """, ([e.lower() for e in accessible],))
        stale_count = cur.fetchone()['n']

        # Locked in recent: 100% in last 14 days, with teacher name
        cur.execute("""
            SELECT a.body_text, a.teacher_email, a.progress_date,
                   s.first_name, s.last_name
            FROM action_steps a
            LEFT JOIN staff s ON LOWER(s.email) = LOWER(a.teacher_email)
            WHERE LOWER(a.teacher_email) = ANY(%s)
              AND a.type = 'actionStep'
              AND (a.is_test IS NULL OR a.is_test = false)
              AND a.progress_pct = 100
              AND a.progress_date > NOW() - INTERVAL '14 days'
            ORDER BY a.progress_date DESC
            LIMIT 5
        """, ([e.lower() for e in accessible],))
        locked_in = [
            {
                'teacher_name': f"{r['first_name'] or ''} {r['last_name'] or ''}".strip() or r['teacher_email'],
                'teacher_email': r['teacher_email'],
                'step_text': r['body_text'],
                'locked_at': r['progress_date'].isoformat() if r['progress_date'] else None,
            }
            for r in cur.fetchall()
        ]
        return jsonify({'stale_count': stale_count, 'locked_in_recent': locked_in})
    finally:
        conn.close()


# ------------------------------------------------------------------
# API: Staff Profile
# ------------------------------------------------------------------

@app.route('/api/my-recent-touchpoints')
@require_auth
def api_my_recent_touchpoints():
    """Last N touchpoints the current user created (as observer).
    Powers the 'Recent' list on TouchpointHub."""
    user = get_current_user()
    if not user:
        return jsonify([])
    email = user.get('email', '').lower()
    limit = min(int(request.args.get('limit', '5') or 5), 25)
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT t.id, t.form_type, t.observed_at, t.teacher_email, t.school,
                   s.first_name, s.last_name
            FROM touchpoints t
            LEFT JOIN staff s ON t.teacher_email = s.email
            WHERE LOWER(t.observer_email) = %s
              AND t.status = 'published'
            ORDER BY t.observed_at DESC
            LIMIT %s
        """, (email, limit))
        rows = cur.fetchall()
        return jsonify([{
            'id': str(r['id']),
            'form_type': r['form_type'],
            'observed_at': r['observed_at'].isoformat() if r['observed_at'] else None,
            'teacher_email': r['teacher_email'],
            'teacher_name': f"{r['first_name'] or ''} {r['last_name'] or ''}".strip() or r['teacher_email'],
            'school': r['school'],
        } for r in rows])
    finally:
        conn.close()


@app.route('/api/staff/<email>/assignments')
@require_auth
def api_staff_assignments(email):
    """Action steps + goals + to-dos for a specific teacher.
    Pulled from the imported assignments table (Grow JSON dump)."""
    user = get_current_user()
    if not DEV_MODE and not check_access(user, email):
        return jsonify({'error': 'Access denied'}), 403
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT id, type, body_text, progress_pct, progress_date, progress_justification,
                   creator_email, observation_grow_id, created_at, school_year
            FROM action_steps
            WHERE LOWER(teacher_email) = %s
              AND (is_test IS NULL OR is_test = false)
            ORDER BY created_at DESC
        """, (email.lower(),))
        rows = cur.fetchall()
        return jsonify([{
            'id': r['id'], 'type': r['type'], 'body': r['body_text'],
            'progress_pct': r['progress_pct'],
            'progress_date': r['progress_date'].isoformat() if r['progress_date'] else None,
            'progress_justification': r['progress_justification'],
            'creator_email': r['creator_email'],
            'observation_grow_id': r['observation_grow_id'],
            'created_at': r['created_at'].isoformat() if r['created_at'] else None,
            'school_year': r['school_year'],
        } for r in rows])
    finally:
        conn.close()


@app.route('/api/network/sr-summary')
@require_auth
def api_network_sr_summary():
    """Self-reflection participation: by role + by year + by school.
    Real participation data, multi-year trend."""
    user = get_current_user()
    if not DEV_MODE and not is_supervisor(user):
        return jsonify({'error': 'Access denied'}), 403
    sy = request.args.get('school_year', CURRENT_SCHOOL_YEAR)
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Active staff denominators by function
        cur.execute("""
            SELECT job_function, COUNT(*) AS n FROM staff
            WHERE is_active AND job_function IS NOT NULL AND job_function <> ''
            GROUP BY job_function
        """)
        denominators = {r['job_function']: r['n'] for r in cur.fetchall()}

        # SR by role, this year
        cur.execute("""
            SELECT form_type,
                   COUNT(*) AS submissions,
                   COUNT(DISTINCT teacher_email) AS unique_teachers
            FROM touchpoints
            WHERE form_type LIKE 'self_reflection_%%' AND status = 'published'
              AND school_year = %s
            GROUP BY form_type ORDER BY form_type
        """, (sy,))
        by_role = []
        ROLE_MAP = {
            'self_reflection_teacher': ('Teacher', 'Teacher'),
            'self_reflection_leader': ('Leader', 'Leadership'),
            'self_reflection_prek': ('PreK', 'Teacher'),  # PreK lives in Teacher count
            'self_reflection_support': ('Support', 'Support'),
            'self_reflection_network': ('Network', 'Network'),
        }
        for r in cur.fetchall():
            label, denom_key = ROLE_MAP.get(r['form_type'], (r['form_type'], None))
            denom = denominators.get(denom_key) if denom_key else None
            by_role.append({
                'form_type': r['form_type'],
                'label': label,
                'submissions': r['submissions'],
                'unique_teachers': r['unique_teachers'],
                'denominator': denom,
            })

        # SR by school, this year
        cur.execute("""
            SELECT school, COUNT(*) AS submissions, COUNT(DISTINCT teacher_email) AS unique
            FROM touchpoints
            WHERE form_type LIKE 'self_reflection_%%' AND status = 'published'
              AND school_year = %s AND school != '' AND school != 'FirstLine Network'
            GROUP BY school ORDER BY submissions DESC
        """, (sy,))
        by_school = [dict(r) for r in cur.fetchall()]

        # YoY trend: total SR submissions per year
        cur.execute("""
            SELECT school_year, COUNT(*) AS n
            FROM touchpoints WHERE form_type LIKE 'self_reflection_%%' AND status = 'published'
            GROUP BY school_year ORDER BY school_year
        """)
        yearly = [dict(r) for r in cur.fetchall()]

        return jsonify({
            'school_year': sy,
            'by_role': by_role,
            'by_school': by_school,
            'yearly_trend': yearly,
        })
    finally:
        conn.close()


@app.route('/api/network/assignments-summary')
@require_auth
def api_network_assignments_summary():
    """Network-wide summary of action steps + goals for the dashboard."""
    user = get_current_user()
    if not DEV_MODE and not is_supervisor(user):
        return jsonify({'error': 'Access denied'}), 403
    sy = request.args.get('school_year', CURRENT_SCHOOL_YEAR)
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # Top-level counts
        cur.execute("""
            SELECT type,
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE progress_pct = 100) AS completed,
                   COUNT(*) FILTER (WHERE progress_pct > 0 AND progress_pct < 100) AS in_progress,
                   COUNT(*) FILTER (WHERE progress_pct = 0) AS not_started,
                   COUNT(DISTINCT teacher_email) AS unique_teachers
            FROM action_steps
            WHERE school_year = %s
            GROUP BY type ORDER BY total DESC
        """, (sy,))
        by_type = [dict(r) for r in cur.fetchall()]

        # By-school: how is each school doing on action step / goal completion?
        cur.execute("""
            SELECT s.school,
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE a.progress_pct = 100) AS completed,
                   COUNT(DISTINCT a.teacher_email) AS teachers_with_assignment
            FROM action_steps a
            JOIN staff s ON LOWER(s.email) = LOWER(a.teacher_email)
            WHERE a.school_year = %s
              AND s.school != '' AND s.school != 'FirstLine Network'
            GROUP BY s.school ORDER BY total DESC
        """, (sy,))
        by_school = [dict(r) for r in cur.fetchall()]

        return jsonify({
            'school_year': sy,
            'by_type': by_type,
            'by_school': by_school,
        })
    finally:
        conn.close()


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
# /api/touchpoint/<id>/full-detail
# Server-assembled PMAP detail for the click-into-modal view.
# Pulls from scores_v2 (5pt FLS rubric + 4pt Compass + Professionalism + Values
# kept distinct via measurement_group), narrative textBoxes from the in-memory
# Grow narrative cache, and goals from the goals table for the school_year.
# Layout branches by form_type + school_year on the frontend.
# ------------------------------------------------------------------
@app.route('/api/touchpoint/<tp_id>/full-detail')
@require_auth
def api_touchpoint_full_detail(tp_id):
    user = get_current_user()
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT t.id, t.form_type, t.school_year, t.school, t.observed_at,
                   t.observer_email, t.teacher_email, t.status, t.is_test,
                   t.notes, t.feedback, t.feedback_json, t.grow_id,
                   TRIM(CONCAT(obs.first_name, ' ', obs.last_name)) AS observer_name,
                   TRIM(CONCAT(tch.first_name, ' ', tch.last_name)) AS teacher_name
              FROM touchpoints t
              LEFT JOIN staff obs ON LOWER(obs.email) = LOWER(t.observer_email)
              LEFT JOIN staff tch ON LOWER(tch.email) = LOWER(t.teacher_email)
             WHERE t.id = %s
        """, (tp_id,))
        tp = cur.fetchone()
        if not tp:
            return jsonify({'error': 'Not found'}), 404

        # Auth gate — same rule as staff profile (admin / supervisor chain / self)
        if not DEV_MODE and not check_access(user, tp['teacher_email']):
            return jsonify({'authorized': False, 'error': 'Access denied'}), 200

        # 1. Scores from scores_v2, grouped by (measurement_group, dim_code, mid, cycle).
        # The cycle column is critical for PreK records where each PK1-PK10 dim
        # is observed 3 times (one per CLASS cycle). Group keeps cycles distinct.
        cur.execute("""
            SELECT measurement_group, dimension_code, measurement_id, cycle,
                   ROUND(AVG(score)::numeric, 2)::float AS score,
                   COUNT(*) AS n_rows
              FROM scores_v2
             WHERE touchpoint_id = %s
             GROUP BY measurement_group, dimension_code, measurement_id, cycle
             ORDER BY measurement_group, dimension_code, cycle
        """, (tp_id,))
        scores_rows = cur.fetchall()

        # 2. Narrative textBoxes from in-memory cache (keyed by grow_id).
        narrative_entries = GROW_NARRATIVE_CACHE.get(tp.get('grow_id') or '', [])

        # 3. Goals for this teacher + school_year (PMAP evaluates progress toward goals).
        goals = []
        if tp['form_type'].startswith('pmap_') and tp['school_year']:
            cur.execute("""
                SELECT id, goal_type, goal_text, status, approved_at, created_at
                  FROM goals
                 WHERE LOWER(teacher_email) = LOWER(%s) AND school_year = %s
                 ORDER BY CASE goal_type WHEN 'WIG' THEN 0 WHEN 'AG1' THEN 1
                                         WHEN 'AG2' THEN 2 WHEN 'AG3' THEN 3 ELSE 9 END
            """, (tp['teacher_email'], tp['school_year']))
            for g in cur.fetchall():
                goals.append({
                    'id': str(g['id']),
                    'goal_type': g['goal_type'],
                    'goal_text': g['goal_text'] or '',
                    'status': g['status'] or '',
                })

        # 4. Apply section-labels mapping. Each scores row + narrative entry gets
        # placed in one of: performance_review / rubric_5pt / compass_4pt /
        # professionalism / values / unknown.
        sections = {
            'performance_review': {'label': 'Teacher Performance Review',  'entries': []},
            'rubric_5pt':         {'label': "Leader's Rubric Scores For Teacher (5pt)",     'dims': []},
            'compass_4pt':        {'label': 'Compass Scores For Teacher (4pt — for state reporting)', 'dims': []},
            'professionalism':    {'label': 'Professionalism', 'entries': []},
            'values':             {'label': 'Values',          'entries': []},
            'unmapped':           {'label': 'Unmapped (legacy or unrecognized)', 'entries': []},
        }

        # Build lookups for narrative-prompt mid → dim (for 5pt rubric per-dim narrative).
        rubric_5pt_narrative_map = {k: v for k, v in (PMAP_SECTION_LABELS.get('rubric_5pt_narrative') or {}).items() if not k.startswith('_')}
        perf_review_map  = {k: v for k, v in (PMAP_SECTION_LABELS.get('performance_review') or {}).items() if not k.startswith('_')}
        compass_map      = {k: v for k, v in (PMAP_SECTION_LABELS.get('compass_4pt') or {}).items() if not k.startswith('_')}
        professional_map = {k: v for k, v in (PMAP_SECTION_LABELS.get('professionalism') or {}).items() if not k.startswith('_')}
        values_map       = {k: v for k, v in (PMAP_SECTION_LABELS.get('values') or {}).items() if not k.startswith('_')}

        # 4a. Performance Review narrative (no scores, just textBox content).
        for n in narrative_entries:
            mid = n.get('mid') or ''
            label = perf_review_map.get(mid)
            if label:
                sections['performance_review']['entries'].append({
                    'label': label,
                    'html': n.get('html') or '',
                })

        # 4b. 5pt Rubric — pair score (1 per dim) + per-dim narrative.
        # The score's dim_code already has a _5pt suffix; strip it for display.
        # Live-remap UNK_*_5pt rows by looking up the measurement_id in
        # GROW_MEASUREMENT_MAP — handles dim codes added to the map AFTER the
        # scores_v2 backfill ran.
        rubric_scores = {}
        for sr in scores_rows:
            dc = sr['dimension_code'] or ''
            if not dc.endswith('_5pt'):
                continue
            dim_code = dc[:-4]
            if dim_code.startswith('UNK_'):
                # Try live remap by measurement_id
                remapped = GROW_MEASUREMENT_MAP.get(sr['measurement_id'])
                if remapped:
                    dim_code = remapped
            rubric_scores[dim_code] = sr['score']

        # 4b-prek. PreK 7pt CLASS rubric — 3 cycles × PK1-PK10. Need cycle-
        # specific score retention since each cycle is observed separately.
        # cycle_scores: {1: {PK1: 5.0, ...}, 2: {...}, 3: {...}}
        cycle_scores = {1: {}, 2: {}, 3: {}}
        for sr in scores_rows:
            dc = sr['dimension_code'] or ''
            if not dc.endswith('_max7'):
                continue
            dim_code = dc[:-5]  # strip '_max7'
            cyc = sr.get('cycle')
            mid = sr['measurement_id']
            # If dim_code is UNK_*, try live-remap via measurement_id.
            # Also derive cycle from the map's rubric_key (cycle1/cycle2/cycle3)
            # since the original backfill couldn't determine cycle for UNK rows.
            if dim_code.startswith('UNK_'):
                remapped = GROW_MEASUREMENT_MAP.get(mid)
                if remapped:
                    dim_code = remapped
                if cyc is None:
                    cyc = GROW_MID_CYCLE_MAP.get(mid)
            if cyc and cyc in (1, 2, 3) and not dim_code.startswith('UNK_'):
                cycle_scores[cyc][dim_code] = sr['score']
        rubric_narrative = {}
        for n in narrative_entries:
            mid = n.get('mid') or ''
            dim = rubric_5pt_narrative_map.get(mid)
            if dim:
                rubric_narrative[dim] = n.get('html') or ''
        for dim in ['T1', 'T2', 'T3', 'T4', 'T5', 'L1', 'L2', 'L3', 'L4', 'L5']:
            if dim in rubric_scores or dim in rubric_narrative:
                sections['rubric_5pt']['dims'].append({
                    'dim': dim,
                    'score': rubric_scores.get(dim),
                    'narrative_html': rubric_narrative.get(dim, ''),
                })

        # 4c. 4pt Compass — score-only.
        compass_scores = {}
        for sr in scores_rows:
            dc = sr['dimension_code'] or ''
            if dc.endswith('_4pt'):
                compass_scores[dc[:-4]] = (sr['score'], sr['measurement_id'])
        for dim, (sc, mid) in compass_scores.items():
            sections['compass_4pt']['dims'].append({
                'dim': dim,
                'label': compass_map.get(mid, dim),
                'score': sc,
            })

        # 4d. Professionalism + Values — labeled scores, 1-3 scale.
        for sr in scores_rows:
            mid = sr['measurement_id'] or ''
            if mid in professional_map:
                sections['professionalism']['entries'].append({
                    'label': professional_map[mid],
                    'score': sr['score'],
                })
            elif mid in values_map:
                sections['values']['entries'].append({
                    'label': values_map[mid],
                    'score': sr['score'],
                })

        # 4e. Anything that didn't get placed — surface for transparency.
        placed_mids = set(perf_review_map) | set(rubric_5pt_narrative_map) | set(compass_map) | set(professional_map) | set(values_map)
        # Score-side: also tolerate the 5pt rubric score-mid pattern (we use measurement_group, not mid, for rubric scores).
        for sr in scores_rows:
            mid = sr['measurement_id'] or ''
            dc = sr['dimension_code'] or ''
            if dc.endswith('_5pt') or dc.endswith('_4pt'):
                continue  # already placed via group/dim
            if mid in placed_mids:
                continue  # already placed
            sections['unmapped']['entries'].append({
                'mid': mid,
                'measurement_group': str(sr['measurement_group']) if sr['measurement_group'] else None,
                'dim_code_raw': dc,
                'score': sr['score'],
            })

        # 5b. 25-26 archive form (Grow imports from 25-26 use same form template
        # for all teachers). Assemble fields by mid using grow_pmap_2526_form_labels.json.
        pmap_2526 = None
        narr_25_map = {k: v for k, v in (PMAP_2526_LABELS.get('narrative') or {}).items() if not k.startswith('_')}
        score_25_map = {k: v for k, v in (PMAP_2526_LABELS.get('scores') or {}).items() if not k.startswith('_')}
        chk_25_map = {k: v for k, v in (PMAP_2526_LABELS.get('checkboxes') or {}).items() if not k.startswith('_')}

        narrative_by_mid_25 = {n.get('mid'): n.get('html') for n in narrative_entries}
        score_by_mid_25 = {sr['measurement_id']: sr['score'] for sr in scores_rows}
        checkbox_by_mid_25 = {}
        # checkboxes are stored in feedback_json.checkboxes_selected
        try:
            fbj = tp.get('feedback_json') or {}
            if isinstance(fbj, str):
                fbj = json.loads(fbj)
            for c in (fbj.get('checkboxes_selected') or []):
                checkbox_by_mid_25[c.get('measurement')] = c.get('selected')
        except Exception:
            pass

        # Detect: does this record look like a 25-26 form? (has any 25-26 narrative mid)
        has_2526_mids = any(m in narr_25_map for m in narrative_by_mid_25.keys())
        is_pmap_or_sr = (tp['form_type'].startswith('pmap_') or tp['form_type'].startswith('self_reflection_'))
        if has_2526_mids and is_pmap_or_sr:
            fields = {}
            for mid, (key, label, placeholder) in narr_25_map.items():
                fields[key] = {
                    'label': label,
                    'placeholder': placeholder,
                    'kind': 'narrative',
                    'html': narrative_by_mid_25.get(mid, ''),
                }
            for mid, (key, label) in score_25_map.items():
                fields[key] = {
                    'label': label,
                    'kind': 'track',
                    'score': score_by_mid_25.get(mid),
                }
            for mid, (key, label) in chk_25_map.items():
                fields[key] = {
                    'label': label,
                    'kind': 'checkbox',
                    'selected': checkbox_by_mid_25.get(mid, ''),
                }
            # PreK gets 3-cycle CLASS data: PK1-PK10 dims with 1-7 score per cycle.
            prek_cycles = None
            if tp['form_type'] in ('pmap_prek', 'self_reflection_prek'):
                pk_dim_names = {
                    'PK1': 'Positive Climate (PC)',
                    'PK2': 'Negative Climate (NC)',
                    'PK3': 'Teacher Sensitivity (TS)',
                    'PK4': 'Regard for Student Perspectives (RSP)',
                    'PK5': 'Behavior Management (BM)',
                    'PK6': 'Productivity (PD)',
                    'PK7': 'Instructional Learning Formats (ILF)',
                    'PK8': 'Concept Development (CD)',
                    'PK9': 'Quality of Feedback (QF)',
                    'PK10': 'Language Modeling (LM)',
                }
                prek_cycles = []
                for cyc in [1, 2, 3]:
                    dims = []
                    for dim_key in ['PK1','PK2','PK3','PK4','PK5','PK6','PK7','PK8','PK9','PK10']:
                        sc = cycle_scores.get(cyc, {}).get(dim_key)
                        dims.append({'dim': dim_key, 'name': pk_dim_names.get(dim_key, dim_key), 'score': sc})
                    prek_cycles.append({'cycle': cyc, 'dims': dims})

            pmap_2526 = {
                'fields': fields,
                'section_order': PMAP_2526_LABELS.get('section_order', []),
                'rubric_5pt_dims': sections['rubric_5pt']['dims'],
                'prek_cycles': prek_cycles,
                'goals': goals,
            }

        # 5. Native OP feedback JSON (25-26+ records use the OP PMAP form which
        # stores structured fields directly: jobDescReviewed, wig_track, ag1_track,
        # whirlwind, strength_areas, growth_areas, personal_leadership_*,
        # commit_*, career_goals, licenses, concerns, concern_comments, etc.)
        # Try parsing both `feedback` (where the form posts) and `feedback_json`.
        op_feedback = None
        for src in [tp.get('feedback'), tp.get('feedback_json')]:
            if not src: continue
            if isinstance(src, dict):
                op_feedback = src; break
            try:
                parsed = json.loads(src) if isinstance(src, str) else None
                if isinstance(parsed, dict):
                    op_feedback = parsed; break
            except Exception:
                pass

        observed_at = tp['observed_at']
        return jsonify({
            'id': str(tp['id']),
            'form_type': tp['form_type'],
            'school_year': tp['school_year'],
            'school': tp['school'] or '',
            'observed_at': observed_at.isoformat() if observed_at else None,
            'date': observed_at.strftime('%Y-%m-%d') if observed_at else None,
            'observer_email': tp['observer_email'] or '',
            'observer_name': tp['observer_name'] or '',
            'teacher_email': tp['teacher_email'] or '',
            'teacher_name': tp['teacher_name'] or '',
            'status': tp['status'] or '',
            'is_test': bool(tp['is_test']),
            'grow_id': tp['grow_id'],
            'sections': sections,
            'goals': goals,
            'op_feedback': op_feedback,
            'pmap_2526': pmap_2526,
        })
    finally:
        conn.close()


# ------------------------------------------------------------------
# /api/staff/<email>/last-evaluation
# Returns the most recent PUBLISHED PMAP + most recent published SR for the
# subject email. Used by PMAP.jsx + SelfReflection.jsx to render a banner
# prompting the user to review prior context before completing a new form.
# Returns null fields when none exists yet.
# ------------------------------------------------------------------
# ------------------------------------------------------------------
# /api/network/drilldown
# Powers the section drill-down pages reached from Network comparison strips.
# Returns teacher-level (or step-level) rows for one of:
#   pmap | sr | action_step | fundamentals
# Optional ?school=<name> filter scopes to a single school.
# Output shape: { kind, school, school_year, rows: [...] }
# Each row has at least { name, email, school } plus kind-specific fields.
# ------------------------------------------------------------------
@app.route('/api/network/drilldown')
@require_auth
def api_network_drilldown():
    user = get_current_user()
    kind = (request.args.get('kind') or '').strip().lower()
    school = (request.args.get('school') or '').strip()
    sy = (request.args.get('school_year') or CURRENT_SCHOOL_YEAR).strip()
    if kind not in {'pmap', 'sr', 'evaluations', 'action_step', 'fundamentals', 'observations'}:
        return jsonify({'error': 'invalid kind'}), 400

    # ── Tier-based access (mirrors permissions.yaml) ────────────────────
    # Returns 200 with authorized:false + reason so the frontend renders a
    # friendly screen instead of a raw 403 (memory rule).
    if not DEV_MODE:
        scope = get_user_scope(user)
        tier = scope.get('tier')

        # Tier 1: only admin / content_lead / school_leader can hit drill-downs
        if tier not in {'admin', 'content_lead', 'school_leader'}:
            return jsonify({
                'authorized': False,
                'reason': 'role',
                'message': 'Network drill-downs are for school leadership.',
            }), 200

        # Tier 2: content_lead is excluded from personnel-review surfaces
        if tier == 'content_lead' and kind == 'evaluations':
            return jsonify({
                'authorized': False,
                'reason': 'capability',
                'message': 'Content Leads do not have access to PMAP / Self-Reflection records.',
            }), 200

        # Tier 3: school_leader is locked to their own school
        if tier == 'school_leader':
            own_school = scope.get('school') or ''
            if school and own_school and school.lower() != own_school.lower():
                return jsonify({
                    'authorized': False,
                    'reason': 'school',
                    'message': f"You can only view {own_school} data.",
                    'own_school': own_school,
                    'attempted_school': school,
                }), 200
            if not school and own_school:
                # Network-wide drill-down requested → silently scope to own school
                school = own_school
    # ────────────────────────────────────────────────────────────────────

    school_clause = " AND s.school = %s" if school else ""
    school_params = (school,) if school else ()

    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        rows = []

        if kind in ('pmap', 'sr'):
            # Teacher list with completion status for the form_type family.
            form_pattern = 'pmap_%' if kind == 'pmap' else 'self_reflection_%'
            sql = f"""
                SELECT s.email, s.first_name, s.last_name, s.school, s.job_title, s.job_function,
                       (SELECT MAX(t.observed_at)::date FROM touchpoints t
                          WHERE LOWER(t.teacher_email) = LOWER(s.email)
                            AND t.school_year = %s AND t.form_type LIKE %s
                            AND t.status = 'published' AND COALESCE(t.is_test, false) = false) AS last_date,
                       (SELECT t.observer_email FROM touchpoints t
                          WHERE LOWER(t.teacher_email) = LOWER(s.email)
                            AND t.school_year = %s AND t.form_type LIKE %s
                            AND t.status = 'published' AND COALESCE(t.is_test, false) = false
                          ORDER BY t.observed_at DESC LIMIT 1) AS last_observer_email,
                       (SELECT t.id FROM touchpoints t
                          WHERE LOWER(t.teacher_email) = LOWER(s.email)
                            AND t.school_year = %s AND t.form_type LIKE %s
                            AND t.status = 'published' AND COALESCE(t.is_test, false) = false
                          ORDER BY t.observed_at DESC LIMIT 1) AS last_tp_id
                  FROM staff s
                 WHERE s.is_active
                   AND s.school IS NOT NULL AND s.school <> '' AND s.school <> 'FirstLine Network'
                   AND s.school <> '(unknown)'
                   {school_clause}
                 ORDER BY (CASE WHEN (SELECT COUNT(*) FROM touchpoints t
                                       WHERE LOWER(t.teacher_email)=LOWER(s.email)
                                         AND t.school_year=%s AND t.form_type LIKE %s
                                         AND t.status='published') = 0 THEN 0 ELSE 1 END),
                          s.school, s.last_name, s.first_name
            """
            cur.execute(sql, (sy, form_pattern, sy, form_pattern, sy, form_pattern) + school_params + (sy, form_pattern))
            for r in cur.fetchall():
                rows.append({
                    'email': r['email'],
                    'name': f"{r['first_name'] or ''} {r['last_name'] or ''}".strip(),
                    'school': r['school'] or '',
                    'job_title': r['job_title'] or '',
                    'job_function': r['job_function'] or '',
                    'last_date': r['last_date'].strftime('%Y-%m-%d') if r['last_date'] else None,
                    'last_observer_email': r['last_observer_email'] or '',
                    'last_tp_id': str(r['last_tp_id']) if r['last_tp_id'] else None,
                    'completed': r['last_date'] is not None,
                })

        elif kind == 'evaluations':
            # One row per teacher with BOTH PMAP + SR statuses. Lets leaders
            # see who is missing what without bouncing between two pages.
            sql = f"""
                SELECT s.email, s.first_name, s.last_name, s.school, s.job_title, s.job_function,
                       (SELECT MAX(t.observed_at)::date FROM touchpoints t
                          WHERE LOWER(t.teacher_email)=LOWER(s.email)
                            AND t.school_year=%s AND t.form_type LIKE 'pmap_%%'
                            AND t.status='published' AND COALESCE(t.is_test,false)=false) AS pmap_date,
                       (SELECT t.id FROM touchpoints t
                          WHERE LOWER(t.teacher_email)=LOWER(s.email)
                            AND t.school_year=%s AND t.form_type LIKE 'pmap_%%'
                            AND t.status='published' AND COALESCE(t.is_test,false)=false
                          ORDER BY t.observed_at DESC LIMIT 1) AS pmap_tp_id,
                       (SELECT MAX(t.observed_at)::date FROM touchpoints t
                          WHERE LOWER(t.teacher_email)=LOWER(s.email)
                            AND t.school_year=%s AND t.form_type LIKE 'self_reflection_%%'
                            AND t.status='published' AND COALESCE(t.is_test,false)=false) AS sr_date,
                       (SELECT t.id FROM touchpoints t
                          WHERE LOWER(t.teacher_email)=LOWER(s.email)
                            AND t.school_year=%s AND t.form_type LIKE 'self_reflection_%%'
                            AND t.status='published' AND COALESCE(t.is_test,false)=false
                          ORDER BY t.observed_at DESC LIMIT 1) AS sr_tp_id
                  FROM staff s
                 WHERE s.is_active
                   AND s.school IS NOT NULL AND s.school <> '' AND s.school <> 'FirstLine Network'
                   AND s.school <> '(unknown)'
                   {school_clause}
                 ORDER BY s.school, s.last_name, s.first_name
            """
            cur.execute(sql, (sy, sy, sy, sy) + school_params)
            for r in cur.fetchall():
                rows.append({
                    'email': r['email'],
                    'name': f"{r['first_name'] or ''} {r['last_name'] or ''}".strip(),
                    'school': r['school'] or '',
                    'job_title': r['job_title'] or '',
                    'job_function': r['job_function'] or '',
                    'pmap_completed': r['pmap_date'] is not None,
                    'pmap_date': r['pmap_date'].strftime('%Y-%m-%d') if r['pmap_date'] else None,
                    'pmap_tp_id': str(r['pmap_tp_id']) if r['pmap_tp_id'] else None,
                    'sr_completed': r['sr_date'] is not None,
                    'sr_date': r['sr_date'].strftime('%Y-%m-%d') if r['sr_date'] else None,
                    'sr_tp_id': str(r['sr_tp_id']) if r['sr_tp_id'] else None,
                })

        elif kind == 'action_step':
            # Per-teacher rollup with state counts. Mirrors the PMAP/SR teacher-list
            # pattern so leaders see who has open work without scanning step bodies.
            # Sort: most Not-Mastered first, then most In-Progress — attention rises.
            sql = f"""
                SELECT s.email, s.first_name, s.last_name, s.school, s.job_title, s.job_function,
                       COUNT(a.id) AS total_steps,
                       COUNT(CASE WHEN a.progress_pct = 100 THEN 1 END) AS mastered,
                       COUNT(CASE WHEN (a.progress_pct IS NULL OR (a.progress_pct >= 0 AND a.progress_pct < 100)) AND a.id IS NOT NULL THEN 1 END) AS in_progress,
                       COUNT(CASE WHEN a.progress_pct < 0 THEN 1 END) AS not_mastered
                  FROM staff s
                  LEFT JOIN action_steps a ON LOWER(a.teacher_email) = LOWER(s.email)
                       AND a.school_year = %s AND a.type = 'actionStep'
                       AND COALESCE(a.is_test, false) = false
                 WHERE s.is_active
                   AND s.school IS NOT NULL AND s.school <> '' AND s.school <> 'FirstLine Network'
                   AND s.school <> '(unknown)'
                   {school_clause}
                 GROUP BY s.email, s.first_name, s.last_name, s.school, s.job_title, s.job_function
                 ORDER BY COUNT(CASE WHEN a.progress_pct < 0 THEN 1 END) DESC,
                          COUNT(CASE WHEN (a.progress_pct IS NULL OR (a.progress_pct >= 0 AND a.progress_pct < 100)) AND a.id IS NOT NULL THEN 1 END) DESC,
                          s.school, s.last_name, s.first_name
            """
            cur.execute(sql, (sy,) + school_params)
            for r in cur.fetchall():
                rows.append({
                    'email': r['email'],
                    'name': f"{r['first_name'] or ''} {r['last_name'] or ''}".strip(),
                    'school': r['school'] or '',
                    'job_title': r['job_title'] or '',
                    'job_function': r['job_function'] or '',
                    'total_steps': r['total_steps'] or 0,
                    'mastered': r['mastered'] or 0,
                    'in_progress': r['in_progress'] or 0,
                    'not_mastered': r['not_mastered'] or 0,
                })

        elif kind == 'observations':
            # Per-teacher observation rollup. Same scope db.py uses for the
            # network obs_score: form_type = 'observation_teacher' (PreK CLASS
            # observations live in the same form_type today).
            sql = f"""
                SELECT s.email, s.first_name, s.last_name, s.school, s.job_title, s.job_function,
                       (SELECT COUNT(DISTINCT t.id) FROM touchpoints t
                          WHERE LOWER(t.teacher_email)=LOWER(s.email)
                            AND t.school_year=%s AND t.form_type='observation_teacher'
                            AND t.status='published' AND COALESCE(t.is_test,false)=false) AS obs_count,
                       (SELECT MAX(t.observed_at)::date FROM touchpoints t
                          WHERE LOWER(t.teacher_email)=LOWER(s.email)
                            AND t.school_year=%s AND t.form_type='observation_teacher'
                            AND t.status='published' AND COALESCE(t.is_test,false)=false) AS last_obs,
                       (SELECT ROUND(AVG(sc.score)::numeric, 2)::float FROM scores sc
                          JOIN touchpoints t ON t.id = sc.touchpoint_id
                          WHERE LOWER(t.teacher_email)=LOWER(s.email)
                            AND t.school_year=%s AND t.form_type='observation_teacher'
                            AND t.status='published') AS avg_score
                  FROM staff s
                 WHERE s.is_active
                   AND s.school IS NOT NULL AND s.school <> '' AND s.school <> 'FirstLine Network'
                   AND s.school <> '(unknown)'
                   {school_clause}
                 ORDER BY (SELECT MAX(t.observed_at)::date FROM touchpoints t
                           WHERE LOWER(t.teacher_email)=LOWER(s.email)
                             AND t.school_year=%s AND t.form_type='observation_teacher'
                             AND t.status='published') DESC NULLS LAST,
                          s.school, s.last_name, s.first_name
            """
            cur.execute(sql, (sy, sy, sy) + school_params + (sy,))
            for r in cur.fetchall():
                rows.append({
                    'email': r['email'],
                    'name': f"{r['first_name'] or ''} {r['last_name'] or ''}".strip(),
                    'school': r['school'] or '',
                    'job_title': r['job_title'] or '',
                    'job_function': r['job_function'] or '',
                    'obs_count': r['obs_count'] or 0,
                    'last_obs': r['last_obs'].strftime('%Y-%m-%d') if r['last_obs'] else None,
                    'avg_score': r['avg_score'],
                })

        elif kind == 'fundamentals':
            # Sort recency-first: leaders care most about who was just walked.
            # NULL last_visit (no visits yet) sinks to the bottom.
            sql = f"""
                SELECT s.email, s.first_name, s.last_name, s.school, s.job_title,
                       (SELECT COUNT(DISTINCT t.id) FROM touchpoints t
                          WHERE LOWER(t.teacher_email) = LOWER(s.email)
                            AND t.school_year = %s AND t.form_type = 'observation_fundamentals'
                            AND t.status = 'published' AND COALESCE(t.is_test, false) = false) AS visits,
                       (SELECT MAX(t.observed_at)::date FROM touchpoints t
                          WHERE LOWER(t.teacher_email) = LOWER(s.email)
                            AND t.school_year = %s AND t.form_type = 'observation_fundamentals'
                            AND t.status = 'published' AND COALESCE(t.is_test, false) = false) AS last_visit,
                       (SELECT ROUND(AVG(sc.score)::numeric, 0)::int FROM scores sc
                          JOIN touchpoints t ON t.id = sc.touchpoint_id
                          WHERE LOWER(t.teacher_email) = LOWER(s.email)
                            AND t.school_year = %s AND t.form_type = 'observation_fundamentals'
                            AND sc.dimension_code = 'RB' AND t.status = 'published') AS rb_avg,
                       (SELECT BOOL_OR(t.locked_in) FROM touchpoints t
                          WHERE LOWER(t.teacher_email) = LOWER(s.email)
                            AND t.school_year = %s AND t.form_type = 'observation_fundamentals') AS locked_in
                  FROM staff s
                 WHERE s.is_active AND s.job_function = 'Teacher'
                   AND s.school IS NOT NULL AND s.school <> '' AND s.school <> 'FirstLine Network'
                   AND s.school <> '(unknown)'
                   {school_clause}
                 ORDER BY (SELECT MAX(t.observed_at)::date FROM touchpoints t
                           WHERE LOWER(t.teacher_email)=LOWER(s.email)
                             AND t.school_year=%s AND t.form_type='observation_fundamentals'
                             AND t.status='published') DESC NULLS LAST,
                          s.school, s.last_name, s.first_name
            """
            cur.execute(sql, (sy, sy, sy, sy) + school_params + (sy,))
            for r in cur.fetchall():
                rows.append({
                    'email': r['email'],
                    'name': f"{r['first_name'] or ''} {r['last_name'] or ''}".strip(),
                    'school': r['school'] or '',
                    'job_title': r['job_title'] or '',
                    'visits': r['visits'] or 0,
                    'last_visit': r['last_visit'].strftime('%Y-%m-%d') if r['last_visit'] else None,
                    'rb_avg': r['rb_avg'],
                    'locked_in': bool(r['locked_in']),
                })

        return jsonify({
            'kind': kind,
            'school': school or None,
            'school_year': sy,
            'rows': rows,
            'total': len(rows),
        })
    finally:
        conn.close()


@app.route('/api/staff/<email>/last-evaluation')
@require_auth
def api_staff_last_evaluation(email):
    user = get_current_user()
    if not DEV_MODE and not check_access(user, email):
        return jsonify({'authorized': False}), 200
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        out = {'email': email}
        for kind, pattern in [('pmap', 'pmap_%'), ('sr', 'self_reflection_%')]:
            cur.execute("""
                SELECT t.id, t.form_type, t.school_year, t.observed_at,
                       t.observer_email,
                       (SELECT first_name||' '||last_name FROM staff WHERE LOWER(email)=LOWER(t.observer_email)) AS observer_name
                  FROM touchpoints t
                 WHERE LOWER(t.teacher_email) = LOWER(%s)
                   AND t.form_type LIKE %s
                   AND t.status = 'published'
                   AND COALESCE(t.is_test, false) = false
                 ORDER BY t.observed_at DESC LIMIT 1
            """, (email, pattern))
            r = cur.fetchone()
            if r:
                out[kind] = {
                    'id': str(r['id']),
                    'form_type': r['form_type'],
                    'school_year': r['school_year'],
                    'date': r['observed_at'].strftime('%Y-%m-%d') if r['observed_at'] else None,
                    'observer_email': r['observer_email'] or '',
                    'observer_name': (r['observer_name'] or '').strip(),
                }
            else:
                out[kind] = None
        return jsonify(out)
    finally:
        conn.close()


@app.route('/api/staff/<email>/touchpoints/export.csv')
@require_auth
def api_staff_touchpoints_export(email):
    """Export all touchpoints for a teacher as CSV. Used by HR + supervisors
    for accountability + prior-year record retrieval. Honors check_access
    (admins see everyone, supervisors see their chain, self always allowed)."""
    user = get_current_user()
    if not DEV_MODE and not check_access(user, email):
        return jsonify({'error': 'Access denied'}), 403

    school_year = request.args.get('school_year', '').strip()  # blank = all years

    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if school_year and school_year.lower() != 'all':
            cur.execute("""
                SELECT t.id, t.form_type, t.school_year, t.status, t.observed_at,
                       t.observer_email, t.teacher_email, t.school, t.notes,
                       t.is_peer_recognition, t.is_test, t.locked_in,
                       (SELECT first_name || ' ' || last_name FROM staff WHERE LOWER(email)=LOWER(t.observer_email)) AS observer_name,
                       (SELECT first_name || ' ' || last_name FROM staff WHERE LOWER(email)=LOWER(t.teacher_email)) AS teacher_name
                FROM touchpoints t
                WHERE LOWER(t.teacher_email)=LOWER(%s) AND t.school_year=%s
                  AND t.status='published'
                ORDER BY t.observed_at DESC
            """, (email, school_year))
        else:
            cur.execute("""
                SELECT t.id, t.form_type, t.school_year, t.status, t.observed_at,
                       t.observer_email, t.teacher_email, t.school, t.notes,
                       t.is_peer_recognition, t.is_test, t.locked_in,
                       (SELECT first_name || ' ' || last_name FROM staff WHERE LOWER(email)=LOWER(t.observer_email)) AS observer_name,
                       (SELECT first_name || ' ' || last_name FROM staff WHERE LOWER(email)=LOWER(t.teacher_email)) AS teacher_name
                FROM touchpoints t
                WHERE LOWER(t.teacher_email)=LOWER(%s)
                  AND t.status='published'
                ORDER BY t.school_year DESC, t.observed_at DESC
            """, (email,))
        rows = cur.fetchall()

        # Pull scores per touchpoint and bundle into a single column.
        # Avg multi-row scores per (touchpoint, dim) — covers PreK 3-cycle
        # and 24-25 rubric+compass collisions.
        tp_ids = [str(r['id']) for r in rows]
        scores_by_tp = {}
        if tp_ids:
            cur.execute("""
                SELECT touchpoint_id, dimension_code,
                       ROUND(AVG(score)::numeric, 2)::float AS score
                FROM scores
                WHERE touchpoint_id = ANY(%s::uuid[])
                GROUP BY touchpoint_id, dimension_code
            """, (tp_ids,))
            for s in cur.fetchall():
                scores_by_tp.setdefault(s['touchpoint_id'], []).append(
                    f"{s['dimension_code']}={s['score']}"
                )

        import csv, io
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            'date', 'form_type', 'school_year', 'school',
            'observer', 'observer_email', 'teacher', 'teacher_email',
            'notes', 'scores',
            'is_peer_recognition', 'is_test', 'locked_in', 'touchpoint_id',
        ])
        for r in rows:
            writer.writerow([
                r['observed_at'].strftime('%Y-%m-%d') if r['observed_at'] else '',
                r['form_type'] or '',
                r['school_year'] or '',
                r['school'] or '',
                (r['observer_name'] or '').strip() or '',
                r['observer_email'] or '',
                (r['teacher_name'] or '').strip() or '',
                r['teacher_email'] or '',
                (r['notes'] or '').replace('\n', ' / ').replace('\r', ''),
                ' '.join(scores_by_tp.get(r['id'], [])),
                r['is_peer_recognition'] if r['is_peer_recognition'] is not None else '',
                r['is_test'] if r['is_test'] is not None else '',
                r['locked_in'] if r['locked_in'] is not None else '',
                str(r['id']),
            ])
        csv_bytes = buf.getvalue()

        # Build a sensible filename
        teacher_slug = email.replace('@', '_at_').replace('.', '_')
        year_part = school_year if (school_year and school_year.lower() != 'all') else 'all-years'
        filename = f"touchpoints_{teacher_slug}_{year_part}.csv"

        return csv_bytes, 200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': f'attachment; filename="{filename}"',
        }
    finally:
        conn.close()


# ------------------------------------------------------------------
# API: Network Dashboard
# ------------------------------------------------------------------

@app.route('/api/network')
@require_auth
def api_network():
    user = get_current_user()
    if not DEV_MODE:
        scope = get_user_scope(user)
        # Network landing is for admin / content_lead / school_leader.
        # Supervisors and self-only roles get a friendly screen.
        if scope.get('tier') not in {'admin', 'content_lead', 'school_leader'}:
            return jsonify({
                'authorized': False,
                'reason': 'role',
                'message': 'The Network page is for school leaders, content leads, and HR.',
            }), 200
    sy = request.args.get('school_year', CURRENT_SCHOOL_YEAR)
    cycle = request.args.get('cycle')
    try:
        cycle = int(cycle) if cycle else None
    except ValueError:
        cycle = None
    return jsonify(db.get_network_dashboard(school_year=sy, cycle=cycle))


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

@app.route('/api/touchpoints/active-draft')
@require_auth
def api_active_draft():
    """Draft paradigm — one coach + one teacher + one form type = one draft.
    Returns the coach's active draft for (teacher_email, form_type) if one exists, else null."""
    user = get_current_user()
    observer = user['email'] if user else DEV_USER_EMAIL
    teacher_email = request.args.get('teacher_email', '').strip()
    form_type = request.args.get('form_type', '').strip()
    if not teacher_email or not form_type:
        return jsonify({'error': 'teacher_email and form_type required'}), 400
    draft = db.find_active_draft(observer, teacher_email, form_type)
    return jsonify(draft)


@app.route('/api/touchpoints/<tp_id>', methods=['PUT'])
@require_auth
@require_no_impersonation
def api_update_touchpoint(tp_id):
    """Auto-save target. Only the original observer can edit their own touchpoint."""
    user = get_current_user()
    observer = user['email'] if user else DEV_USER_EMAIL
    data = request.get_json() or {}
    # Role gate on HR doc + PMAP updates — return 200 with authorized:false
    # so the frontend can render a friendly screen instead of a raw 403.
    if data.get('form_type') in HR_DOC_FORM_TYPES and not _can_file_hr_doc(user):
        return jsonify({'authorized': False, 'reason': 'role', 'message': 'PIPs and Write-Ups can only be filed by school leadership, network staff, or HR.'})
    if (data.get('form_type') or '').startswith(PMAP_FORM_TYPE_PREFIX) and not _can_file_pmap(user):
        return jsonify({'authorized': False, 'reason': 'role', 'message': 'PMAPs can only be filed by supervisors and HR.'})
    try:
        db.update_touchpoint(tp_id, observer, data)
        return jsonify({'id': tp_id})
    except PermissionError as e:
        return jsonify({'error': str(e)}), 403
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Email helpers — FLS standard (navy header, white card, Open Sans)
# ------------------------------------------------------------------
SMTP_EMAIL = os.environ.get('SMTP_EMAIL', 'sshirey@firstlineschools.org')
SMTP_PASSWORD = os.environ.get('SMTP_PASSWORD', '')
SMTP_SERVER = 'smtp.gmail.com'
SMTP_PORT = 587
TALENT_EMAIL = 'talent@firstlineschools.org'
HR_EMAIL = 'hr@firstlineschools.org'


def _send_email(to_email, subject, html_body, cc_emails=None):
    """FLS standard Gmail SMTP send. Returns True on success."""
    if not SMTP_PASSWORD:
        log.warning('SMTP_PASSWORD not configured; skipping send')
        return False
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = f'ObservationPoint <{SMTP_EMAIL}>'
        msg['To'] = to_email
        if cc_emails:
            msg['Cc'] = ', '.join(cc_emails)
        msg.attach(MIMEText(html_body, 'html'))
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_PASSWORD)
            recipients = [to_email] + (cc_emails or [])
            server.sendmail(SMTP_EMAIL, recipients, msg.as_string())
        log.info(f'Email sent to {to_email}: {subject}')
        return True
    except Exception as e:
        log.error(f'Email send failed: {e}')
        return False


def _fundamentals_email_html(teacher, observer, tp_row, action_steps, skills_text):
    """FLS-standard email template for a Fundamentals observation notification."""
    teacher_first = (teacher.get('first_name') or teacher.get('email', '').split('@')[0]).strip()
    observer_name = (observer.get('name') or '').strip() or f"{observer.get('first_name','')} {observer.get('last_name','')}".strip() or observer.get('email','')
    observed_at = tp_row.get('observed_at')
    obs_date = observed_at.strftime('%B %-d, %Y') if observed_at else ''
    scores = tp_row.get('scores') or {}
    mvals = [scores.get(f'M{i}') for i in range(1, 6) if scores.get(f'M{i}') is not None]
    avg_pct = round(sum(mvals) / len(mvals)) if mvals else None
    qualifies = avg_pct is not None and avg_pct >= 90

    badge_color = '#22c55e' if qualifies else '#e47727'
    badge_text = '✓ Qualifies toward mastery' if qualifies else 'Keep building'

    steps_html = ''
    if action_steps:
        steps_html = '<div style="margin-top:16px;padding-top:16px;border-top:1px solid #e5e7eb"><div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:8px">Action Steps to Focus On</div>'
        for s in action_steps:
            steps_html += f'<div style="padding:10px 12px;background:#fff7ed;border-left:3px solid #e47727;border-radius:6px;margin-bottom:6px;font-size:14px;color:#111827"><strong>{s.get("cat","")}</strong> · {s.get("action","")}</div>'
        steps_html += '</div>'

    skills_html = ''
    if skills_text:
        skills_html = f'<div style="margin-top:16px;padding-top:16px;border-top:1px solid #e5e7eb"><div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:8px">Notes from the observation</div><div style="font-size:14px;color:#374151;line-height:1.5;font-style:italic">{skills_text}</div></div>'

    app_url = 'https://observationpoint-965913991496.us-central1.run.app'

    return f'''<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8f9fa;font-family:'Open Sans',Arial,sans-serif">
  <div style="background:#002f60;padding:24px 16px;text-align:center">
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">New Fundamentals Observation</h1>
  </div>
  <div style="padding:28px 16px;max-width:600px;margin:0 auto">
    <p style="font-size:16px;color:#111827;margin:0 0 16px">Hi {teacher_first},</p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 20px">{observer_name} published a Fundamentals observation from {obs_date}.</p>
    <div style="background:#fff;border-radius:8px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
      <div style="text-align:center;padding:10px 16px;background:{badge_color};color:#fff;border-radius:20px;font-size:13px;font-weight:700;margin-bottom:16px;display:inline-block">{badge_text}</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse">
        <tr>
          <td style="color:#6b7280;padding:8px 0;border-bottom:1px solid #f3f4f6">Average on-task</td>
          <td style="color:#002f60;font-weight:700;padding:8px 0;border-bottom:1px solid #f3f4f6;text-align:right">{avg_pct if avg_pct is not None else '—'}%</td>
        </tr>
      </table>
      {steps_html}
      {skills_html}
    </div>
    <div style="text-align:center;margin-top:24px">
      <a href="{app_url}/app/staff/{teacher.get("email","")}" style="display:inline-block;background:#e47727;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">View your full profile</a>
    </div>
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px">Questions? Contact talent@firstlineschools.org</p>
  </div>
  <div style="background:#002f60;padding:12px;text-align:center"><div style="color:rgba(255,255,255,.7);font-size:11px">FirstLine Schools — Education For Life</div></div>
</body></html>'''


def _celebrate_email_html(teacher, observer, tp_row, commitments, personal_note):
    """FLS-standard celebration email — orange gradient hero, quote card, commitments, CTA."""
    teacher_first = (teacher.get('first_name') or teacher.get('email', '').split('@')[0]).strip()
    observer_name = (observer.get('name') or '').strip() or f"{observer.get('first_name','')} {observer.get('last_name','')}".strip() or observer.get('email','')
    note_text = (tp_row.get('notes') or '').strip()

    commitments_html = ''
    if commitments:
        chips = ''.join(
            f'<span style="display:inline-block;background:#fff7ed;color:#e47727;padding:6px 12px;border-radius:16px;font-size:12px;font-weight:700;margin-right:6px;margin-bottom:6px">{c}</span>'
            for c in commitments
        )
        commitments_html = f'''
        <div style="margin-bottom:18px">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:8px">Reflects our commitments</div>
          <div>{chips}</div>
        </div>'''

    pn_html = ''
    if personal_note and personal_note.strip():
        pn_html = f'''
        <div style="background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;padding:16px;margin-bottom:22px">
          <div style="font-size:11px;color:#15803d;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:6px">A personal note from {observer_name.split()[0] if observer_name else 'your coach'}</div>
          <div style="font-size:14px;color:#111827;line-height:1.6;font-style:italic">{personal_note}</div>
        </div>'''

    app_url = 'https://observationpoint-965913991496.us-central1.run.app'
    return f'''<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8f9fa;font-family:'Open Sans',Arial,sans-serif">
  <div style="background:linear-gradient(135deg,#e47727 0%,#f59e0b 100%);padding:40px 24px 32px;text-align:center">
    <div style="font-size:44px;line-height:1;margin-bottom:12px">🎉</div>
    <h1 style="margin:0;color:#fff;font-size:26px;font-weight:800;letter-spacing:-.01em">You've been celebrated!</h1>
    <div style="margin-top:8px;color:rgba(255,255,255,.95);font-size:14px;font-weight:600">by {observer_name}</div>
  </div>
  <div style="padding:28px 20px 4px;max-width:600px;margin:0 auto">
    <div style="font-size:18px;color:#111827;margin:0 0 20px;font-weight:600">Hey {teacher_first} —</div>
    <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,.06);position:relative;margin-bottom:18px">
      <div style="position:absolute;top:-10px;left:16px;background:#e47727;color:#fff;padding:4px 12px;border-radius:12px;font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase">What {observer_name.split()[0] if observer_name else 'your coach'} saw</div>
      <div style="padding-top:6px;font-size:16px;color:#111827;line-height:1.6">{note_text or '(no note provided)'}</div>
    </div>
    {commitments_html}
    {pn_html}
    <div style="text-align:center;margin:28px 0 20px">
      <a href="{app_url}/app/staff/{teacher.get("email","")}" style="display:inline-block;background:#002f60;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">See your full profile →</a>
    </div>
    <div style="font-size:12px;color:#6b7280;text-align:center;margin-top:20px">Recognition captured by ObservationPoint<br>Questions? talent@firstlineschools.org</div>
  </div>
  <div style="background:#002f60;padding:16px;text-align:center">
    <div style="color:rgba(255,255,255,.85);font-size:12px;font-weight:700">FirstLine Schools</div>
    <div style="color:rgba(255,255,255,.6);font-size:10px;margin-top:4px">Education For Life</div>
  </div>
</body></html>'''


def _generic_touchpoint_email_html(form_label, teacher, observer, tp_row):
    """Generic email for any non-celebrate, non-HR-doc, non-fundamentals touchpoint.
    Used for observations, PMAPs, meetings, SR, QF, SF."""
    teacher_first = (teacher.get('first_name') or teacher.get('email', '').split('@')[0]).strip()
    observer_name = (observer.get('name') or '').strip() or observer.get('email', '')
    notes_text = (tp_row.get('notes') or '').strip()
    app_url = 'https://observationpoint-965913991496.us-central1.run.app'
    notes_block = ''
    if notes_text:
        notes_block = f'''
        <div style="background:#fff;border-radius:10px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-bottom:18px">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:8px">Notes</div>
          <div style="font-size:14px;color:#111827;line-height:1.6;white-space:pre-wrap">{notes_text}</div>
        </div>'''
    return f'''<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8f9fa;font-family:'Open Sans',Arial,sans-serif">
  <div style="background:#002f60;padding:28px 22px;text-align:center">
    <div style="color:rgba(255,255,255,.85);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em">{form_label}</div>
    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800">From {observer_name}</h1>
  </div>
  <div style="padding:24px 22px;max-width:600px;margin:0 auto">
    <div style="font-size:16px;color:#111827;margin:0 0 18px;font-weight:600">Hi {teacher_first},</div>
    <div style="font-size:14px;color:#374151;line-height:1.6;margin-bottom:18px">
      You have a new <b>{form_label.lower()}</b> from {observer_name}. View the full record in ObservationPoint.
    </div>
    {notes_block}
    <div style="text-align:center;margin:24px 0">
      <a href="{app_url}/app/staff/{teacher.get("email","")}" style="display:inline-block;background:#e47727;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">View in ObservationPoint</a>
    </div>
    <div style="font-size:12px;color:#6b7280;text-align:center;margin-top:18px">Questions? Contact talent@firstlineschools.org</div>
  </div>
  <div style="background:#002f60;padding:14px;text-align:center">
    <div style="color:rgba(255,255,255,.85);font-size:12px;font-weight:700">FirstLine Schools</div>
  </div>
</body></html>'''


def _hr_doc_email_html(doc_label, teacher, observer, tp_row, ack_url, summary_bullets):
    """Email for a formal HR doc (PIP / Write-Up). Red accents, ack CTA."""
    teacher_first = (teacher.get('first_name') or teacher.get('email', '').split('@')[0]).strip()
    observer_name = (observer.get('name') or '').strip() or f"{observer.get('first_name','')} {observer.get('last_name','')}".strip() or observer.get('email','')
    bullets_html = ''.join(
        f'<li style="margin-bottom:6px"><b style="color:#111827">{b.get("label","")}:</b> <span style="color:#374151">{b.get("value","")}</span></li>'
        for b in summary_bullets if b.get('value')
    )
    return f'''<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8f9fa;font-family:'Open Sans',Arial,sans-serif">
  <div style="background:#dc2626;padding:32px 24px;text-align:center">
    <div style="color:#fff;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;opacity:.9">Formal HR Document</div>
    <h1 style="margin:8px 0 0;color:#fff;font-size:22px;font-weight:800">{doc_label}</h1>
    <div style="margin-top:6px;color:rgba(255,255,255,.9);font-size:13px">Issued by {observer_name}</div>
  </div>
  <div style="padding:28px 20px;max-width:600px;margin:0 auto">
    <div style="font-size:16px;color:#111827;margin:0 0 14px;font-weight:600">Hi {teacher_first},</div>
    <div style="font-size:14px;color:#374151;line-height:1.6;margin-bottom:18px">
      You have been issued a <b>{doc_label}</b>. This is a formal document that will be stored in your employment record. Please review it and acknowledge receipt using the button below.
    </div>
    {f'<div style="background:#fff;border-radius:10px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-bottom:18px"><div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:10px">Summary</div><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5">{bullets_html}</ul></div>' if bullets_html else ''}
    <div style="text-align:center;margin:24px 0">
      <a href="{ack_url}" style="display:inline-block;background:#002f60;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Review &amp; Acknowledge</a>
    </div>
    <div style="font-size:12px;color:#6b7280;line-height:1.5;margin-top:18px">
      Acknowledging this document confirms you have received it. It does not imply agreement with the content.
      If you have questions, contact your supervisor or talent@firstlineschools.org.
    </div>
  </div>
  <div style="background:#002f60;padding:16px;text-align:center">
    <div style="color:rgba(255,255,255,.85);font-size:12px;font-weight:700">FirstLine Schools</div>
    <div style="color:rgba(255,255,255,.6);font-size:10px;margin-top:4px">Education For Life</div>
  </div>
</body></html>'''


def _solicit_request_email_html(subject_email, subject_first, requestor_name, questions, context, response_url=None, mode='email'):
    """Email subject receives when someone requests their feedback.
    mode='email' → CTA button to response page.
    mode='in_person' → no CTA; pure thank-you note since responses already captured."""
    name = (subject_first or subject_email.split('@')[0]).strip()
    q_html = ''.join(f'<li style="margin-bottom:6px;color:#374151">{q}</li>' for q in (questions or []))
    if mode == 'in_person':
        body = f'''<p style="margin:0 0 14px;font-size:14px;color:#374151">Hi {name},</p>
<p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.55">Thank you for taking the time to share honest feedback with {requestor_name} today. Your perspective is what makes our coaching better — we appreciate it.</p>'''
        cta = ''
    else:
        body = f'''<p style="margin:0 0 14px;font-size:14px;color:#374151">Hi {name},</p>
<p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.55">{requestor_name} would like your honest feedback. They've asked you to share your thoughts on:</p>
<ul style="margin:0 0 14px 20px;font-size:13px;line-height:1.6">{q_html}</ul>
{f'<div style="background:#f9fafb;border-left:3px solid #002f60;padding:10px 12px;margin-bottom:18px;font-size:13px;color:#374151;font-style:italic;line-height:1.5">{context}</div>' if context else ''}
<p style="margin:0 0 14px;font-size:13px;color:#6b7280;line-height:1.5">Take a few minutes when you can. Your responses are shared only with {requestor_name} and admins.</p>'''
        cta = f'''<div style="text-align:center;margin:24px 0">
  <a href="{response_url}" style="display:inline-block;background:#002f60;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Share your feedback →</a>
</div>'''
    return f'''<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8f9fa;font-family:'Open Sans',Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff">
    <div style="background:#002f60;padding:20px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:18px;font-weight:800">{'Thank you' if mode == 'in_person' else 'Feedback request'}</h1>
    </div>
    <div style="padding:24px">
      {body}
      {cta}
    </div>
    <div style="background:#f8f9fa;padding:14px 24px;font-size:11px;color:#6b7280">
      Questions? Contact <a href="mailto:talent@firstlineschools.org" style="color:#002f60">talent@firstlineschools.org</a>
    </div>
    <div style="background:#002f60;color:rgba(255,255,255,.7);padding:10px;text-align:center;font-size:10px">FirstLine Schools — Education For Life</div>
  </div>
</body></html>'''


@app.route('/api/touchpoints/<tp_id>/notify', methods=['POST'])
@require_auth
@require_no_impersonation
def api_notify_teacher(tp_id):
    """Send the Fundamentals observation to the teacher's inbox + mark notified_at.
    Only the original observer can trigger this, only on a published obs."""
    user = get_current_user()
    observer_email = user['email'] if user else DEV_USER_EMAIL
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT t.*, s.first_name AS teacher_first, s.last_name AS teacher_last
            FROM touchpoints t LEFT JOIN staff s ON LOWER(s.email) = LOWER(t.teacher_email)
            WHERE t.id = %s
        """, (tp_id,))
        tp = cur.fetchone()
        if not tp:
            return jsonify({'error': 'not found'}), 404
        if tp['observer_email'].lower() != observer_email.lower():
            return jsonify({'error': 'not your touchpoint'}), 403
        if tp['status'] != 'published':
            return jsonify({'error': 'only published obs can be sent'}), 400

        # Gather scores for this touchpoint
        cur.execute('SELECT dimension_code, score FROM scores WHERE touchpoint_id = %s', (tp_id,))
        scores = {r['dimension_code']: float(r['score']) for r in cur.fetchall()}
        tp_dict = dict(tp); tp_dict['scores'] = scores

        teacher = {'email': tp['teacher_email'], 'first_name': tp['teacher_first'], 'last_name': tp['teacher_last']}
        observer = user or {'email': observer_email}

        # Branch on form_type — pick the right email template
        fb = {}
        try:
            if tp.get('feedback'):
                fb = json.loads(tp['feedback']) if isinstance(tp['feedback'], str) else tp['feedback']
        except (ValueError, TypeError):
            fb = {}

        form_type = tp.get('form_type', '')
        observer_name = (observer.get('name') or '').strip() or f"{observer.get('first_name','')} {observer.get('last_name','')}".strip() or observer.get('email','')

        # Map form_type → human-readable label for subject + email body
        FORM_LABELS = {
            'observation_teacher': 'Teacher Observation',
            'observation_prek': 'PreK Observation',
            'observation_fundamentals': 'Fundamentals Observation',
            'pmap_teacher': 'PMAP — Teacher',
            'pmap_prek': 'PMAP — PreK',
            'pmap_leader': 'PMAP — Leader',
            'pmap_network': 'PMAP — Network',
            'pmap_support': 'PMAP — Support',
            'self_reflection_teacher': 'Self-Reflection',
            'self_reflection_prek': 'Self-Reflection (PreK)',
            'self_reflection_leader': 'Self-Reflection (Leader)',
            'self_reflection_network': 'Self-Reflection (Network)',
            'self_reflection_support': 'Self-Reflection (Support)',
            'meeting_data_meeting_(relay)': 'Data Meeting',
            'meeting_quick_meeting': 'Quick Meeting',
            'quick_feedback': 'Quick Feedback',
            'solicited_feedback': 'Feedback Request',
        }
        form_label = FORM_LABELS.get(form_type, form_type.replace('_', ' ').title())

        if form_type == 'celebrate':
            commitments = fb.get('commitments') or []
            personal_note = fb.get('personal_note') or ''
            # Recognition v2 — type-specific subject line
            rtype = (fb.get('recognition_type') or 'celebration').lower()
            type_meta = {
                'celebration': ('🎉', 'Celebration'),
                'shoutout':    ('👏', 'Shoutout'),
                'gratitude':   ('🙏', 'Gratitude'),
            }.get(rtype, ('🎉', 'Celebration'))
            # If commitment_theme provided (v2), pass as single-item commitments list
            if fb.get('commitment_theme') and not commitments:
                commitments = [fb.get('commitment_theme')]
            html = _celebrate_email_html(teacher, observer, tp_dict, commitments, personal_note)
            subject = f"{type_meta[0]} {type_meta[1]} from {observer_name}"
        elif form_type in ('performance_improvement_plan', 'iap', 'write_up') or form_type.startswith('pmap_'):
            # Generate an ack token if missing
            ack_token = tp.get('acknowledgment_token')
            if not ack_token:
                import secrets as _sec
                ack_token = _sec.token_urlsafe(24)
                cur.execute("UPDATE touchpoints SET acknowledgment_token = %s WHERE id = %s", (ack_token, tp_id))
                conn.commit()

            app_url = 'https://observationpoint-965913991496.us-central1.run.app'
            ack_url = f'{app_url}/acknowledge/{ack_token}'

            if form_type == 'write_up':
                doc_label = 'Write-Up'
                summary_bullets = [
                    {'label': 'Type', 'value': fb.get('warning_type') or ''},
                    {'label': 'Category', 'value': ', '.join(fb.get('categories') or [])},
                    {'label': 'Date of Incident', 'value': fb.get('incident_date') or ''},
                ]
            elif form_type.startswith('pmap_'):
                doc_label = FORM_LABELS.get(form_type, 'PMAP')
                # Concerns is the only narrative bullet meaningful at email-glance.
                concerns_list = fb.get('concerns') or []
                summary_bullets = [
                    {'label': 'Cycle', 'value': str(tp.get('cycle') or '—')},
                ]
                if concerns_list:
                    summary_bullets.append({'label': 'Areas of Concern', 'value': ', '.join(concerns_list)})
            else:
                doc_label = 'Performance Improvement Plan'
                summary_bullets = [
                    {'label': 'Area(s) of Concern', 'value': ', '.join(fb.get('concerns') or [])},
                    {'label': 'Start Date', 'value': fb.get('start_date') or ''},
                    {'label': 'Review Date', 'value': fb.get('review_date') or ''},
                ]
            html = _hr_doc_email_html(doc_label, teacher, observer, tp_dict, ack_url, summary_bullets)
            # PMAP framing is "review your evaluation" not "action required"
            if form_type.startswith('pmap_'):
                subject = f'Acknowledge your {doc_label} from {observer_name}'
            else:
                subject = f'Action required: {doc_label} from {observer_name}'
        elif form_type == 'observation_fundamentals':
            cur.execute("""SELECT body_text FROM action_steps
                           WHERE observation_grow_id::text = %s AND type = 'actionStep'""", (str(tp_id),))
            action_steps = [{'cat': '', 'action': r['body_text']} for r in cur.fetchall()]
            html = _fundamentals_email_html(teacher, observer, tp_dict, action_steps, tp.get('notes', '') or '')
            subject = f'New Fundamentals observation from {observer_name}'
        elif form_type == 'solicited_feedback':
            # Email mode: subject gets a secure response link.
            # In-person mode: subject just gets a thank-you (responses already captured).
            mode = (fb.get('mode') or 'email').lower()
            ack_token = tp.get('acknowledgment_token')
            if mode == 'email' and not ack_token:
                import secrets as _sec
                ack_token = _sec.token_urlsafe(24)
                cur.execute("UPDATE touchpoints SET acknowledgment_token = %s WHERE id = %s", (ack_token, tp_id))
                conn.commit()
            app_url = 'https://observationpoint-965913991496.us-central1.run.app'
            response_url = f'{app_url}/respond/{ack_token}' if ack_token else None
            html = _solicit_request_email_html(
                tp['teacher_email'], tp.get('teacher_first') or '', observer_name,
                fb.get('questions') or [], fb.get('context') or '',
                response_url=response_url, mode=mode,
            )
            subject = f'Feedback request from {observer_name}' if mode == 'email' else 'Thanks for your feedback today'
        else:
            # Generic touchpoint email — observation, PMAP, meeting, SR, QF
            html = _generic_touchpoint_email_html(form_label, teacher, observer, tp_dict)
            subject = f'New {form_label} from {observer_name}'

        # ── Per-form recipient + CC logic ──────────────────────────────
        # cc_self: opt-in flag from the form's "Send me a copy" checkbox.
        cc_self = bool(fb.get('cc_self'))

        if tp.get('is_test'):
            # Test-mode safety: never reach real teacher. Always to observer.
            recipient = observer_email
            cc = []
            subject = '[TEST · would go to teacher] ' + subject
            ok = _send_email(recipient, subject, html, cc_emails=cc)

        elif form_type == 'solicited_feedback':
            # Single email to subject. Response capture (gratitude + summary)
            # fires from /api/feedback-respond/<token> when subject submits.
            recipient = tp['teacher_email']
            cc = []
            ok = _send_email(recipient, subject, html, cc_emails=cc)

        elif form_type.startswith('self_reflection'):
            # SR: recipient = SUBMITTER's supervisor (not the submitter themselves).
            # Submitter can opt-in to receive a self copy.
            cur.execute("SELECT supervisor_email FROM staff WHERE LOWER(email) = LOWER(%s)", (observer_email,))
            sup_row = cur.fetchone()
            sup_email = (sup_row and sup_row.get('supervisor_email')) or TALENT_EMAIL
            recipient = sup_email
            cc = [observer_email] if cc_self else []
            ok = _send_email(recipient, subject, html, cc_emails=cc)

        elif form_type in ('performance_improvement_plan', 'iap', 'write_up'):
            # PIP / Write-Up: teacher + mandatory hr@ cc. Submitter opt-in.
            recipient = tp['teacher_email']
            cc = [HR_EMAIL]
            if cc_self and observer_email and observer_email.lower() != tp['teacher_email'].lower():
                cc.append(observer_email)
            ok = _send_email(recipient, subject, html, cc_emails=cc)

        else:
            # Default (Observe, QF, Celebrate, Fundamentals, Meeting, QM, PMAP):
            # recipient = teacher; submitter opt-in for self-CC.
            recipient = tp['teacher_email']
            cc = [observer_email] if (cc_self and observer_email and observer_email.lower() != tp['teacher_email'].lower()) else []
            ok = _send_email(recipient, subject, html, cc_emails=cc)
        # ───────────────────────────────────────────────────────────────
        if ok:
            cur.execute("UPDATE touchpoints SET notified_at = NOW() WHERE id = %s", (tp_id,))
            conn.commit()
            return jsonify({'sent': True, 'to': tp['teacher_email']})
        return jsonify({'error': 'email send failed'}), 500
    finally:
        conn.close()


# ------------------------------------------------------------------
# Tester feedback — small endpoint for the in-app FeedbackButton
# ------------------------------------------------------------------
@app.route('/api/feedback', methods=['POST'])
@require_auth
def api_feedback():
    user = get_current_user()
    data = request.get_json() or {}
    subject = (data.get('subject') or '(no subject)').strip()[:200]
    body_text = (data.get('body') or '').strip()
    page_url = (data.get('url') or '').strip()
    user_agent = (data.get('user_agent') or '').strip()[:300]
    user_email = user['email'] if user else DEV_USER_EMAIL
    user_name = (user.get('name') if user else '') or user_email

    html = f'''<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f7fa;font-family:'Open Sans',Arial,sans-serif">
  <div style="background:#002f60;padding:18px 22px">
    <div style="color:rgba(255,255,255,.8);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">ObservationPoint · Tester Feedback</div>
    <div style="color:#fff;font-size:18px;font-weight:800;margin-top:4px">{subject}</div>
  </div>
  <div style="padding:22px;max-width:600px;margin:0 auto">
    <div style="background:#fff;border-radius:10px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:6px">From</div>
      <div style="font-size:14px;color:#111827;margin-bottom:14px">{user_name} &lt;{user_email}&gt;</div>
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:6px">Page</div>
      <div style="font-size:12px;color:#374151;margin-bottom:14px;word-break:break-all"><a href="{page_url}" style="color:#e47727">{page_url}</a></div>
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:6px">Message</div>
      <div style="font-size:14px;color:#111827;line-height:1.6;white-space:pre-wrap">{body_text or '(no message)'}</div>
      <div style="font-size:10px;color:#9ca3af;margin-top:18px;border-top:1px solid #f3f4f6;padding-top:10px">{user_agent}</div>
    </div>
  </div>
</body></html>'''

    try:
        ok = _send_email('talent@firstlineschools.org', f'[OP Feedback] {subject}', html)
    except Exception as e:
        log.error(f'feedback email failed: {e}')
        ok = False
    return jsonify({'sent': ok})


# ------------------------------------------------------------------
# Public acknowledgment endpoints — NO AUTH (the token IS the auth)
# ------------------------------------------------------------------

@app.route('/acknowledge/<path:path>')
@app.route('/acknowledge')
def serve_acknowledge(path=None):
    """Public route — employees clicking the email link land here. Serves the React SPA."""
    react_index = os.path.join(REACT_DIR, 'index.html')
    if os.path.exists(react_index):
        return _nocache_html(send_from_directory(REACT_DIR, 'index.html'))
    return 'React app not built', 404


@app.route('/api/ack/<token>', methods=['GET'])
def api_ack_load(token):
    """Load document details for the acknowledgment page (public, token-based)."""
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT t.*,
                   s.first_name AS employee_first, s.last_name AS employee_last,
                   o.first_name AS observer_first, o.last_name AS observer_last
            FROM touchpoints t
            LEFT JOIN staff s ON LOWER(s.email) = LOWER(t.teacher_email)
            LEFT JOIN staff o ON LOWER(o.email) = LOWER(t.observer_email)
            WHERE t.acknowledgment_token = %s
        """, (token,))
        tp = cur.fetchone()
        if not tp:
            return jsonify({'error': 'not found'}), 404

        fb = {}
        try:
            if tp.get('feedback'):
                fb = json.loads(tp['feedback']) if isinstance(tp['feedback'], str) else tp['feedback']
        except (ValueError, TypeError):
            fb = {}

        form_type = tp.get('form_type', '')
        summary_lines = []
        if form_type == 'write_up':
            if fb.get('warning_type'): summary_lines.append({'label': 'Type', 'value': fb['warning_type']})
            if fb.get('categories'): summary_lines.append({'label': 'Category', 'value': ', '.join(fb['categories'])})
            if fb.get('description'): summary_lines.append({'label': 'Description', 'value': fb['description']})
            if fb.get('prior_discussions'): summary_lines.append({'label': 'Prior Discussions', 'value': fb['prior_discussions']})
            if fb.get('expectations'): summary_lines.append({'label': 'Expectations', 'value': fb['expectations']})
            if fb.get('consequences'): summary_lines.append({'label': 'Consequences', 'value': fb['consequences']})
        else:
            if fb.get('concerns'): summary_lines.append({'label': 'Area(s) of Concern', 'value': ', '.join(fb['concerns'])})
            if fb.get('description_of_concern'): summary_lines.append({'label': 'Description', 'value': fb['description_of_concern']})
            if fb.get('action_steps'): summary_lines.append({'label': 'Action Steps', 'value': fb['action_steps']})
            if fb.get('indicators_of_success'): summary_lines.append({'label': 'Indicators of Success', 'value': fb['indicators_of_success']})
            if fb.get('consequences'): summary_lines.append({'label': 'Consequences', 'value': fb['consequences']})

        return jsonify({
            'form_type': form_type,
            'employee_name': f"{tp.get('employee_first','')} {tp.get('employee_last','')}".strip() or tp.get('teacher_email',''),
            'employee_first': tp.get('employee_first', ''),
            'observer_name': f"{tp.get('observer_first','')} {tp.get('observer_last','')}".strip() or tp.get('observer_email',''),
            'issued_date': tp.get('observed_at').isoformat() if tp.get('observed_at') else None,
            'review_date': fb.get('review_date'),
            'summary_lines': summary_lines,
            'already_acknowledged': bool(tp.get('acknowledgment_at')),
            'acknowledged_at': tp.get('acknowledgment_at').isoformat() if tp.get('acknowledgment_at') else None,
        })
    finally:
        conn.close()


@app.route('/api/ack/<token>', methods=['POST'])
def api_ack_submit(token):
    """Record the typed acknowledgment. Public — token is the auth."""
    body = request.get_json() or {}
    typed_name = (body.get('typed_name') or '').strip()
    if not typed_name:
        return jsonify({'error': 'name required'}), 400
    ip = (request.headers.get('X-Forwarded-For') or request.remote_addr or '').split(',')[0].strip()
    ua = (request.headers.get('User-Agent') or '')[:500]

    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            UPDATE touchpoints
            SET acknowledgment_name = %s,
                acknowledgment_at = NOW(),
                acknowledgment_ip = %s,
                acknowledgment_ua = %s
            WHERE acknowledgment_token = %s AND acknowledgment_at IS NULL
            RETURNING id, teacher_email, observer_email, form_type, is_test
        """, (typed_name, ip, ua, token))
        row = cur.fetchone()
        if not row:
            return jsonify({'error': 'invalid or already acknowledged'}), 400
        conn.commit()
        from datetime import datetime as _dt

        # Notify the supervisor (observer_email) that the employee acknowledged.
        try:
            doc_label = 'Write-Up' if row['form_type'] == 'write_up' else 'Performance Improvement Plan'
            ack_at_str = _dt.now().strftime('%B %d, %Y at %I:%M %p')
            html = f'''<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8f9fa;font-family:'Open Sans',Arial,sans-serif">
  <div style="background:#22c55e;padding:24px 22px;text-align:center">
    <div style="color:rgba(255,255,255,.9);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em">Acknowledgment Received</div>
    <div style="color:#fff;font-size:20px;font-weight:800;margin-top:6px">{doc_label}</div>
  </div>
  <div style="padding:24px 22px;max-width:600px;margin:0 auto">
    <div style="background:#fff;border-radius:10px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <div style="font-size:14px;color:#374151;line-height:1.6;margin-bottom:14px">
        <b>{row["teacher_email"]}</b> acknowledged receipt of the {doc_label.lower()} you filed.
      </div>
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:4px">Signed by</div>
      <div style="font-size:14px;color:#111827;margin-bottom:12px">{typed_name}</div>
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:4px">Timestamp</div>
      <div style="font-size:14px;color:#111827;margin-bottom:12px">{ack_at_str}</div>
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:4px">IP address</div>
      <div style="font-size:13px;color:#374151;font-family:monospace">{ip}</div>
    </div>
    <div style="font-size:12px;color:#6b7280;margin-top:14px;line-height:1.5">Acknowledgment confirms receipt only — it does not imply agreement with the document's content.</div>
  </div>
  <div style="background:#002f60;padding:14px;text-align:center">
    <div style="color:rgba(255,255,255,.85);font-size:11px;font-weight:700">FirstLine Schools</div>
  </div>
</body></html>'''
            subject_line = f'[Acknowledged] {row["teacher_email"]} signed the {doc_label}'
            recipient = row['observer_email']
            if row.get('is_test'):
                subject_line = '[TEST] ' + subject_line
            _send_email(recipient, subject_line, html)
        except Exception as e:
            log.error(f'supervisor ack notify failed: {e}')

        return jsonify({'acknowledged': True, 'at': _dt.now().isoformat()})
    except Exception as e:
        log.error(f"ack submit failed: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


# ──────────────────────────────────────────────────────────────────────
# Public Solicit Feedback response flow (no login — token-gated, like /acknowledge)
# ──────────────────────────────────────────────────────────────────────

@app.route('/respond/<path:path>')
@app.route('/respond')
def serve_respond(path=None):
    """Public route — staff clicking the email link from a feedback request
    land here. Serves the React SPA which renders FeedbackResponse.jsx."""
    react_index = os.path.join(REACT_DIR, 'index.html')
    if os.path.exists(react_index):
        return _nocache_html(send_from_directory(REACT_DIR, 'index.html'))
    return 'React app not built', 404


@app.route('/api/feedback-respond/<token>', methods=['GET'])
def api_feedback_respond_load(token):
    """Load the feedback request: questions, context, requestor name. Public."""
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT t.*,
                   s.first_name AS subject_first, s.last_name AS subject_last,
                   o.first_name AS requestor_first, o.last_name AS requestor_last
              FROM touchpoints t
              LEFT JOIN staff s ON LOWER(s.email) = LOWER(t.teacher_email)
              LEFT JOIN staff o ON LOWER(o.email) = LOWER(t.observer_email)
             WHERE t.acknowledgment_token = %s AND t.form_type = 'solicited_feedback'
        """, (token,))
        tp = cur.fetchone()
        if not tp:
            return jsonify({'error': 'not found'}), 404
        fb = {}
        try:
            fb = json.loads(tp['feedback']) if isinstance(tp['feedback'], str) else (tp['feedback'] or {})
        except (ValueError, TypeError):
            fb = {}
        return jsonify({
            'subject_first': tp.get('subject_first', ''),
            'subject_last': tp.get('subject_last', ''),
            'subject_email': tp.get('teacher_email', ''),
            'requestor_first': tp.get('requestor_first', ''),
            'requestor_last': tp.get('requestor_last', ''),
            'requestor_email': tp.get('observer_email', ''),
            'questions': fb.get('questions') or [],
            'context': fb.get('context') or '',
            'likert_scales': fb.get('likert_scales') or [],
            'already_responded': bool(fb.get('responded_at')),
            'responded_at': fb.get('responded_at'),
        })
    finally:
        conn.close()


@app.route('/api/feedback-respond/<token>', methods=['POST'])
def api_feedback_respond_submit(token):
    """Subject submits their responses. Updates the touchpoint's feedback
    JSON, fires gratitude email to subject + summary email to requestor."""
    body = request.get_json() or {}
    responses = body.get('responses') or []
    likert_answers = body.get('likert_answers') or {}
    from datetime import datetime as _dt

    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT t.*,
                   s.first_name AS subject_first, s.last_name AS subject_last,
                   o.first_name AS requestor_first, o.last_name AS requestor_last
              FROM touchpoints t
              LEFT JOIN staff s ON LOWER(s.email) = LOWER(t.teacher_email)
              LEFT JOIN staff o ON LOWER(o.email) = LOWER(t.observer_email)
             WHERE t.acknowledgment_token = %s AND t.form_type = 'solicited_feedback'
        """, (token,))
        tp = cur.fetchone()
        if not tp:
            return jsonify({'error': 'not found'}), 404
        fb = {}
        try:
            fb = json.loads(tp['feedback']) if isinstance(tp['feedback'], str) else (tp['feedback'] or {})
        except (ValueError, TypeError):
            fb = {}
        if fb.get('responded_at'):
            return jsonify({'already_responded': True}), 200

        now_iso = _dt.now().isoformat()
        fb['responses'] = responses
        fb['likert_answers'] = likert_answers
        fb['responded_at'] = now_iso
        cur.execute("UPDATE touchpoints SET feedback = %s WHERE id = %s",
                    (json.dumps(fb), tp['id']))
        conn.commit()

        subject_first = (tp.get('subject_first') or '').strip()
        subject_email = tp.get('teacher_email', '')
        requestor_name = f"{(tp.get('requestor_first') or '').strip()} {(tp.get('requestor_last') or '').strip()}".strip() or tp.get('observer_email', '')
        questions = fb.get('questions') or []

        # Build summary email (HTML) for the requestor
        no_resp = '<em style="color:#9ca3af">(no response)</em>'
        summary_blocks = []
        for q, r in zip(questions, responses):
            answer = r if r else no_resp
            summary_blocks.append(f'<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:4px">{q}</div><div style="font-size:13px;color:#111;line-height:1.55;background:#f9fafb;padding:10px 12px;border-radius:6px">{answer}</div></div>')
        likert_blocks = []
        for scale in (fb.get('likert_scales') or []):
            sid = scale.get('id')
            val = likert_answers.get(sid)
            if val is not None:
                likert_blocks.append(f'<div style="display:inline-block;margin-right:14px;font-size:12px;color:#374151"><b>{scale.get("label","")}</b>: {val}/5</div>')

        summary_html = f'''<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8f9fa;font-family:'Open Sans',Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff">
    <div style="background:#002f60;padding:20px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:18px">Feedback received from {subject_first}</h1>
    </div>
    <div style="padding:24px">
      <p style="margin:0 0 16px;font-size:14px;color:#374151">Hi,</p>
      <p style="margin:0 0 18px;font-size:14px;color:#374151">{subject_first} responded to your feedback request. Here's what they shared:</p>
      {''.join(summary_blocks)}
      {('<div style="margin-top:6px;padding-top:14px;border-top:1px solid #e5e7eb">' + ''.join(likert_blocks) + '</div>') if likert_blocks else ''}
    </div>
    <div style="background:#f8f9fa;padding:14px 24px;font-size:11px;color:#6b7280">
      Questions? Contact <a href="mailto:talent@firstlineschools.org" style="color:#002f60">talent@firstlineschools.org</a>
    </div>
    <div style="background:#002f60;color:rgba(255,255,255,.7);padding:10px;text-align:center;font-size:10px">FirstLine Schools — Education For Life</div>
  </div></body></html>'''

        gratitude_html = f'''<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8f9fa;font-family:'Open Sans',Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff">
    <div style="background:#002f60;padding:20px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:18px">Thank you, {subject_first}</h1>
    </div>
    <div style="padding:24px">
      <p style="margin:0 0 14px;font-size:14px;color:#374151">Hi {subject_first},</p>
      <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.55">Thank you for taking the time to share honest feedback with {requestor_name}. Your perspective is what makes our coaching better — we appreciate it.</p>
    </div>
    <div style="background:#002f60;color:rgba(255,255,255,.7);padding:10px;text-align:center;font-size:10px">FirstLine Schools — Education For Life</div>
  </div></body></html>'''

        # Test-mode: both emails go to the requestor (originator) for safety.
        if tp.get('is_test'):
            _send_email(tp['observer_email'], '[TEST · gratitude → subject] Thanks for your feedback', gratitude_html)
            _send_email(tp['observer_email'], f'[TEST · summary] Feedback received from {subject_first}', summary_html)
        else:
            _send_email(subject_email, 'Thanks for sharing your feedback', gratitude_html)
            _send_email(tp['observer_email'], f'Feedback received from {subject_first}', summary_html)

        return jsonify({'ok': True, 'responded_at': now_iso})
    except Exception as e:
        log.error(f"feedback-respond submit failed: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/touchpoints/<tp_id>', methods=['DELETE'])
@require_auth
@require_no_impersonation
def api_abandon_touchpoint(tp_id):
    """Abandon a draft. Only drafts, only your own."""
    user = get_current_user()
    observer = user['email'] if user else DEV_USER_EMAIL
    try:
        db.archive_touchpoint(tp_id, observer)
        return jsonify({'id': tp_id, 'archived': True})
    except PermissionError as e:
        return jsonify({'error': str(e)}), 403
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Goals — per-teacher annual goals (WIG + AG1/AG2/AG3)
# ------------------------------------------------------------------

def _fetch_staff_by_email(email):
    if not email:
        return None
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT email, first_name, last_name, job_title, job_function, school, grade_level, subject, supervisor_email FROM staff WHERE LOWER(email)=LOWER(%s)", (email,))
        return cur.fetchone()
    finally:
        conn.close()


@app.route('/api/goals/library')
@require_auth
def api_goals_library():
    """Return recommended goals for a given role + school_year.
    If no role is given, derives it from the teacher_email param."""
    role = (request.args.get('role') or '').strip()
    school_year = (request.args.get('school_year') or CURRENT_SCHOOL_YEAR).strip()
    teacher_email = (request.args.get('teacher_email') or '').strip()
    if not role and teacher_email:
        staff = _fetch_staff_by_email(teacher_email)
        role = resolve_recommended_role(staff) or ''
    if not role:
        return jsonify({'role': None, 'recommendations': []})

    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT goal_type, goal_text FROM recommended_goals
            WHERE school_year = %s AND role = %s
            ORDER BY CASE goal_type WHEN 'WIG' THEN 0 WHEN 'AG1' THEN 1 WHEN 'AG2' THEN 2 WHEN 'AG3' THEN 3 ELSE 9 END
        """, (school_year, role))
        recs = [dict(r) for r in cur.fetchall()]
        return jsonify({'role': role, 'school_year': school_year, 'recommendations': recs})
    finally:
        conn.close()


@app.route('/api/goals/for-teacher')
@require_auth
def api_goals_for_teacher():
    """Return the current goals (any status) for a teacher + school_year."""
    teacher_email = (request.args.get('teacher_email') or '').strip()
    school_year = (request.args.get('school_year') or CURRENT_SCHOOL_YEAR).strip()
    if not teacher_email:
        return jsonify({'error': 'teacher_email required'}), 400
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT * FROM goals
            WHERE LOWER(teacher_email)=LOWER(%s) AND school_year=%s
            ORDER BY CASE goal_type WHEN 'WIG' THEN 0 WHEN 'AG1' THEN 1 WHEN 'AG2' THEN 2 WHEN 'AG3' THEN 3 ELSE 9 END
        """, (teacher_email, school_year))
        goals = [dict(r) for r in cur.fetchall()]
        return jsonify({'teacher_email': teacher_email, 'school_year': school_year, 'goals': goals})
    finally:
        conn.close()


@app.route('/api/goals', methods=['POST'])
@require_auth
@require_no_impersonation
def api_save_goals():
    """Upsert one or more goals for a teacher. Body:
        { teacher_email, school_year, status, goals: [{goal_type, goal_text}, ...] }
    status = 'draft' | 'submitted' (caller decides intent).
    Permission: subject themselves, their supervisor, or an admin."""
    user = get_current_user()
    current_email = user['email'] if user else DEV_USER_EMAIL
    data = request.get_json() or {}
    teacher_email = (data.get('teacher_email') or '').strip().lower()
    school_year = (data.get('school_year') or CURRENT_SCHOOL_YEAR).strip()
    new_status = (data.get('status') or 'draft').strip()
    goals = data.get('goals') or []
    if not teacher_email:
        return jsonify({'error': 'teacher_email required'}), 400

    subject_staff = _fetch_staff_by_email(teacher_email)
    if not subject_staff:
        return jsonify({'error': 'subject not found'}), 404

    # Permission: self, supervisor, or admin
    is_self = teacher_email == current_email.lower()
    is_admin = bool(user and user.get('is_admin'))
    is_supervisor = bool(subject_staff.get('supervisor_email') and
                         subject_staff['supervisor_email'].lower() == current_email.lower())
    if not (is_self or is_supervisor or is_admin):
        return jsonify({'authorized': False, 'error': 'not authorized to edit these goals'})

    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        saved = []
        submitted_ts = None
        if new_status == 'submitted':
            from datetime import datetime as _dt
            submitted_ts = _dt.now()
        for g in goals:
            gt = (g.get('goal_type') or '').strip()
            gtext = (g.get('goal_text') or '').strip()
            if gt not in ('WIG', 'AG1', 'AG2', 'AG3'):
                continue
            # Upsert by (teacher_email, school_year, goal_type)
            cur.execute("""
                SELECT id, status, approved_at FROM goals
                WHERE LOWER(teacher_email)=%s AND school_year=%s AND goal_type=%s
            """, (teacher_email, school_year, gt))
            existing = cur.fetchone()
            if existing:
                # Preserve approved state unless caller explicitly changes status
                preserve_status = existing['status'] == 'approved' and new_status == 'draft'
                final_status = existing['status'] if preserve_status else new_status
                cur.execute("""
                    UPDATE goals SET goal_text=%s, status=%s, updated_at=NOW(),
                        submitted_by = COALESCE(%s, submitted_by),
                        submitted_at = COALESCE(%s, submitted_at)
                    WHERE id=%s RETURNING *
                """, (gtext, final_status, current_email if new_status == 'submitted' else None,
                      submitted_ts, existing['id']))
            else:
                cur.execute("""
                    INSERT INTO goals (teacher_email, school_year, goal_type, goal_text, status, submitted_by, submitted_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING *
                """, (teacher_email, school_year, gt, gtext, new_status,
                      current_email if new_status == 'submitted' else None, submitted_ts))
            saved.append(dict(cur.fetchone()))
        conn.commit()

        # Notify supervisor when status='submitted'. Test-mode routing:
        # email goes to the saver instead so real supervisors aren't pinged
        # during pre-launch testing. Subject prefixed [TEST].
        if new_status == 'submitted' and saved:
            try:
                _notify_supervisor_goals_submitted(
                    teacher_staff=subject_staff,
                    saver_email=current_email,
                    saved_goals=saved,
                    school_year=school_year,
                )
            except Exception as e:
                log.error(f"goals submit notify failed: {e}")

        return jsonify({'saved': saved})
    except Exception as e:
        log.error(f"save goals failed: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


def _notify_supervisor_goals_submitted(teacher_staff, saver_email, saved_goals, school_year):
    """Email the teacher's supervisor when a goal is submitted/edited for review.
    Pre-launch test mode: route to saver instead of supervisor, prefix [TEST]."""
    supervisor_email = (teacher_staff.get('supervisor_email') or '').strip()
    if not supervisor_email:
        return
    teacher_name = f"{teacher_staff.get('first_name','')} {teacher_staff.get('last_name','')}".strip()
    teacher_email_addr = teacher_staff.get('email','')

    # Build the goal list for the email body
    rows = ''.join(
        f'<tr><td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:700;color:#002f60;width:60px">{g["goal_type"]}</td>'
        f'<td style="padding:6px 10px;border:1px solid #e5e7eb;color:#374151">{(g.get("goal_text") or "")}</td></tr>'
        for g in saved_goals
    )

    app_url = 'https://observationpoint-965913991496.us-central1.run.app'
    deep_link = f'{app_url}/app/goals?teacher={teacher_email_addr}'

    n = len(saved_goals)
    is_edit = any(g.get('approved_at') for g in saved_goals)  # had approval before, being re-submitted
    headline = f"{teacher_name} edited an approved goal — re-approval needed" if is_edit else f"{teacher_name} submitted goals for your review"

    html = f"""
    <html><body style="margin:0;padding:0;font-family:'Open Sans',Arial,sans-serif;background:#f8f9fa">
      <div style="max-width:560px;margin:0 auto;background:#fff">
        <div style="background:#002f60;color:#fff;padding:18px 20px">
          <h1 style="margin:0;font-size:20px">{headline}</h1>
          <div style="font-size:12px;opacity:.8;margin-top:4px">School year {school_year}</div>
        </div>
        <div style="padding:20px">
          <p style="margin:0 0 12px;font-size:14px;color:#374151">Hi,</p>
          <p style="margin:0 0 16px;font-size:14px;color:#374151">{teacher_name} {'edited' if is_edit else 'submitted'} {n} goal{'s' if n != 1 else ''} that need{'s' if n == 1 else ''} your review.</p>
          <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:18px">{rows}</table>
          <a href="{deep_link}" style="display:inline-block;background:#e47727;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;font-size:14px">Review and approve →</a>
          <p style="margin:18px 0 0;font-size:11px;color:#6b7280">Or visit ObservationPoint and find {teacher_name} in your team.</p>
        </div>
        <div style="background:#f8f9fa;padding:14px 20px;font-size:11px;color:#6b7280">
          Questions? Contact <a href="mailto:talent@firstlineschools.org" style="color:#002f60">talent@firstlineschools.org</a>
        </div>
        <div style="background:#002f60;color:rgba(255,255,255,.7);padding:10px;text-align:center;font-size:10px">FirstLine Schools — Education For Life</div>
      </div>
    </body></html>
    """

    # Goals notify both the supervisor (review) AND the teacher (their own copy).
    # Test-mode routing pre-launch: send only to saver, not the real recipients.
    test_mode = True  # flip to False at launch
    if test_mode:
        recipient = saver_email
        subject = f"[TEST · would go to {supervisor_email} + {teacher_email_addr}] {headline}"
        _send_email(recipient, subject, html)
    else:
        # Post-launch: supervisor as primary recipient; teacher CC'd so both parties have a record.
        # Don't double-send if supervisor IS the teacher (rare).
        cc = [teacher_email_addr] if (teacher_email_addr and teacher_email_addr.lower() != supervisor_email.lower()) else []
        _send_email(supervisor_email, headline, html, cc_emails=cc)


@app.route('/api/goals/<goal_id>/approve', methods=['POST'])
@require_auth
@require_no_impersonation
def api_goals_approve(goal_id):
    """Approve a single goal. Only supervisor of the subject, or admin."""
    user = get_current_user()
    current_email = user['email'] if user else DEV_USER_EMAIL
    is_admin = bool(user and user.get('is_admin'))
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM goals WHERE id=%s", (goal_id,))
        g = cur.fetchone()
        if not g:
            return jsonify({'error': 'not found'}), 404
        subject_staff = _fetch_staff_by_email(g['teacher_email'])
        is_supervisor = bool(subject_staff and subject_staff.get('supervisor_email') and
                             subject_staff['supervisor_email'].lower() == current_email.lower())
        if not (is_supervisor or is_admin):
            return jsonify({'authorized': False, 'error': 'only the subject\'s supervisor or an admin can approve'})
        cur.execute("""
            UPDATE goals
            SET status='approved', approved_by=%s, approved_at=NOW(), updated_at=NOW()
            WHERE id=%s RETURNING *
        """, (current_email, goal_id))
        row = cur.fetchone()
        conn.commit()
        return jsonify({'approved': True, 'goal': dict(row)})
    finally:
        conn.close()


# ------------------------------------------------------------------
# Teacher Home — endpoints scoped to "me" (the current user as the SUBJECT)
# ------------------------------------------------------------------

@app.route('/api/me/todos')
@require_auth
def api_me_todos():
    """Return the teacher's outstanding todos: pending self-reflection,
    missing/draft goals, current open action steps."""
    user = get_current_user()
    me_email = user['email'] if user else DEV_USER_EMAIL
    school_year = (request.args.get('school_year') or '2025-2026').strip()

    todos = {
        'self_reflection': None,
        'goals': None,
        'action_steps': [],
    }
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Self-reflection: any published self_reflection_* for this year?
        cur.execute("""
            SELECT id, form_type, observed_at FROM touchpoints
            WHERE LOWER(teacher_email)=LOWER(%s)
              AND school_year=%s
              AND status='published'
              AND form_type LIKE 'self_reflection%%'
              AND (is_test IS NULL OR is_test = false)
            ORDER BY observed_at DESC LIMIT 1
        """, (me_email, school_year))
        sr = cur.fetchone()
        todos['self_reflection'] = {
            'completed': bool(sr),
            'last_at': sr['observed_at'].isoformat() if sr and sr.get('observed_at') else None,
        }

        # Goals: count by status
        cur.execute("""
            SELECT status, COUNT(*) AS n FROM goals
            WHERE LOWER(teacher_email)=LOWER(%s) AND school_year=%s
            GROUP BY status
        """, (me_email, school_year))
        status_counts = {r['status']: r['n'] for r in cur.fetchall()}
        approved = status_counts.get('approved', 0)
        any_set = sum(status_counts.values())
        todos['goals'] = {
            'all_approved': approved >= 4,
            'approved_count': approved,
            'any_set': any_set,
        }

        # Open action steps assigned to me, current school year only
        cur.execute("""
            SELECT id, body_text, creator_email, observation_grow_id, created_at, progress_pct
            FROM action_steps
            WHERE LOWER(teacher_email)=LOWER(%s)
              AND type='actionStep'
              AND (progress_pct IS NULL OR progress_pct < 100)
              AND school_year=%s
              AND (is_test IS NULL OR is_test = false)
            ORDER BY created_at DESC LIMIT 10
        """, (me_email, school_year))
        todos['action_steps'] = [
            {
                'id': str(r['id']),
                'text': r['body_text'],
                'assigned_by': r.get('creator_email'),
                'observation_id': str(r['observation_grow_id']) if r.get('observation_grow_id') else None,
                'assigned_at': r['created_at'].isoformat() if r.get('created_at') else None,
                'progress_pct': r.get('progress_pct'),
            }
            for r in cur.fetchall()
        ]
        return jsonify(todos)
    finally:
        conn.close()


@app.route('/api/me/action-steps')
@require_auth
def api_me_action_steps():
    """Open action steps assigned to the current user, scoped to a school year.
    Defaults to 2025-2026 (current operating year). Pass ?school_year=all to override."""
    user = get_current_user()
    me_email = user['email'] if user else DEV_USER_EMAIL
    school_year = (request.args.get('school_year') or '2025-2026').strip()
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if school_year.lower() == 'all':
            cur.execute("""
                SELECT a.id, a.body_text, a.created_at, a.observation_grow_id,
                       a.progress_pct, a.progress_date, a.progress_justification,
                       a.creator_email, a.school_year,
                       ag.first_name AS assigner_first, ag.last_name AS assigner_last
                FROM action_steps a
                LEFT JOIN staff ag ON LOWER(ag.email) = LOWER(a.creator_email)
                WHERE LOWER(a.teacher_email) = LOWER(%s)
                  AND a.type = 'actionStep'
                  AND (a.is_test IS NULL OR a.is_test = false)
                  AND (a.progress_pct IS NULL OR a.progress_pct < 100)
                ORDER BY a.created_at DESC
            """, (me_email,))
        else:
            cur.execute("""
                SELECT a.id, a.body_text, a.created_at, a.observation_grow_id,
                       a.progress_pct, a.progress_date, a.progress_justification,
                       a.creator_email, a.school_year,
                       ag.first_name AS assigner_first, ag.last_name AS assigner_last
                FROM action_steps a
                LEFT JOIN staff ag ON LOWER(ag.email) = LOWER(a.creator_email)
                WHERE LOWER(a.teacher_email) = LOWER(%s)
                  AND a.type = 'actionStep'
                  AND (a.is_test IS NULL OR a.is_test = false)
                  AND (a.progress_pct IS NULL OR a.progress_pct < 100)
                  AND a.school_year = %s
                ORDER BY a.created_at DESC
            """, (me_email, school_year))
        steps = [
            {
                'id': str(r['id']),
                'text': r['body_text'],
                'assigned_at': r['created_at'].isoformat() if r.get('created_at') else None,
                'observation_id': str(r['observation_grow_id']) if r.get('observation_grow_id') else None,
                'progress_pct': r.get('progress_pct') or 0,
                'progress_date': r['progress_date'].isoformat() if r.get('progress_date') else None,
                'reflection': r.get('progress_justification') or '',
                'assigned_by_name': f"{r.get('assigner_first','')} {r.get('assigner_last','')}".strip() or r.get('creator_email', ''),
                'assigned_by_email': r.get('creator_email', ''),
            }
            for r in cur.fetchall()
        ]
        return jsonify({'action_steps': steps})
    finally:
        conn.close()


@app.route('/api/me/action-steps/<step_id>/progress', methods=['POST'])
@require_auth
@require_no_impersonation
def api_me_action_step_progress(step_id):
    """Update self-reported progress on an action step. Only the assignee."""
    user = get_current_user()
    me_email = user['email'] if user else DEV_USER_EMAIL
    body = request.get_json() or {}
    pct = body.get('progress_pct')
    reflection = (body.get('reflection') or '').strip()
    if pct is not None:
        try:
            pct = int(pct)
            if pct < 0 or pct > 100:
                return jsonify({'error': 'progress_pct must be 0-100'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'invalid progress_pct'}), 400

    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # Permission: only the supervisor (creator) or admin can update progress.
        # Teachers self-report via /request-review (sends a note to the supervisor).
        cur.execute(
            "SELECT teacher_email, creator_email FROM action_steps WHERE id = %s",
            (step_id,),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({'error': 'not found'}), 404
        is_admin = bool(user and user.get('is_admin'))
        is_creator = (row['creator_email'] or '').lower() == me_email.lower()
        if not (is_admin or is_creator):
            return jsonify({'authorized': False, 'error': 'only the supervisor who assigned this step can update its progress'})

        cur.execute("""
            UPDATE action_steps
            SET progress_pct = COALESCE(%s, progress_pct),
                progress_justification = COALESCE(%s, progress_justification),
                progress_date = NOW(),
                last_modified = NOW()
            WHERE id = %s
            RETURNING id, progress_pct, progress_date, progress_justification
        """, (pct, reflection if reflection else None, step_id))
        updated = cur.fetchone()
        conn.commit()
        return jsonify({
            'id': str(updated['id']),
            'progress_pct': updated.get('progress_pct'),
            'progress_date': updated['progress_date'].isoformat() if updated.get('progress_date') else None,
            'reflection': updated.get('progress_justification') or '',
        })
    finally:
        conn.close()


@app.route('/api/action-steps/<step_id>', methods=['PUT', 'DELETE'])
@require_auth
@require_no_impersonation
def api_action_step_edit_or_delete(step_id):
    """Edit body_text or delete an action step. Auth: creator (supervisor) or admin."""
    user = get_current_user()
    me_email = (user.get('email') if user else DEV_USER_EMAIL).lower()
    is_admin = bool(user and user.get('is_admin'))

    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT teacher_email, creator_email FROM action_steps WHERE id = %s", (step_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({'error': 'not found'}), 404
        is_creator = (row['creator_email'] or '').lower() == me_email
        if not (is_admin or is_creator):
            return jsonify({'authorized': False, 'error': 'only the supervisor who assigned this step or an admin can modify it'})

        if request.method == 'DELETE':
            cur.execute("DELETE FROM action_steps WHERE id = %s", (step_id,))
            conn.commit()
            return jsonify({'deleted': True, 'id': step_id})

        # PUT: edit body_text
        body = request.get_json() or {}
        new_text = (body.get('body_text') or '').strip()
        if not new_text:
            return jsonify({'error': 'body_text required'}), 400
        cur.execute("""
            UPDATE action_steps
            SET body_text = %s, last_modified = NOW()
            WHERE id = %s
            RETURNING id, body_text, last_modified
        """, (new_text, step_id))
        updated = cur.fetchone()
        conn.commit()
        return jsonify({
            'id': str(updated['id']),
            'body_text': updated['body_text'],
            'last_modified': updated['last_modified'].isoformat() if updated.get('last_modified') else None,
        })
    finally:
        conn.close()


@app.route('/api/me/action-steps/<step_id>/request-review', methods=['POST'])
@require_auth
@require_no_impersonation
def api_me_action_step_request_review(step_id):
    """Teacher (assignee) sends a note to the supervisor (creator) asking them
    to come take a look. Supervisor decides whether to bump progress."""
    user = get_current_user()
    me_email = user['email'] if user else DEV_USER_EMAIL
    body = request.get_json() or {}
    note = (body.get('note') or '').strip()

    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT a.id, a.body_text, a.creator_email, a.teacher_email, a.observation_grow_id,
                   t.first_name AS teacher_first, t.last_name AS teacher_last,
                   c.first_name AS creator_first, c.last_name AS creator_last
            FROM action_steps a
            LEFT JOIN staff t ON LOWER(t.email) = LOWER(a.teacher_email)
            LEFT JOIN staff c ON LOWER(c.email) = LOWER(a.creator_email)
            WHERE a.id = %s
        """, (step_id,))
        step = cur.fetchone()
        if not step:
            return jsonify({'error': 'not found'}), 404
        if (step['teacher_email'] or '').lower() != me_email.lower():
            return jsonify({'authorized': False, 'error': 'only the assignee can request review'})
        creator_email = (step['creator_email'] or '').strip()
        if not creator_email:
            return jsonify({'error': 'no supervisor on file for this step'}), 400

        teacher_name = f"{step.get('teacher_first','') or ''} {step.get('teacher_last','') or ''}".strip() or me_email
        creator_name = f"{step.get('creator_first','') or ''} {step.get('creator_last','') or ''}".strip() or creator_email
        step_text = (step.get('body_text') or '').strip()
        app_url = 'https://observationpoint-965913991496.us-central1.run.app'
        deep_link = f"{app_url}/app/staff/{step['teacher_email']}"

        html = f"""
        <html><body style="margin:0;padding:0;font-family:'Open Sans',Arial,sans-serif;background:#f8f9fa">
          <div style="max-width:560px;margin:0 auto;background:#fff">
            <div style="background:#002f60;color:#fff;padding:18px 20px">
              <h1 style="margin:0;font-size:20px">{teacher_name} is asking for review</h1>
              <div style="font-size:12px;opacity:.8;margin-top:4px">Action step follow-through</div>
            </div>
            <div style="padding:20px">
              <p style="margin:0 0 12px;font-size:14px;color:#374151">Hi {creator_name.split(' ')[0] if creator_name else 'there'},</p>
              <p style="margin:0 0 8px;font-size:14px;color:#374151">{teacher_name} has been working on the following action step and is asking for your review:</p>
              <div style="background:#f9fafb;border-left:3px solid #e47727;padding:10px 14px;margin:10px 0;border-radius:6px;font-size:13px;color:#111827;white-space:pre-wrap">{step_text}</div>
              {('<p style="margin:14px 0 0;font-size:13px;color:#374151"><b>Their note:</b></p><div style="background:#fff7ed;border:1px solid #fed7aa;padding:10px 14px;border-radius:6px;font-size:13px;color:#9a3412;font-style:italic;margin-top:6px">' + note + '</div>') if note else ''}
              <a href="{deep_link}" style="display:inline-block;background:#e47727;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;font-size:14px;margin-top:18px">Open {teacher_name.split(' ')[0]}'s profile →</a>
            </div>
            <div style="background:#f8f9fa;padding:14px 20px;font-size:11px;color:#6b7280">Questions? <a href="mailto:talent@firstlineschools.org" style="color:#002f60">talent@firstlineschools.org</a></div>
            <div style="background:#002f60;color:rgba(255,255,255,.7);padding:10px;text-align:center;font-size:10px">FirstLine Schools — Education For Life</div>
          </div>
        </body></html>
        """

        # Test-mode pre-launch: route to the saver so real supervisors aren't pinged
        test_mode = True
        if test_mode:
            recipient = me_email
            subject = f"[TEST · would go to {creator_email}] {teacher_name} is asking for review"
        else:
            recipient = creator_email
            subject = f"{teacher_name} is asking for action step review"
        ok = _send_email(recipient, subject, html)
        return jsonify({'sent': bool(ok)})
    finally:
        conn.close()


@app.route('/api/me/activity')
@require_auth
def api_me_activity():
    """Recent touchpoints ABOUT the current user — observations, PMAPs,
    formal celebrations, fundamentals, meetings. Excludes peer shoutouts
    (those go to /api/me/shoutouts)."""
    user = get_current_user()
    me_email = user['email'] if user else DEV_USER_EMAIL
    school_year = (request.args.get('school_year') or '2025-2026').strip()
    limit = int(request.args.get('limit', 12))

    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT t.id, t.form_type, t.observed_at, t.notes, t.observer_email, t.is_peer_recognition,
                   o.first_name AS observer_first, o.last_name AS observer_last
            FROM touchpoints t
            LEFT JOIN staff o ON LOWER(o.email)=LOWER(t.observer_email)
            WHERE LOWER(t.teacher_email)=LOWER(%s)
              AND t.school_year=%s
              AND t.status='published'
              AND COALESCE(t.is_peer_recognition, FALSE) = FALSE
            ORDER BY t.observed_at DESC
            LIMIT %s
        """, (me_email, school_year, limit))
        rows = cur.fetchall()

        # Quick stats: observation count + avg, celebration count
        cur.execute("""
            SELECT COUNT(*) AS n FROM touchpoints
            WHERE LOWER(teacher_email)=LOWER(%s) AND school_year=%s
              AND status='published' AND form_type LIKE 'observation%%'
        """, (me_email, school_year))
        obs_count = cur.fetchone()['n']

        cur.execute("""
            SELECT AVG(sc.score)::numeric(4,2) AS avg
            FROM scores sc
            JOIN touchpoints t ON sc.touchpoint_id = t.id
            WHERE LOWER(t.teacher_email)=LOWER(%s) AND t.school_year=%s
              AND t.status='published' AND t.form_type LIKE 'observation%%'
              AND sc.dimension_code IN ('T1','T2','T3','T4','T5')
        """, (me_email, school_year))
        avg_row = cur.fetchone()
        obs_avg = float(avg_row['avg']) if avg_row and avg_row.get('avg') else None

        cur.execute("""
            SELECT COUNT(*) AS n FROM touchpoints
            WHERE LOWER(teacher_email)=LOWER(%s) AND school_year=%s
              AND status='published' AND form_type='celebrate'
              AND COALESCE(is_peer_recognition, FALSE) = FALSE
        """, (me_email, school_year))
        formal_celeb_count = cur.fetchone()['n']

        return jsonify({
            'school_year': school_year,
            'stats': {
                'observations': obs_count,
                'observation_avg': obs_avg,
                'formal_celebrations': formal_celeb_count,
            },
            'activity': [
                {
                    'id': str(r['id']),
                    'form_type': r['form_type'],
                    'observed_at': r['observed_at'].isoformat() if r.get('observed_at') else None,
                    'notes': (r.get('notes') or '')[:240],
                    'observer_name': f"{r.get('observer_first','')} {r.get('observer_last','')}".strip() or r.get('observer_email',''),
                }
                for r in rows
            ],
        })
    finally:
        conn.close()


@app.route('/api/me/shoutouts')
@require_auth
def api_me_shoutouts():
    """Peer celebrations sent + received by the current user. These do NOT
    show up on supervisor dashboards."""
    user = get_current_user()
    me_email = user['email'] if user else DEV_USER_EMAIL
    school_year = (request.args.get('school_year') or '2025-2026').strip()
    limit = int(request.args.get('limit', 20))

    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Received (subject = me, peer flag set, observer != me)
        cur.execute("""
            SELECT t.id, t.notes, t.observed_at, t.observer_email,
                   o.first_name AS f, o.last_name AS l
            FROM touchpoints t
            LEFT JOIN staff o ON LOWER(o.email)=LOWER(t.observer_email)
            WHERE LOWER(t.teacher_email)=LOWER(%s)
              AND LOWER(t.observer_email) != LOWER(%s)
              AND t.school_year=%s
              AND t.form_type='celebrate'
              AND t.status='published'
              AND COALESCE(t.is_peer_recognition, FALSE) = TRUE
            ORDER BY t.observed_at DESC LIMIT %s
        """, (me_email, me_email, school_year, limit))
        received = [
            {
                'id': str(r['id']),
                'notes': r.get('notes') or '',
                'at': r['observed_at'].isoformat() if r.get('observed_at') else None,
                'from_name': f"{r.get('f','')} {r.get('l','')}".strip() or r.get('observer_email',''),
                'from_email': r.get('observer_email', ''),
            }
            for r in cur.fetchall()
        ]

        # Sent (observer = me, peer flag set, subject != me)
        cur.execute("""
            SELECT t.id, t.notes, t.observed_at, t.teacher_email,
                   s.first_name AS f, s.last_name AS l
            FROM touchpoints t
            LEFT JOIN staff s ON LOWER(s.email)=LOWER(t.teacher_email)
            WHERE LOWER(t.observer_email)=LOWER(%s)
              AND LOWER(t.teacher_email) != LOWER(%s)
              AND t.school_year=%s
              AND t.form_type='celebrate'
              AND t.status='published'
              AND COALESCE(t.is_peer_recognition, FALSE) = TRUE
            ORDER BY t.observed_at DESC LIMIT %s
        """, (me_email, me_email, school_year, limit))
        sent = [
            {
                'id': str(r['id']),
                'notes': r.get('notes') or '',
                'at': r['observed_at'].isoformat() if r.get('observed_at') else None,
                'to_name': f"{r.get('f','')} {r.get('l','')}".strip() or r.get('teacher_email',''),
                'to_email': r.get('teacher_email', ''),
            }
            for r in cur.fetchall()
        ]
        return jsonify({'received': received, 'sent': sent})
    finally:
        conn.close()


@app.route('/api/touchpoints', methods=['POST'])
@require_auth
@require_no_impersonation
def api_save_touchpoint():
    user = get_current_user()
    data = request.get_json()
    # Role gates on submission — return 200 with authorized:false + reason
    # so the frontend can render Friendly403 (no raw 403 errors per memory rule).
    if data.get('form_type') in HR_DOC_FORM_TYPES and not _can_file_hr_doc(user):
        return jsonify({'authorized': False, 'reason': 'role', 'message': 'PIPs and Write-Ups can only be filed by school leadership, network staff, or HR.'})
    if (data.get('form_type') or '').startswith(PMAP_FORM_TYPE_PREFIX) and not _can_file_pmap(user):
        return jsonify({'authorized': False, 'reason': 'role', 'message': 'PMAPs can only be filed by supervisors and HR.'})
    data['observer_email'] = user['email'] if user else DEV_USER_EMAIL
    # Honor school_year from request body (e.g., test cohort submits with '2026-2027')
    # Fall back to CURRENT_SCHOOL_YEAR if not provided
    if not data.get('school_year'):
        data['school_year'] = CURRENT_SCHOOL_YEAR

    # Auto-classify celebrations as peer (shoutout) vs formal at submit time.
    # Formal: observer is the subject's supervisor OR an admin. Counts in
    # supervisor dashboards.
    # Peer: anyone else celebrating anyone. Lives on Teacher Home shoutouts
    # wall; does NOT count in formal supervisor dashboards.
    if data.get('form_type') == 'celebrate' and data.get('teacher_email'):
        is_peer = True
        if user and user.get('is_admin'):
            is_peer = False
        elif data['observer_email'].lower() == data['teacher_email'].lower():
            is_peer = True  # self-celebrate is always peer
        else:
            try:
                conn_x = db.get_conn()
                try:
                    cur_x = conn_x.cursor()
                    cur_x.execute(
                        "SELECT supervisor_email FROM staff WHERE LOWER(email)=LOWER(%s)",
                        (data['teacher_email'],),
                    )
                    row = cur_x.fetchone()
                    if row and row[0] and row[0].lower() == data['observer_email'].lower():
                        is_peer = False
                finally:
                    conn_x.close()
            except Exception as e:
                log.error(f"is_peer lookup failed, defaulting to peer: {e}")
        data['is_peer_recognition'] = is_peer

    # Draft paradigm: if no id and no explicit new-row intent, try reusing an active draft
    # for (observer, teacher, form_type). If one exists, update in place instead of creating.
    if not data.get('id') and data.get('teacher_email') and data.get('form_type'):
        existing = db.find_active_draft(
            data['observer_email'], data['teacher_email'], data['form_type']
        )
        if existing:
            try:
                db.update_touchpoint(existing['id'], data['observer_email'], data)
                # Mirror the action-step creation path below
                steps = data.get('action_steps_selected') or []
                if steps and data.get('status') == 'published':
                    conn = db.get_conn()
                    try:
                        cur = conn.cursor()
                        for s in steps:
                            cur.execute("""
                                INSERT INTO action_steps (type, teacher_email, creator_email,
                                    observation_grow_id, body_text, school_year, created_at, last_modified)
                                VALUES ('actionStep', %s, %s, %s, %s, %s, NOW(), NOW())
                            """, (data['teacher_email'], data['observer_email'], existing['id'],
                                  s.get('action', '')[:1000], data['school_year']))
                        conn.commit()
                    finally:
                        conn.close()
                return jsonify({'id': existing['id'], 'reused_draft': True})
            except Exception as e:
                return jsonify({'error': str(e)}), 500

    try:
        tp_id = db.save_touchpoint(data)
        # Create action step assignments if provided
        steps = data.get('action_steps_selected') or []
        if steps:
            conn = db.get_conn()
            try:
                cur = conn.cursor()
                for s in steps:
                    cur.execute("""
                        INSERT INTO action_steps (type, teacher_email, creator_email,
                            observation_grow_id, body_text, school_year, created_at, last_modified)
                        VALUES ('actionStep', %s, %s, %s, %s, %s, NOW(), NOW())
                    """, (data['teacher_email'], data['observer_email'], tp_id,
                          s.get('action', '')[:1000], data['school_year']))
                conn.commit()
            finally:
                conn.close()
        return jsonify({'id': tp_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# API: AI Insights — natural language → SQL → results
# ------------------------------------------------------------------

INSIGHTS_SCHEMA = """
PostgreSQL schema. Use ONLY these tables and these EXACT column names —
no shortened variants (e.g. teacher_email, NOT teacher; observer_email, NOT observer).

TABLE staff (aliased as s):
  - email TEXT  (primary key, join target for touchpoints.teacher_email and touchpoints.observer_email)
  - first_name TEXT
  - last_name TEXT
  - job_title TEXT
  - school TEXT
  - job_function TEXT  (values: Teacher, Leadership, Network, Support, Operations)
  - supervisor_email TEXT
  - hire_date DATE
  - is_active BOOLEAN

TABLE touchpoints (aliased as t):
  - id UUID  (primary key)
  - form_type TEXT
  - teacher_email TEXT  (who the touchpoint is ABOUT — join: t.teacher_email = s.email)
  - observer_email TEXT  (who CREATED it — also FK to staff.email)
  - school TEXT
  - school_year TEXT  (format '2025-2026'; current year is '2026-2027')
  - observed_at TIMESTAMPTZ
  - status TEXT  (values: 'published', 'draft' — almost always filter to published)
  - notes TEXT
  - feedback TEXT  (PLAINTEXT coaching narrative pulled from Grow. Non-null for ~8,600 imported records. Search with ILIKE '%keyword%'.)
  - feedback_json JSONB  (STRUCTURED coaching narrative. Shape: {grow_id, narrative: [{measurement, text}], checkboxes_selected: [{measurement, selected}], comments: []}. To search narrative: WHERE feedback_json::text ILIKE '%keyword%', OR iterate with jsonb_array_elements. Prefer the plaintext 'feedback' column for keyword searches — simpler.)
  - grow_id TEXT  (stable Grow observation ID)

  form_type values (use LIKE patterns for groups):
    observation_teacher, observation_fundamentals, observation_prek,
    pmap_teacher, pmap_leader, pmap_prek, pmap_support, pmap_network,
    self_reflection_teacher, self_reflection_leader, self_reflection_prek,
    self_reflection_support, self_reflection_network,
    quick_feedback, celebrate, write_up, iap, solicited_feedback,
    meeting_quick_meeting, "meeting_data_meeting_(relay)"
  HINT: "meetings" → form_type LIKE 'meeting_%'
  HINT: "observations" → form_type LIKE 'observation_%'
  HINT: "pmaps" → form_type LIKE 'pmap_%'
  HINT: "self-reflections" → form_type LIKE 'self_reflection_%'

TABLE scores (aliased as sc):
  - id SERIAL  (primary key)
  - touchpoint_id UUID  (FK → touchpoints.id; join: sc.touchpoint_id = t.id)
  - dimension_code TEXT
  - dimension_name TEXT
  - score NUMERIC
  - cycle INTEGER

  dimension_code values: T1=On Task, T2=Community of Learners,
    T3=Essential Content, T4=Cognitive Engagement, T5=Demonstration of Learning,
    L1-L5 (Leadership), PK1-PK10 (PreK CLASS), M1-M5 (Fundamentals on-task % by minute)

Schools: Arthur Ashe Charter School, Langston Hughes Academy,
  Phillis Wheatley Community School, Samuel J Green Charter School, FirstLine Network

=== NAMING / MATCHING RULES ===

1. When a user names a person (first name, last name, or both), match LIBERALLY:
   - "Charlotte" → s.first_name ILIKE 'Charlotte%' OR s.last_name ILIKE 'Charlotte%'
   - "Ida Smith" → s.first_name ILIKE 'Ida%' AND s.last_name ILIKE 'Smith%'
   - ALWAYS include first_name, last_name, email in the SELECT so duplicates/ambiguity is visible in results

2. For "how many X has Y had/done", check BOTH roles:
   - "observations has Charlotte completed" (Charlotte is OBSERVER): filter on observer_email matching Charlotte
   - "observations has Charlotte received" (Charlotte is TEACHER): filter on teacher_email matching Charlotte
   - If ambiguous, UNION or COUNT both and label clearly

3. Default to current school year only when user says "this year" or doesn't specify a time.
   If user says "ever" / "all time" / "historical", do NOT filter by school_year.

4. Always filter status='published' unless user asks about drafts.

=== EXAMPLES (exact patterns that work) ===

Q: "How many observations has Charlotte Steele completed?"
SELECT COUNT(*) AS total
FROM touchpoints t
JOIN staff s ON t.observer_email = s.email
WHERE s.first_name ILIKE 'Charlotte%' AND s.last_name ILIKE 'Steele%'
  AND t.form_type LIKE 'observation_%'
  AND t.school_year = '2026-2027'
  AND t.status = 'published';

Q: "How many meetings has Ida had this year?"
SELECT COUNT(*) AS total, s.first_name, s.last_name, s.email
FROM touchpoints t
JOIN staff s ON t.teacher_email = s.email
WHERE s.first_name ILIKE 'Ida%'
  AND t.form_type LIKE 'meeting_%'
  AND t.school_year = '2026-2027'
  AND t.status = 'published'
GROUP BY s.first_name, s.last_name, s.email;

Q: "Which teachers got feedback about cold calling?"
SELECT DISTINCT s.first_name, s.last_name, s.email, s.school, COUNT(t.id) AS mentions
FROM touchpoints t
JOIN staff s ON t.teacher_email = s.email
WHERE t.feedback ILIKE '%cold call%'
  AND t.school_year = '2026-2027'
  AND t.status = 'published'
GROUP BY s.first_name, s.last_name, s.email, s.school
ORDER BY mentions DESC
LIMIT 20;

Q: "Top observers this year"
SELECT s.first_name, s.last_name, s.email, COUNT(*) AS touchpoints
FROM touchpoints t
JOIN staff s ON t.observer_email = s.email
WHERE t.school_year = '2026-2027' AND t.status = 'published'
GROUP BY s.first_name, s.last_name, s.email
ORDER BY touchpoints DESC LIMIT 20;

Q: "Who hasn't been observed in 30+ days?"
SELECT s.first_name, s.last_name, s.email, s.school,
       MAX(t.observed_at) AS last_observed
FROM staff s
LEFT JOIN touchpoints t ON s.email = t.teacher_email
  AND t.form_type LIKE 'observation_%'
  AND t.status = 'published'
WHERE s.is_active AND s.job_function = 'Teacher'
GROUP BY s.first_name, s.last_name, s.email, s.school
HAVING MAX(t.observed_at) IS NULL OR MAX(t.observed_at) < NOW() - INTERVAL '30 days'
ORDER BY last_observed ASC NULLS FIRST LIMIT 50;

Q: "Average scores by school this year"
SELECT t.school, sc.dimension_code, ROUND(AVG(sc.score)::numeric, 2) AS avg_score
FROM touchpoints t
JOIN scores sc ON sc.touchpoint_id = t.id
WHERE t.school_year = '2026-2027' AND t.status = 'published'
  AND sc.dimension_code IN ('T1','T2','T3','T4','T5')
GROUP BY t.school, sc.dimension_code
ORDER BY t.school, sc.dimension_code;

Q: "Which school has the most energetic feedback?"
-- For qualitative questions about feedback content, search with ILIKE and aggregate
SELECT t.school, COUNT(*) AS mentions
FROM touchpoints t
WHERE (t.feedback ILIKE '%energy%' OR t.feedback ILIKE '%engaging%' OR t.feedback ILIKE '%enthusias%')
  AND t.school_year = '2026-2027' AND t.status = 'published'
GROUP BY t.school ORDER BY mentions DESC;
"""

@app.route('/api/insights', methods=['POST'])
@require_auth
def api_insights():
    # Scope gate: AI Insights generates SQL against the full DB. Until we
    # auto-inject WHERE-clauses to scope by accessible_emails, restrict to
    # admins only — otherwise any teacher could query anyone's PMAP scores.
    user = get_current_user()
    if user and not user.get('is_admin') and not DEV_MODE:
        return jsonify({'authorized': False,
                        'error': 'Insights is currently in admin preview. Coming soon for everyone.'})
    data = request.get_json()
    question = (data.get('question') or '').strip()
    if not question:
        return jsonify({'error': 'No question provided'}), 400

    try:
        # Gemini via Vertex AI — uses ADC from Cloud Run service account.
        from google import genai
        from google.genai import types as genai_types

        gcp_project = os.environ.get('GCP_PROJECT', 'talent-demo-482004')
        gcp_location = os.environ.get('GCP_LOCATION', 'us-central1')
        gen_client = genai.Client(vertexai=True, project=gcp_project, location=gcp_location)

        def strip_fences(s):
            s = (s or '').strip()
            if s.startswith('```'):
                s = s.split('\n', 1)[1] if '\n' in s else s[3:]
            if s.endswith('```'):
                s = s[:-3]
            # Defensive: Gemini sometimes emits doubled percent signs in LIKE
            # patterns (historical artifact of f-string escaping in the schema
            # prompt). Collapse to single % so Postgres LIKE actually matches.
            s = s.replace('%%', '%')
            return s.strip()

        def validate_sql(sql):
            """Return (ok, error_message). SELECT-only guardrail."""
            u = sql.upper().strip()
            if not u.startswith('SELECT') and not u.startswith('WITH'):
                return False, 'must start with SELECT or WITH'
            forbidden = ['INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'ALTER ',
                         'CREATE ', 'TRUNCATE ', 'GRANT ', 'REVOKE ', 'MERGE ']
            padded = ' ' + u + ' '
            for kw in forbidden:
                if f' {kw}' in padded:
                    return False, f'forbidden keyword: {kw.strip()}'
            return True, None

        def gen_sql(question, prior_attempt=None, prior_error=None):
            """Ask Gemini for SQL. If prior_attempt/prior_error are set,
            include them so it corrects the mistake."""
            base = f"""You are a SQL expert for a K-12 teacher observation database (PostgreSQL).

{INSIGHTS_SCHEMA}

User question: "{question}"

Generate ONLY a SELECT query to answer this question. Rules:
- Only SELECT statements. No INSERT, UPDATE, DELETE, DROP, ALTER, or CREATE.
- Use proper JOINs between tables with the exact column names above.
- Limit results to 50 rows max.
- Return useful columns with clear aliases.
- If the question can't be answered from this schema, return: SELECT 'Question cannot be answered from available data' as error

Return ONLY the SQL. No explanation, no markdown fences, no comments."""
            if prior_attempt and prior_error:
                base += f"""

Your previous attempt failed with a PostgreSQL error:
  Attempt: {prior_attempt}
  Error:   {prior_error}

Fix it. Use ONLY the exact column names listed in the schema above. Do NOT invent columns."""
            resp = gen_client.models.generate_content(
                model='gemini-2.5-pro',
                contents=base,
                config=genai_types.GenerateContentConfig(
                    max_output_tokens=4000,
                    temperature=0,
                ),
            )
            return strip_fences(resp.text or '')

        # First attempt
        sql = gen_sql(question)
        ok, verr = validate_sql(sql)
        if not ok:
            return jsonify({'error': f'Invalid SQL: {verr}', 'sql': sql}), 400

        # Execute — on DB error, feed error back to Gemini for ONE retry.
        attempts = [sql]
        conn = db.get_conn()
        try:
            cur = conn.cursor()
            try:
                cur.execute(sql)
            except psycopg2.Error as pg_err:
                conn.rollback()
                err_text = str(pg_err).split('\n', 1)[0][:300]
                retry_sql = gen_sql(question, prior_attempt=sql, prior_error=err_text)
                ok, verr = validate_sql(retry_sql)
                if not ok:
                    return jsonify({'error': f'Retry produced invalid SQL: {verr}',
                                    'sql': retry_sql, 'first_attempt': sql}), 400
                attempts.append(retry_sql)
                sql = retry_sql
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

            # Summarize results
            summary_prompt = f"""The user asked: "{question}"

The query returned {len(results)} rows with columns: {columns}

First 10 rows: {json.dumps(results[:10])}

Write a brief, clear 1-3 sentence answer to the user's question based on these results. Be specific with numbers. Do not mention SQL or databases."""

            sum_resp = gen_client.models.generate_content(
                model='gemini-2.5-pro',
                contents=summary_prompt,
                config=genai_types.GenerateContentConfig(
                    max_output_tokens=500,
                    temperature=0.2,
                ),
            )
            answer = (sum_resp.text or '').strip()

            return jsonify({
                'question': question,
                'answer': answer,
                'sql': sql,
                'columns': columns,
                'rows': results[:50],
                'total': len(results),
                'attempts': len(attempts),  # 1 = first try worked; 2 = retry succeeded
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
# Document upload — Phase 1 foundation
# 3 GCS buckets: short (90-day lifecycle) / exemplar / hr-locked (7-year)
# Direct-to-GCS via signed URLs. Polymorphic uploads table links to any parent.
# ------------------------------------------------------------------

UPLOAD_BUCKETS = {
    'short':     'op-uploads-short',
    'exemplar':  'op-exemplars',
    'hr-locked': 'op-hr-locked',
}
UPLOAD_MAX_BYTES = 100 * 1024 * 1024  # 100 MB per file
ALLOWED_MIME_PREFIXES = ('image/', 'video/', 'audio/')
ALLOWED_MIME_EXACT = {
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
}


def _mime_allowed(mime):
    m = (mime or '').lower()
    if any(m.startswith(p) for p in ALLOWED_MIME_PREFIXES):
        return True
    return m in ALLOWED_MIME_EXACT


def _bucket_for_parent(parent_type, form_type=None):
    """HR docs (PIP/WriteUp/Acknowledge) lock; everything else short-bucket."""
    HR_FORM_TYPES = {'performance_improvement_plan', 'iap', 'write_up'}
    if parent_type == 'acknowledgment':
        return 'hr-locked'
    if parent_type == 'touchpoint' and form_type in HR_FORM_TYPES:
        return 'hr-locked'
    return 'short'


def _gcs_client():
    from google.cloud import storage
    return storage.Client(project=PROJECT_ID)


def _generate_signed_url(blob, *, method, expiration, content_type=None, response_disposition=None):
    """Generate a v4 signed URL that works on Cloud Run (no private key locally).
    Falls back to IAM Sign Blob via the runtime service account."""
    import google.auth
    from google.auth.transport import requests as g_requests
    creds, _ = google.auth.default()
    if hasattr(creds, 'service_account_email') and (
        creds.service_account_email == 'default'
        or not getattr(creds, '_signing_credentials', None)
    ):
        creds.refresh(g_requests.Request())
    sa_email = getattr(creds, 'service_account_email', None) or os.environ.get(
        'GOOGLE_SERVICE_ACCOUNT', '965913991496-compute@developer.gserviceaccount.com'
    )
    kwargs = dict(
        version='v4',
        expiration=expiration,
        method=method,
        service_account_email=sa_email,
        access_token=creds.token,
    )
    if content_type:
        kwargs['content_type'] = content_type
    if response_disposition:
        kwargs['response_disposition'] = response_disposition
    return blob.generate_signed_url(**kwargs)


@app.route('/api/uploads/sign', methods=['POST'])
@require_auth
def api_uploads_sign():
    """Generate a signed PUT URL for direct-to-GCS upload.
    Body: { parent_type, parent_id, filename, mime_type, size, form_type? }.
    Returns: { upload_url, upload_id, gcs_path, bucket, expires_in }."""
    user = get_current_user()
    saver_email = user['email'] if user else DEV_USER_EMAIL
    body = request.get_json() or {}
    parent_type = (body.get('parent_type') or '').strip()
    parent_id = (body.get('parent_id') or '').strip()
    filename = (body.get('filename') or '').strip()
    mime_type = (body.get('mime_type') or 'application/octet-stream').strip()
    size = int(body.get('size') or 0)
    form_type = (body.get('form_type') or '').strip()

    if parent_type not in ('touchpoint', 'goal', 'assignment', 'acknowledgment'):
        return jsonify({'error': 'invalid parent_type'}), 400
    if not parent_id or not filename:
        return jsonify({'error': 'parent_id and filename required'}), 400
    if size <= 0 or size > UPLOAD_MAX_BYTES:
        return jsonify({'error': f'size must be 1..{UPLOAD_MAX_BYTES} bytes'}), 400
    if not _mime_allowed(mime_type):
        return jsonify({'error': f'mime type {mime_type} not allowed'}), 400

    bucket_key = _bucket_for_parent(parent_type, form_type)
    bucket_name = UPLOAD_BUCKETS[bucket_key]

    # Path: <year>/<month>/<uuid>__<safe_filename>
    from datetime import datetime, timedelta
    import uuid as _uuid, re as _re
    safe_name = _re.sub(r'[^A-Za-z0-9._-]', '_', filename)[:120]
    obj_uuid = str(_uuid.uuid4())
    now = datetime.utcnow()
    gcs_object = f"{now.year}/{now.month:02d}/{obj_uuid}__{safe_name}"

    # Pre-record in DB so finalize is just a state flip + size verify
    delete_at = now + timedelta(days=90) if bucket_key == 'short' else None
    conn = db.get_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO uploads (id, parent_type, parent_id, bucket, gcs_path, filename, mime_type, size_bytes, uploaded_by, delete_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
        """, (obj_uuid, parent_type, parent_id, bucket_key,
              f"{bucket_name}/{gcs_object}", filename, mime_type, size, saver_email, delete_at))
        upload_id = cur.fetchone()[0]
        conn.commit()
    finally:
        conn.close()

    try:
        client = _gcs_client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(gcs_object)
        upload_url = _generate_signed_url(
            blob, method='PUT', expiration=timedelta(minutes=10), content_type=mime_type,
        )
    except Exception as e:
        log.error(f"signed url generation failed: {e}")
        return jsonify({'error': 'signed url generation failed'}), 500

    return jsonify({
        'upload_id': str(upload_id),
        'upload_url': upload_url,
        'gcs_path': f"{bucket_name}/{gcs_object}",
        'bucket': bucket_key,
        'expires_in': 600,
        'mime_type': mime_type,
    })


@app.route('/api/uploads/<upload_id>/finalize', methods=['POST'])
@require_auth
def api_uploads_finalize(upload_id):
    """Verify the GCS object exists + record finalize timestamp.
    Client calls this AFTER the PUT to the signed URL succeeds."""
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM uploads WHERE id=%s", (upload_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({'error': 'upload not found'}), 404
        bucket_name, _, obj_path = row['gcs_path'].partition('/')
        try:
            client = _gcs_client()
            blob = client.bucket(bucket_name).blob(obj_path)
            if not blob.exists():
                return jsonify({'error': 'gcs object missing — upload may have failed'}), 400
        except Exception as e:
            log.error(f"finalize verify failed: {e}")
            return jsonify({'error': 'verification failed'}), 500
        return jsonify({
            'id': str(row['id']),
            'parent_type': row['parent_type'],
            'parent_id': row['parent_id'],
            'bucket': row['bucket'],
            'filename': row['filename'],
            'mime_type': row['mime_type'],
            'size_bytes': row['size_bytes'],
        })
    finally:
        conn.close()


@app.route('/api/uploads')
@require_auth
def api_uploads_list():
    """List uploads for a parent record. ?parent_type=X&parent_id=Y"""
    parent_type = (request.args.get('parent_type') or '').strip()
    parent_id = (request.args.get('parent_id') or '').strip()
    if not parent_type or not parent_id:
        return jsonify([])
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT id, filename, mime_type, size_bytes, uploaded_by, uploaded_at,
                   bucket, delete_at, promoted_to
            FROM uploads
            WHERE parent_type=%s AND parent_id=%s AND archived_at IS NULL
            ORDER BY uploaded_at DESC
        """, (parent_type, parent_id))
        rows = cur.fetchall()
        return jsonify([
            {
                'id': str(r['id']),
                'filename': r['filename'],
                'mime_type': r['mime_type'],
                'size_bytes': r['size_bytes'],
                'uploaded_by': r['uploaded_by'],
                'uploaded_at': r['uploaded_at'].isoformat() if r['uploaded_at'] else None,
                'bucket': r['bucket'],
                'delete_at': r['delete_at'].isoformat() if r['delete_at'] else None,
                'promoted_to': r['promoted_to'],
            }
            for r in rows
        ])
    finally:
        conn.close()


@app.route('/api/uploads/<upload_id>/download')
@require_auth
def api_uploads_download(upload_id):
    """Generate a short-lived signed download URL for the file."""
    conn = db.get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM uploads WHERE id=%s AND archived_at IS NULL", (upload_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({'error': 'not found'}), 404
        bucket_name, _, obj_path = row['gcs_path'].partition('/')
        from datetime import timedelta
        try:
            client = _gcs_client()
            blob = client.bucket(bucket_name).blob(obj_path)
            url = _generate_signed_url(
                blob, method='GET', expiration=timedelta(minutes=5),
                response_disposition=f'attachment; filename="{row["filename"]}"',
            )
        except Exception as e:
            log.error(f"download signed url failed: {e}")
            return jsonify({'error': 'download url failed'}), 500
        return jsonify({'url': url, 'filename': row['filename'], 'expires_in': 300})
    finally:
        conn.close()


@app.route('/api/uploads/<upload_id>', methods=['DELETE'])
@require_auth
@require_no_impersonation
def api_uploads_delete(upload_id):
    """Soft-delete (archived_at). Bucket lifecycle handles hard delete on short bucket;
    HR-locked + exemplar buckets keep the object until explicit lifecycle change."""
    user = get_current_user()
    me = user['email'] if user else DEV_USER_EMAIL
    conn = db.get_conn()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE uploads SET archived_at=NOW() WHERE id=%s AND uploaded_by=%s", (upload_id, me))
        if cur.rowcount == 0:
            # Admin override
            if user and user.get('is_admin'):
                cur.execute("UPDATE uploads SET archived_at=NOW() WHERE id=%s", (upload_id,))
                if cur.rowcount == 0:
                    return jsonify({'error': 'not found'}), 404
            else:
                return jsonify({'error': 'not found or not yours'}), 404
        conn.commit()
        return jsonify({'archived': True})
    finally:
        conn.close()


# ------------------------------------------------------------------
# Run
# ------------------------------------------------------------------

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    debug = os.environ.get('FLASK_DEBUG', 'true').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug)
