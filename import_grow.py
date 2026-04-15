"""
ObservationPoint — Import Grow Data Export
One script imports everything from the Grow JSON exports into BigQuery.

Usage:
    python import_grow.py C:/Users/sshirey/Desktop/Grow/

Imports: observations, meetings, informals (quick feedback),
         assignments (action steps), measurements (goals)
"""
import os
import sys
import json
import uuid
import re
import logging
from datetime import datetime, timezone
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

PROJECT_ID = 'talent-demo-482004'
DATASET = 'observationpoint'

client = bigquery.Client(project=PROJECT_ID)


def table(name):
    return f"{PROJECT_ID}.{DATASET}.{name}"


def gen_id():
    return str(uuid.uuid4())


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def strip_html(text):
    if not text:
        return text
    clean = re.sub(r'<[^>]+>', '', str(text))
    clean = clean.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'")
    return ' '.join(clean.split()).strip()


def load_json(path):
    with open(path, encoding='utf-8-sig') as f:
        return json.load(f)


def find_file(folder, prefix):
    """Find a JSON file in the folder matching the prefix."""
    for fname in os.listdir(folder):
        if fname.startswith(prefix) and fname.endswith('.json') and 'Copy' not in fname:
            return os.path.join(folder, fname)
    return None


def build_user_lookup(folder):
    """Build a lookup from Grow user _id to email/name."""
    path = find_file(folder, 'users-')
    if not path:
        log.warning("No users file found")
        return {}
    users = load_json(path)
    lookup = {}
    for u in users:
        uid = u.get('_id')
        if uid:
            lookup[uid] = {
                'email': u.get('email', ''),
                'name': u.get('name', ''),
                'school': u.get('defaultSchool', {}).get('name', '') if isinstance(u.get('defaultSchool'), dict) else '',
            }
    log.info(f"User lookup: {len(lookup)} users")
    return lookup


def get_user(lookup, user_data):
    """Extract user info from a Grow user object or ID."""
    if isinstance(user_data, dict):
        uid = user_data.get('_id', '')
        return {
            'email': user_data.get('email', lookup.get(uid, {}).get('email', '')),
            'name': user_data.get('name', lookup.get(uid, {}).get('name', '')),
        }
    elif isinstance(user_data, str):
        u = lookup.get(user_data, {})
        return {'email': u.get('email', ''), 'name': u.get('name', '')}
    return {'email': '', 'name': ''}


def get_school(obs):
    """Extract school name from observation."""
    ta = obs.get('teachingAssignment', {})
    if isinstance(ta, dict):
        school = ta.get('school', {})
        if isinstance(school, dict):
            return school.get('name', '')
    return ''


def import_observations(folder, users):
    """Import observations into touchpoints + scores tables."""
    rows_tp = []
    rows_sc = []

    # Find all observation files
    obs_files = [f for f in os.listdir(folder) if f.startswith('observations-') and f.endswith('.json') and 'Copy' not in f]

    all_obs = []
    for fname in obs_files:
        data = load_json(os.path.join(folder, fname))
        all_obs.extend(data)

    # Deduplicate by _id
    seen = set()
    unique_obs = []
    for o in all_obs:
        oid = o.get('_id')
        if oid and oid not in seen:
            seen.add(oid)
            unique_obs.append(o)

    log.info(f"Observations: {len(all_obs)} total, {len(unique_obs)} unique")

    for obs in unique_obs:
        observer = get_user(users, obs.get('observer', {}))
        teacher = get_user(users, obs.get('teacher', {}))
        school = get_school(obs)

        obs_type = obs.get('observationType', {})
        type_name = obs_type.get('name', '') if isinstance(obs_type, dict) else ''

        rubric = obs.get('rubric', {})
        rubric_name = rubric.get('name', '') if isinstance(rubric, dict) else ''

        # Determine form_type from observation type and rubric name
        form_type = 'observation_teacher'
        rn = rubric_name.lower()
        tn = type_name.lower()
        if 'prek' in rn or 'pre-k' in rn or 'pre k' in rn:
            form_type = 'observation_prek'
        if 'fundamental' in rn:
            form_type = 'observation_fundamentals'
        if 'pmap' in tn:
            form_type = 'pmap_teacher'
            if 'prek' in rn or 'pre-k' in rn:
                form_type = 'pmap_prek'
            elif 'leader' in rn:
                form_type = 'pmap_leader'
            elif 'non-instructional' in rn or 'support' in rn:
                form_type = 'pmap_support'
            elif 'network' in rn:
                form_type = 'pmap_network'
        if 'self-reflection' in tn or 'self reflection' in tn:
            form_type = 'self_reflection_teacher'
            if 'prek' in rn or 'pre-k' in rn:
                form_type = 'self_reflection_prek'
            elif 'leader' in rn:
                form_type = 'self_reflection_leader'
            elif 'network' in rn:
                form_type = 'self_reflection_network'
            elif 'non-instructional' in rn or 'support' in rn:
                form_type = 'self_reflection_support'
        if 'write' in tn.lower():
            form_type = 'write_up'
        if 'iap' in tn.lower() or 'improvement' in tn.lower():
            form_type = 'iap'

        observed_at = obs.get('observedAt') or obs.get('created', '')
        obs_date = observed_at[:10] if observed_at else None

        # Determine school year
        school_year = '2025-2026'
        if observed_at:
            try:
                dt = datetime.fromisoformat(observed_at.replace('Z', '+00:00'))
                yr = dt.year if dt.month >= 7 else dt.year - 1
                school_year = f"{yr}-{yr+1}"
            except:
                pass

        tp_id = gen_id()

        tp = {
            'id': tp_id,
            'form_type': form_type,
            'rubric_id': rubric_name,
            'school_year': school_year,
            'observer_email': observer['email'],
            'observer_name': observer['name'],
            'teacher_id': None,
            'teacher_email': teacher['email'],
            'teacher_name': teacher['name'],
            'school': school,
            'touchpoint_date': obs_date,
            'touchpoint_time': None,
            'duration_seconds': None,
            'has_recording': False,
            'transcript': None,
            'ai_summary': None,
            'ai_enabled': False,
            'status': 'published' if obs.get('isPublished') else 'draft',
            'scores_json': None,
            'feedback_json': None,
            'context_json': None,
            'meeting_json': None,
            'goals_json': None,
            'commitments_json': None,
            'career_json': None,
            'concerns_json': None,
            'cycle_info_json': None,
            'notes': None,
            'timestamped_notes_json': None,
            'payload_json': json.dumps({'grow_id': obs.get('_id'), 'grow_type': type_name, 'grow_rubric': rubric_name}),
            'participant_emails': None,
            'participant_names': None,
            'created_at': obs.get('created', now_iso()),
            'updated_at': obs.get('created', now_iso()),
            'published_at': obs.get('firstPublished'),
        }
        rows_tp.append(tp)

    # Load touchpoints
    if rows_tp:
        log.info(f"Loading {len(rows_tp)} touchpoints...")
        job_config = bigquery.LoadJobConfig(
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
        )
        errors = client.insert_rows_json(table('touchpoints'), rows_tp)
        if errors:
            log.error(f"Touchpoints insert errors: {errors[:3]}")
        else:
            log.info(f"Loaded {len(rows_tp)} touchpoints")

    return len(rows_tp)


