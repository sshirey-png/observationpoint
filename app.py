"""
ObservationPoint — Main Flask Application
AI-powered classroom observation and coaching platform.
Standalone for FirstLine Schools, designed to integrate into TalentPoint.
"""
import os
import json
import secrets
from flask import Flask, render_template, session, redirect, url_for, request, jsonify
from flask_cors import CORS

from config import tenant, schools, current_school_year, PROJECT_ID, DATASET
from auth import init_oauth, oauth, get_current_user, require_auth, can

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))
CORS(app)

# Initialize OAuth
init_oauth(app)

# Build version for cache busting
BUILD_VERSION = os.environ.get('BUILD_VERSION', '1')


# ------------------------------------------------------------------
# Auth Routes
# ------------------------------------------------------------------

@app.route('/login')
def login():
    cfg = tenant()
    return render_template('login.html', config=cfg, build=BUILD_VERSION)


@app.route('/auth/google')
def auth_google():
    redirect_uri = request.url_root.rstrip('/') + '/auth/callback'
    return oauth.google.authorize_redirect(redirect_uri)


@app.route('/auth/callback')
def auth_callback():
    token = oauth.google.authorize_access_token()
    userinfo = token.get('userinfo', {})
    email = userinfo.get('email', '')
    name = userinfo.get('name', '')

    # Determine role from staff list
    role = _get_user_role(email)

    session['user'] = {
        'email': email,
        'name': name,
        'picture': userinfo.get('picture', ''),
        'role': role,
    }
    return redirect(url_for('index'))


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


def _get_user_role(email):
    """Determine user role from staff_master_list_with_function."""
    try:
        from google.cloud import bigquery
        client = bigquery.Client(project=PROJECT_ID)
        sql = f"""
            SELECT job_title, location, job_function
            FROM `{PROJECT_ID}.talent_dashboard.staff_master_list_with_function`
            WHERE LOWER(email) = LOWER(@email) AND status = 'Active'
            LIMIT 1
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("email", "STRING", email),
            ]
        )
        rows = list(client.query(sql, job_config=job_config).result())
        if rows:
            jf = rows[0].get('job_function', '')
            jt = (rows[0].get('job_title', '') or '').lower()
            if any(t in jt for t in ['principal', 'dean', 'ap ', 'assistant principal']):
                return 'leader'
            if 'coordinator' in jt or 'coach' in jt:
                return 'observer'
            if jf == 'Leadership':
                return 'leader'
            if jf == 'Teacher':
                return 'teacher'
            return 'observer'
    except Exception:
        pass

    # Admin fallback for Scott
    if email.lower() in ['sshirey@firstlineschools.org']:
        return 'admin'
    return 'teacher'


# ------------------------------------------------------------------
# Cache Busting Redirect
# ------------------------------------------------------------------

@app.route('/')
def root():
    return redirect(url_for('index', v=BUILD_VERSION))


# ------------------------------------------------------------------
# Main App Route
# ------------------------------------------------------------------

@app.route('/app')
@require_auth
def index():
    user = get_current_user()
    cfg = tenant()
    return render_template('app.html',
        user=user,
        config=cfg,
        schools=schools(),
        school_year=current_school_year(),
        build=BUILD_VERSION,
    )


# ------------------------------------------------------------------
# API: Staff Search
# ------------------------------------------------------------------

@app.route('/api/staff/search')
@require_auth
def api_staff_search():
    q = request.args.get('q', '').strip()
    if len(q) < 2:
        return jsonify([])
    try:
        import db
        results = db.search_staff(q, limit=15)
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# API: Save Observation
# ------------------------------------------------------------------

@app.route('/api/observations', methods=['POST'])
@require_auth
def api_save_observation():
    user = get_current_user()
    data = request.get_json()
    data['observer_email'] = user['email']
    data['observer_name'] = user['name']
    data['school_year'] = current_school_year()

    try:
        import db
        obs_id = db.save_observation(data)

        # Save normalized scores
        if data.get('scores'):
            db.save_scores(obs_id, data.get('rubric_id', ''), data['scores'])

        return jsonify({'status': 'ok', 'id': obs_id})
    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500


# ------------------------------------------------------------------
# API: Get Observations
# ------------------------------------------------------------------

@app.route('/api/observations')
@require_auth
def api_get_observations():
    user = get_current_user()
    filters = {
        'school_year': request.args.get('school_year', current_school_year()),
        'limit': int(request.args.get('limit', 50)),
    }

    # Leaders see their observations; admins see all
    if user.get('role') not in ['admin']:
        filters['observer_email'] = user['email']

    if request.args.get('teacher_email'):
        filters['teacher_email'] = request.args['teacher_email']
    if request.args.get('school'):
        filters['school'] = request.args['school']

    try:
        import db
        results = db.get_observations(**filters)
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# API: Transcribe Audio
# ------------------------------------------------------------------

@app.route('/api/transcribe', methods=['POST'])
@require_auth
def api_transcribe():
    """Receive audio blob, transcribe via Google Cloud Speech-to-Text."""
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file'}), 400

    audio_file = request.files['audio']
    audio_bytes = audio_file.read()

    try:
        from google.cloud import speech
        client = speech.SpeechClient()

        audio = speech.RecognitionAudio(content=audio_bytes)
        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
            sample_rate_hertz=48000,
            language_code='en-US',
            enable_automatic_punctuation=True,
            enable_word_time_offsets=True,
            model='latest_long',
        )

        response = client.recognize(config=config, audio=audio)

        transcript = ''
        words = []
        for result in response.results:
            alt = result.alternatives[0]
            transcript += alt.transcript + ' '
            for word_info in alt.words:
                words.append({
                    'word': word_info.word,
                    'start': word_info.start_time.total_seconds(),
                    'end': word_info.end_time.total_seconds(),
                })

        return jsonify({
            'transcript': transcript.strip(),
            'words': words,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# API: AI Analysis
# ------------------------------------------------------------------

@app.route('/api/analyze', methods=['POST'])
@require_auth
def api_analyze():
    """Send transcript + rubric to Claude for analysis."""
    data = request.get_json()
    transcript = data.get('transcript', '')
    notes = data.get('notes', '')
    rubric_id = data.get('rubric_id', 'fls_teacher_v1')
    duration = data.get('duration_seconds', 0)

    if not transcript and not notes:
        return jsonify({'error': 'No transcript or notes provided'}), 400

    try:
        import anthropic

        # Load rubric config
        rubric_path = os.path.join(os.path.dirname(__file__), 'forms', f'rubric_teacher.json')
        with open(rubric_path) as f:
            rubric = json.load(f)

        # Load action steps
        actions_path = os.path.join(os.path.dirname(__file__), 'forms', 'action_steps_guide.json')
        with open(actions_path) as f:
            actions = json.load(f)

        # Load vision
        vision_path = os.path.join(os.path.dirname(__file__), 'forms', 'fls_vision.json')
        with open(vision_path) as f:
            vision = json.load(f)

        # Build prompt
        prompt = f"""You are an expert instructional coach analyzing a classroom observation for FirstLine Schools in New Orleans.

