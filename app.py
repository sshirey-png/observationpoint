"""
ObservationPoint — Flask Application
"""
import os
import json
import secrets
from flask import Flask, session, redirect, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix
from auth import init_oauth, oauth, get_current_user, require_auth
import db

app = Flask(__name__, static_folder='prototypes', static_url_path='/static')
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))
CORS(app)
init_oauth(app)

BUILD_VERSION = os.environ.get('BUILD_VERSION', '1')
ALLOWED_DOMAIN = 'firstlineschools.org'
DEV_MODE = os.environ.get('DEV_MODE', 'false').lower() == 'true'
DEV_USER_EMAIL = os.environ.get('DEV_USER_EMAIL', 'sshirey@firstlineschools.org')


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

    try:
        staff = db.get_staff_by_email(email)
    except Exception:
        staff = None
    session['user'] = {
        'email': email,
        'name': userinfo.get('name', ''),
        'picture': userinfo.get('picture', ''),
        'school': staff.get('school', '') if staff else '',
        'job_title': staff.get('job_title', '') if staff else '',
        'job_function': staff.get('job_function', '') if staff else '',
    }
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
        cur.execute('SELECT 1')
        conn.close()
        return jsonify({'status': 'ok', 'db': 'connected', 'socket': db.DB_SOCKET or 'none'})
    except Exception as e:
        return jsonify({'status': 'error', 'db': str(e), 'socket': db.DB_SOCKET or 'none'}), 500


@app.route('/api/auth/status')
def auth_status():
    if DEV_MODE:
        return jsonify({
            'authenticated': True,
            'user': {'email': DEV_USER_EMAIL, 'name': 'Dev User', 'picture': ''}
        })
    user = get_current_user()
    if user:
        return jsonify({'authenticated': True, 'user': user})
    return jsonify({'authenticated': False})


# ------------------------------------------------------------------
# Pages — serve prototypes as the frontend
# ------------------------------------------------------------------

@app.route('/')
def index():
    if not DEV_MODE and not get_current_user():
        return redirect('/login')
    req_v = request.args.get('_v', '')
    if req_v != BUILD_VERSION:
        return redirect(f'/?_v={BUILD_VERSION}')
    return send_from_directory('prototypes', 'index.html')


@app.route('/<path:page>.html')
def serve_page(page):
    if not DEV_MODE and not get_current_user():
        return redirect('/login')
    return send_from_directory('prototypes', f'{page}.html')


# ------------------------------------------------------------------
# API: Teacher History (profile + my-team pages)
# ------------------------------------------------------------------

@app.route('/api/my-team')
@require_auth
def api_my_team():
    user = get_current_user()
    email = user['email'] if user else ''
    data = db.get_my_team(email)
    return jsonify(data)


@app.route('/api/teacher_history')
@require_auth
def api_teacher_history():
    teacher = request.args.get('teacher')
    school = request.args.get('school')
    data = db.get_teacher_history(teacher_email=teacher, school=school)
    return jsonify(data)


@app.route('/api/teacher/<email>')
@require_auth
def api_teacher_profile(email):
    data = db.get_teacher_history(teacher_email=email)
    teacher = data.get('teachers', {}).get(email.lower())
    if not teacher:
        staff = db.get_staff_by_email(email)
        if not staff:
            return jsonify({'error': 'Not found'}), 404
        teacher = {
            'email': staff['email'], 'name': f"{staff.get('first_name','')} {staff.get('last_name','')}".strip(),
            'school': staff.get('school', ''), 'job_function': staff.get('job_function', ''),
            'touchpoints': [], 'touchpoint_count': 0, 'pmap_by_year': {}, 'last_observation_date': None,
        }
    return jsonify({'teacher': teacher, 'school_years': data.get('school_years', [])})


# ------------------------------------------------------------------
# API: Network Dashboard
# ------------------------------------------------------------------

@app.route('/api/network_dashboard')
@require_auth
def api_network_dashboard():
    return jsonify(db.get_network_dashboard())


# ------------------------------------------------------------------
# API: Staff Search
# ------------------------------------------------------------------

@app.route('/api/staff/search')
@require_auth
def api_staff_search():
    q = request.args.get('q', '').strip()
    if len(q) < 2:
        return jsonify([])
    return jsonify(db.search_staff(q, limit=15))


# ------------------------------------------------------------------
# API: Save Touchpoint
# ------------------------------------------------------------------

@app.route('/api/touchpoints', methods=['POST'])
@require_auth
def api_save_touchpoint():
    user = get_current_user()
    data = request.get_json()
    data['observer_email'] = user['email']
    data['school_year'] = '2025-2026'
    try:
        tp_id = db.save_touchpoint(data)
        return jsonify({'id': tp_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# API: Rubric + Form Configs
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
