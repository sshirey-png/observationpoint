"""
ObservationPoint — Pull Grow API Data (All Years)
Pulls observations with dimension-level scores from the Grow API
and loads into BigQuery scores table.

Usage:
    python pull_grow_api.py                    # Pull all data
    python pull_grow_api.py --year 2024-2025   # Pull one school year
    python pull_grow_api.py --test             # Pull 100 records to test
"""
import os
import sys
import json
import uuid
import base64
import logging
import argparse
from datetime import datetime, timezone
import requests
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

PROJECT_ID = 'talent-demo-482004'
DATASET = 'observationpoint'

# Grow API
GROW_BASE = 'https://grow-api.leveldata.com'
CLIENT_ID = os.environ.get('LDG_CLIENT_ID', '6fe43bd0-e8d1-4ce0-a9a9-2267c9a3df9b')
CLIENT_SECRET = os.environ.get('LDG_CLIENT_SECRET', '18eaec46-c6c9-4bcb-abf7-b36030485966')


def get_token():
    creds = base64.b64encode(f'{CLIENT_ID}:{CLIENT_SECRET}'.encode()).decode()
    r = requests.post(f'{GROW_BASE}/auth/client/token',
        headers={'Authorization': f'Basic {creds}', 'Content-Type': 'application/x-www-form-urlencoded'},
        timeout=30)
    if r.status_code != 200:
        raise Exception(f"Auth failed: {r.status_code} {r.text[:200]}")
    return r.json()['access_token']


def load_measurement_map():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'grow_measurement_map.json')
    with open(path) as f:
        data = json.load(f)

    # Build flat lookup: measurement_id → (dimension_code, dimension_name, cycle)
    lookup = {}
    for section_key, section in data.items():
        if section_key.startswith('_'):
            continue
        cycle = None
        if 'cycle1' in section_key:
            cycle = 1
        elif 'cycle2' in section_key:
            cycle = 2
        elif 'cycle3' in section_key:
            cycle = 3

        for dim_code, dim_info in section.items():
            for mid in dim_info.get('ids', []):
                lookup[mid] = {
                    'code': dim_code,
                    'name': dim_info['name'],
                    'cycle': cycle,
                }

    log.info(f"Measurement map: {len(lookup)} IDs mapped")
    return lookup


def get_school_year(date_str):
    if not date_str:
        return 'unknown'
    try:
        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        yr = dt.year if dt.month >= 7 else dt.year - 1
        return f"{yr}-{yr+1}"
    except:
        return 'unknown'


def pull_observations(token, limit=None):
    """Pull all observations from the Grow API with pagination."""
    headers = {'Authorization': f'Bearer {token}'}
    all_obs = []
    skip = 0
    page_size = 100

    log.info("Pulling observations from Grow API...")

    while True:
        r = requests.get(f'{GROW_BASE}/external/observations',
            headers=headers,
            params={'limit': page_size, 'skip': skip},
            timeout=60)

        if r.status_code != 200:
            log.error(f"API error at skip={skip}: {r.status_code}")
            break

        data = r.json()
        records = data.get('data', [])
        total = data.get('count', 0)

        if not records:
            break

        all_obs.extend(records)
        skip += page_size

        if skip % 1000 == 0 or len(records) < page_size:
            log.info(f"  Pulled {len(all_obs)} of {total} observations...")

        if limit and len(all_obs) >= limit:
            all_obs = all_obs[:limit]
            break

        if len(records) < page_size:
            break

    log.info(f"Total observations pulled: {len(all_obs)}")
    return all_obs