FIRSTLINE VISION OF EXCELLENT CLASSROOMS:
{json.dumps(vision['pillars'], indent=2)}

SCORING GUIDE:
- Few = Less than 50% of students
- Some = 51-75%
- Most = 76-90%
- All = 90-100%

RUBRIC DIMENSIONS:
{json.dumps([{{'code': d['code'], 'name': d['name'], 'question': d['question']}} for d in rubric['dimensions']], indent=2)}

SCALE: 1 (Needs Improvement) → 5 (Exemplary)

OBSERVATION DURATION: {int(duration // 60)} minutes {int(duration % 60)} seconds

OBSERVER NOTES:
{notes}

TRANSCRIPT:
{transcript if transcript else '(No audio transcript available)'}

Based on this evidence, provide:

1. **summary**: A 2-3 sentence summary of what was observed in the classroom.

2. **scores**: For each rubric dimension (t1_on_task through t5_demonstration), suggest a score (1-5) with a brief evidence-based rationale. Only suggest scores where you have sufficient evidence.

3. **strengths**: 2-3 specific strengths observed, with evidence.

4. **growth_areas**: 1-2 specific areas for growth, with evidence.

5. **action_step**: Recommend ONE specific action step from the Get Better Faster guide. Include:
   - category (e.g., "Routines & Procedures")
   - action (the specific step)
   - coaching_prompt (the question to ask the teacher)
   - rtc_cue (real-time coaching cue for next visit)

Respond in JSON format only."""

        client = anthropic.Anthropic()
        message = client.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=2000,
            messages=[{'role': 'user', 'content': prompt}],
        )

        # Parse response
        response_text = message.content[0].text
        # Try to extract JSON from response
        if '```json' in response_text:
            response_text = response_text.split('```json')[1].split('```')[0]
        elif '```' in response_text:
            response_text = response_text.split('```')[1].split('```')[0]

        analysis = json.loads(response_text)
        return jsonify(analysis)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# API: Rubric Configs
# ------------------------------------------------------------------

@app.route('/api/rubrics/<rubric_id>')
@require_auth
def api_get_rubric(rubric_id):
    """Return rubric configuration JSON."""
    safe_id = rubric_id.replace('..', '').replace('/', '')
    rubric_path = os.path.join(os.path.dirname(__file__), 'forms', f'rubric_{safe_id}.json')
    if not os.path.exists(rubric_path):
        # Try direct filename
        rubric_path = os.path.join(os.path.dirname(__file__), 'forms', f'{safe_id}.json')
    if not os.path.exists(rubric_path):
        return jsonify({'error': 'Rubric not found'}), 404

    with open(rubric_path) as f:
        return jsonify(json.load(f))


@app.route('/api/action-steps')
@require_auth
def api_get_action_steps():
    """Return action steps guide."""
    path = os.path.join(os.path.dirname(__file__), 'forms', 'action_steps_guide.json')
    with open(path) as f:
        return jsonify(json.load(f))


@app.route('/api/commitments')
@require_auth
def api_get_commitments():
    """Return FLS commitments."""
    path = os.path.join(os.path.dirname(__file__), 'forms', 'fls_commitments.json')
    with open(path) as f:
        return jsonify(json.load(f))


# ------------------------------------------------------------------
# Run
# ------------------------------------------------------------------

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=True)