def import_meetings(folder, users):
    """Import meetings into touchpoints table."""
    path = find_file(folder, 'meetings-')
    if not path:
        log.warning("No meetings file found")
        return 0

    meetings = load_json(path)
    rows = []

    for m in meetings:
        creator = get_user(users, m.get('creator', {}))

        # Get participants
        participants = m.get('participants', [])
        p_emails = []
        p_names = []
        teacher_email = ''
        teacher_name = ''
        for p in (participants if isinstance(participants, list) else []):
            u = get_user(users, p.get('user', p))
            if u['email']:
                p_emails.append(u['email'])
                p_names.append(u['name'])
                if not teacher_email and u['email'] != creator['email']:
                    teacher_email = u['email']
                    teacher_name = u['name']

        # Extract meeting notes from additionalFields
        discussion = ''
        next_steps = ''
        for af in (m.get('additionalFields', []) or []):
            if isinstance(af, dict):
                name = af.get('name', '')
                content = strip_html(af.get('content', ''))
                if 'discuss' in name.lower():
                    discussion = content
                elif 'next' in name.lower() or 'step' in name.lower():
                    next_steps = content

        meeting_type = m.get('type', {})
        type_name = meeting_type.get('name', '') if isinstance(meeting_type, dict) else ''

        meeting_date = m.get('date', m.get('created', ''))
        m_date = meeting_date[:10] if meeting_date else None

        school_year = '2025-2026'

        tp = {
            'id': gen_id(),
            'form_type': 'meeting_' + type_name.lower().replace(' ', '_') if type_name else 'meeting_o3',
            'rubric_id': None,
            'school_year': school_year,
            'observer_email': creator['email'],
            'observer_name': creator['name'],
            'teacher_id': None,
            'teacher_email': teacher_email,
            'teacher_name': teacher_name,
            'school': None,
            'touchpoint_date': m_date,
            'touchpoint_time': None,
            'duration_seconds': None,
            'has_recording': False,
            'transcript': None,
            'ai_summary': None,
            'ai_enabled': False,
            'status': 'completed',
            'scores_json': None,
            'feedback_json': None,
            'context_json': None,
            'meeting_json': json.dumps({'title': m.get('title', ''), 'discussion': discussion, 'next_steps': next_steps}),
            'goals_json': None,
            'commitments_json': None,
            'career_json': None,
            'concerns_json': None,
            'cycle_info_json': None,
            'notes': discussion,
            'timestamped_notes_json': None,
            'payload_json': json.dumps({'grow_id': m.get('_id'), 'grow_type': type_name}),
            'participant_emails': ', '.join(p_emails) if p_emails else None,
            'participant_names': ', '.join(p_names) if p_names else None,
            'created_at': m.get('created', now_iso()),
            'updated_at': m.get('lastModified', now_iso()),
            'published_at': None,
        }
        rows.append(tp)

    if rows:
        log.info(f"Loading {len(rows)} meetings...")
        errors = client.insert_rows_json(table('touchpoints'), rows)
        if errors:
            log.error(f"Meetings insert errors: {errors[:3]}")
        else:
            log.info(f"Loaded {len(rows)} meetings")

    return len(rows)


