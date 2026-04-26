"""
ObservationPoint — Flask Application
"""
import os
import json
import logging
import smtplib
import psycopg2
import psycopg2.extras
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
              ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ
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
        conn.commit()
        conn.close()
        log.info("Startup migration: acknowledgment + recommended_goals ensured")
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
# HR doc gate — only Leadership, Network, or admins may file PIP / Write-Up
# ------------------------------------------------------------------
HR_DOC_FORM_TYPES = ('performance_improvement_plan', 'iap', 'write_up')

def _can_file_hr_doc(user):
    if not user:
        return False
    if user.get('is_admin'):
        return True
    jf = (user.get('job_function') or '').lower()
    return jf in ('leadership', 'network')


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
                'can_file_hr_doc': True,
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
                'job_function': user.get('job_function', ''),
                'is_admin': user.get('is_admin', False),
                'is_supervisor': is_supervisor(user),
                'can_file_hr_doc': _can_file_hr_doc(user),
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
            FROM assignments
            WHERE LOWER(teacher_email) = %s
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
            FROM assignments
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
            FROM assignments a
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
    # Role gate on HR doc updates — return 200 with authorized:false so the
    # frontend can render a friendly screen instead of a raw 403.
    if data.get('form_type') in HR_DOC_FORM_TYPES and not _can_file_hr_doc(user):
        return jsonify({'authorized': False, 'error': 'not authorized to file HR documents'})
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
            html = _celebrate_email_html(teacher, observer, tp_dict, commitments, personal_note)
            subject = f"You've been celebrated by {observer_name}"
        elif form_type in ('performance_improvement_plan', 'iap', 'write_up'):
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
            else:
                doc_label = 'Performance Improvement Plan'
                summary_bullets = [
                    {'label': 'Area(s) of Concern', 'value': ', '.join(fb.get('concerns') or [])},
                    {'label': 'Start Date', 'value': fb.get('start_date') or ''},
                    {'label': 'Review Date', 'value': fb.get('review_date') or ''},
                ]
            html = _hr_doc_email_html(doc_label, teacher, observer, tp_dict, ack_url, summary_bullets)
            subject = f'Action required: {doc_label} from {observer_name}'
        elif form_type == 'observation_fundamentals':
            cur.execute("""SELECT body_text FROM assignments
                           WHERE observation_grow_id::text = %s AND type = 'actionStep'""", (str(tp_id),))
            action_steps = [{'cat': '', 'action': r['body_text']} for r in cur.fetchall()]
            html = _fundamentals_email_html(teacher, observer, tp_dict, action_steps, tp.get('notes', '') or '')
            subject = f'New Fundamentals observation from {observer_name}'
        else:
            # Generic touchpoint email — observation, PMAP, meeting, SR, QF, SF
            html = _generic_touchpoint_email_html(form_label, teacher, observer, tp_dict)
            subject = f'New {form_label} from {observer_name}'

        # SAFETY: test-mode submissions NEVER reach the actual teacher.
        # Email goes only to the observer (tester) so real teachers aren't confused.
        if tp.get('is_test'):
            recipient = observer_email
            subject = '[TEST · would go to teacher] ' + subject
            cc = []
        else:
            recipient = tp['teacher_email']
            cc = [observer_email]
        ok = _send_email(recipient, subject, html, cc_emails=cc)
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

    recipients = ['sshirey@firstlineschools.org', 'talent@firstlineschools.org']
    ok = False
    for rcpt in recipients:
        try:
            if _send_email(rcpt, f'[OP Feedback] {subject}', html):
                ok = True
        except Exception as e:
            log.error(f'feedback email to {rcpt} failed: {e}')
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
        return jsonify({'saved': saved})
    except Exception as e:
        log.error(f"save goals failed: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


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


@app.route('/api/touchpoints', methods=['POST'])
@require_auth
@require_no_impersonation
def api_save_touchpoint():
    user = get_current_user()
    data = request.get_json()
    # Role gate: PIP and Write-Up are formal HR documents — restrict to
    # Leadership, Network, or admins. Return 200 with authorized:false so
    # the frontend can show a friendly screen (not a raw 403).
    if data.get('form_type') in HR_DOC_FORM_TYPES and not _can_file_hr_doc(user):
        return jsonify({'authorized': False, 'error': 'not authorized to file HR documents'})
    data['observer_email'] = user['email'] if user else DEV_USER_EMAIL
    # Honor school_year from request body (e.g., test cohort submits with '2026-2027')
    # Fall back to CURRENT_SCHOOL_YEAR if not provided
    if not data.get('school_year'):
        data['school_year'] = CURRENT_SCHOOL_YEAR

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
                                INSERT INTO assignments (type, teacher_email, creator_email,
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
                        INSERT INTO assignments (type, teacher_email, creator_email,
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
# Run
# ------------------------------------------------------------------

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    debug = os.environ.get('FLASK_DEBUG', 'true').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug)
