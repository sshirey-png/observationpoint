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
    def derive_form_type(rubric_name, type_name):
        rn = (rubric_name or '').lower()
        tn = (type_name or '').lower()
        ft = 'observation_teacher'
        if 'prek' in rn or 'pre-k' in rn:
            ft = 'observation_prek'
        if 'fundamental' in rn:
            ft = 'observation_fundamentals'
        if 'pmap' in tn:
            ft = 'pmap_teacher'
            if 'prek' in rn: ft = 'pmap_prek'
            elif 'leader' in rn: ft = 'pmap_leader'
            elif 'non-instructional' in rn or 'support' in rn: ft = 'pmap_support'
            elif 'network' in rn: ft = 'pmap_network'
        if 'self-reflection' in tn or 'self reflection' in tn:
            ft = 'self_reflection_teacher'
            if 'prek' in rn: ft = 'self_reflection_prek'
            elif 'leader' in rn: ft = 'self_reflection_leader'
            elif 'network' in rn: ft = 'self_reflection_network'
            elif 'non-instructional' in rn or 'support' in rn: ft = 'self_reflection_support'
        return ft

    strip_tags = re.compile(r'<[^>]+>')

    def extract_narrative(obs):
        narrative = []
        checkboxes_selected = []
        for s in obs.get('observationScores', []) or []:
            mid = s.get('measurement', '')
            # textBoxes — the coaching narrative lives here
            for tb in s.get('textBoxes', []) or []:
                val = tb.get('value')
                if val:
                    txt = html.unescape(strip_tags.sub('', val)).strip()
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
        return {
            'grow_id': obs.get('_id'),
            'narrative': narrative,
            'checkboxes_selected': checkboxes_selected,
            'comments': comments,
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
                # Write feedback_json + feedback to each matching tp
                for row in rows:
                    cur.execute("""
                        UPDATE touchpoints
                        SET feedback_json = %s, feedback = %s
                        WHERE id = %s
                    """, (json.dumps(payload), plain_text or None, row['id']))
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