def import_informals(folder, users):
    """Import informal observations (quick feedback) into touchpoints."""
    path = find_file(folder, 'informals-')
    if not path:
        log.warning("No informals file found")
        return 0

    informals = load_json(path)
    rows = []

    for inf in informals:
        creator = get_user(users, inf.get('creator', {}))
        teacher = get_user(users, inf.get('teacher', inf.get('user', {})))

        note = strip_html(inf.get('note', inf.get('text', inf.get('content', ''))))

        tp = {
            'id': gen_id(),
            'form_type': 'quick_feedback',
            'rubric_id': None,
            'school_year': '2025-2026',
            'observer_email': creator['email'],
            'observer_name': creator['name'],
            'teacher_id': None,
            'teacher_email': teacher['email'],
            'teacher_name': teacher['name'],
            'school': None,
            'touchpoint_date': (inf.get('created', '') or '')[:10] or None,
            'touchpoint_time': None,
            'duration_seconds': None,
            'has_recording': False,
            'transcript': None,
            'ai_summary': None,
            'ai_enabled': False,
            'status': 'published',
            'scores_json': None,
            'feedback_json': json.dumps({'note': note}),
            'context_json': None,
            'meeting_json': None,
            'goals_json': None,
            'commitments_json': None,
            'career_json': None,
            'concerns_json': None,
            'cycle_info_json': None,
            'notes': note,
            'timestamped_notes_json': None,
            'payload_json': json.dumps({'grow_id': inf.get('_id')}),
            'participant_emails': None,
            'participant_names': None,
            'created_at': inf.get('created', now_iso()),
            'updated_at': inf.get('lastModified', now_iso()),
            'published_at': None,
        }
        rows.append(tp)

    if rows:
        log.info(f"Loading {len(rows)} quick feedback...")
        errors = client.insert_rows_json(table('touchpoints'), rows)
        if errors:
            log.error(f"Informals insert errors: {errors[:3]}")
        else:
            log.info(f"Loaded {len(rows)} quick feedback")

    return len(rows)


def import_assignments(folder, users):
    """Import assignments (action steps) into action_steps table."""
    path = find_file(folder, 'assignments-')
    if not path:
        log.warning("No assignments file found")
        return 0

    assignments = load_json(path)
    rows = []

    for a in assignments:
        if a.get('type') != 'actionStep':
            continue

        creator = get_user(users, a.get('creator', {}))
        teacher = get_user(users, a.get('user', {}))

        progress = a.get('progress', {}) or {}
        progress_pct = progress.get('percent', 0)

        status = 'active'
        if progress_pct == 100:
            status = 'mastered'
        elif progress_pct in [-1, -10]:
            status = 'not_mastered'

        name = strip_html(a.get('name', ''))

        row = {
            'id': gen_id(),
            'touchpoint_id': None,
            'teacher_email': teacher['email'],
            'teacher_name': teacher['name'],
            'assigned_by_email': creator['email'],
            'assigned_by_name': creator['name'],
            'category': None,
            'rubric_dimension': None,
            'action_step': name,
            'coaching_prompt': None,
            'rtc_cue': None,
            'practice': None,
            'progress_percent': progress_pct if progress_pct >= 0 else 0,
            'progress_notes': progress.get('justification', ''),
            'status': status,
            'school_year': '2025-2026',
            'school': None,
            'created_at': a.get('created', now_iso()),
            'updated_at': a.get('lastModified', now_iso()),
            'completed_at': None,
        }
        rows.append(row)

    if rows:
        log.info(f"Loading {len(rows)} action steps...")
        errors = client.insert_rows_json(table('action_steps'), rows)
        if errors:
            log.error(f"Action steps insert errors: {errors[:3]}")
        else:
            log.info(f"Loaded {len(rows)} action steps")

    return len(rows)


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else 'C:/Users/sshirey/Desktop/Grow/'

    log.info("=" * 60)
    log.info("ObservationPoint — Grow Data Import")
    log.info(f"Source: {folder}")
    log.info("=" * 60)

    # Build user lookup
    users = build_user_lookup(folder)

    # Import everything
    n_obs = import_observations(folder, users)
    n_meet = import_meetings(folder, users)
    n_inf = import_informals(folder, users)
    n_act = import_assignments(folder, users)

    log.info("=" * 60)
    log.info(f"IMPORT COMPLETE")
    log.info(f"  Observations/PMAPs/SRs: {n_obs}")
    log.info(f"  Meetings:               {n_meet}")
    log.info(f"  Quick Feedback:          {n_inf}")
    log.info(f"  Action Steps:            {n_act}")
    log.info(f"  TOTAL:                   {n_obs + n_meet + n_inf + n_act}")
    log.info("=" * 60)


if __name__ == '__main__':
    main()