def extract_scores(observations, measurement_map, year_filter=None):
    """Extract dimension-level scores from observations."""
    scores = []
    touchpoints = []
    skipped_no_scores = 0
    skipped_year = 0

    for obs in observations:
        observed_at = obs.get('observedAt', obs.get('created', ''))
        school_year = get_school_year(observed_at)

        if year_filter and school_year != year_filter:
            skipped_year += 1
            continue

        obs_scores = obs.get('observationScores', [])
        if not obs_scores:
            skipped_no_scores += 1
            continue

        # Get teacher/observer info
        teacher = obs.get('teacher', {})
        if isinstance(teacher, str):
            teacher = {'_id': teacher, 'email': '', 'name': ''}
        teacher_email = teacher.get('email', '')
        teacher_name = teacher.get('name', '')

        observer = obs.get('observer', {})
        if isinstance(observer, str):
            observer = {'_id': observer, 'email': '', 'name': ''}

        rubric = obs.get('rubric', {})
        rubric_name = rubric.get('name', '') if isinstance(rubric, dict) else ''

        obs_type = obs.get('observationType', {})
        type_name = obs_type.get('name', '') if isinstance(obs_type, dict) else ''

        school_info = obs.get('teachingAssignment', {})
        school = ''
        if isinstance(school_info, dict):
            s = school_info.get('school', {})
            school = s.get('name', '') if isinstance(s, dict) else ''

        obs_date = observed_at[:10] if observed_at else None
        tp_id = str(uuid.uuid4())
        is_published = obs.get('isPublished', False)

        # Determine form type
        form_type = 'observation_teacher'
        rn = rubric_name.lower()
        tn = type_name.lower()
        if 'prek' in rn or 'pre-k' in rn:
            form_type = 'observation_prek'
        if 'fundamental' in rn:
            form_type = 'observation_fundamentals'
        if 'pmap' in tn:
            form_type = 'pmap_teacher'
            if 'prek' in rn:
                form_type = 'pmap_prek'
            elif 'leader' in rn:
                form_type = 'pmap_leader'
            elif 'non-instructional' in rn or 'support' in rn:
                form_type = 'pmap_support'
            elif 'network' in rn:
                form_type = 'pmap_network'
        if 'self-reflection' in tn or 'self reflection' in tn:
            form_type = 'self_reflection_teacher'
            if 'prek' in rn:
                form_type = 'self_reflection_prek'
            elif 'leader' in rn:
                form_type = 'self_reflection_leader'
            elif 'network' in rn:
                form_type = 'self_reflection_network'
            elif 'non-instructional' in rn or 'support' in rn:
                form_type = 'self_reflection_support'

        # Extract scores
        has_dimension_scores = False
        for s in obs_scores:
            mid = s.get('measurement', '')
            value = s.get('valueScore')

            if value is None or mid not in measurement_map:
                continue

            dim = measurement_map[mid]
            has_dimension_scores = True

            scores.append({
                'touchpoint_id': tp_id,
                'form_type': form_type,
                'rubric_id': rubric_name,
                'teacher_email': teacher_email,
                'teacher_name': teacher_name,
                'school': school,
                'dimension_code': dim['code'],
                'dimension_name': dim['name'],
                'score': float(value),
                'cycle': dim.get('cycle'),
                'touchpoint_date': obs_date,
                'school_year': school_year,
                'created_at': datetime.now(timezone.utc).isoformat(),
            })

    log.info(f"Extracted {len(scores)} dimension scores")
    log.info(f"Skipped: {skipped_no_scores} no scores, {skipped_year} wrong year")
    return scores


def load_scores(scores):
    """Load scores into BigQuery."""
    if not scores:
        log.warning("No scores to load")
        return

    client = bigquery.Client(project=PROJECT_ID)
    table_ref = f"{PROJECT_ID}.{DATASET}.scores"

    # Batch insert (max 10,000 per request)
    batch_size = 5000
    total_loaded = 0

    for i in range(0, len(scores), batch_size):
        batch = scores[i:i+batch_size]
        errors = client.insert_rows_json(table_ref, batch)
        if errors:
            log.error(f"Insert errors (batch {i//batch_size}): {errors[:3]}")
        else:
            total_loaded += len(batch)
            log.info(f"Loaded {total_loaded} of {len(scores)} scores...")

    log.info(f"Total scores loaded: {total_loaded}")


def main():
    parser = argparse.ArgumentParser(description='Pull Grow API data')
    parser.add_argument('--year', help='Filter by school year (e.g., 2024-2025)')
    parser.add_argument('--test', action='store_true', help='Pull only 100 records to test')
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("ObservationPoint — Grow API Historical Pull")
    if args.year:
        log.info(f"Filtering to school year: {args.year}")
    if args.test:
        log.info("TEST MODE — pulling 100 records only")
    log.info("=" * 60)

    # Load measurement map
    measurement_map = load_measurement_map()

    # Authenticate
    token = get_token()
    log.info("Authenticated with Grow API")

    # Pull observations
    limit = 100 if args.test else None
    observations = pull_observations(token, limit=limit)

    # Extract scores
    scores = extract_scores(observations, measurement_map, year_filter=args.year)

    # Show summary by school year
    years = {}
    for s in scores:
        sy = s['school_year']
        if sy not in years:
            years[sy] = {'scores': 0, 'teachers': set()}
        years[sy]['scores'] += 1
        years[sy]['teachers'].add(s['teacher_email'])

    log.info("\nScores by school year:")
    for sy in sorted(years.keys()):
        log.info(f"  {sy}: {years[sy]['scores']} scores, {len(years[sy]['teachers'])} teachers")

    # Load to BigQuery
    if scores and not args.test:
        load_scores(scores)
    elif args.test:
        log.info(f"TEST MODE — {len(scores)} scores extracted, not loading to BigQuery")
        # Show a few examples
        for s in scores[:5]:
            log.info(f"  {s['teacher_name']} | {s['form_type']} | {s['dimension_code']}: {s['score']} | {s['school_year']}")

    log.info("=" * 60)
    log.info("DONE")
    log.info("=" * 60)


if __name__ == '__main__':
    main()
