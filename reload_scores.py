"""
ObservationPoint — Reload scores from local Grow dump with correct form_type.

Reads grow_all_observations.json (local), re-extracts dimension scores using
rubric.name for form type detection (the only reliable signal — older records
have observationType as an ID string only). Truncates + reloads the scores table.

Usage:
    python reload_scores.py --dry-run     # Show breakdown, don't touch BQ
    python reload_scores.py --year 2024-2025  # Reload one year only
    python reload_scores.py               # Full reload, 2021-2026
"""
import os
import sys
import json
import uuid
import logging
import argparse
from datetime import datetime, timezone
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

PROJECT_ID = 'talent-demo-482004'
DATASET = 'observationpoint'
DUMP_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'grow_all_observations.json')
MAP_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'grow_measurement_map.json')

DEFAULT_YEARS = {'2021-2022', '2022-2023', '2023-2024', '2024-2025', '2025-2026'}


def load_measurement_map():
    with open(MAP_PATH) as f:
        data = json.load(f)
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
                lookup[mid] = {'code': dim_code, 'name': dim_info['name'], 'cycle': cycle}
    log.info(f"Measurement map: {len(lookup)} IDs mapped")
    return lookup


def get_school_year(date_str):
    if not date_str:
        return 'unknown'
    try:
        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        yr = dt.year if dt.month >= 7 else dt.year - 1
        return f"{yr}-{yr+1}"
    except Exception:
        return 'unknown'


def detect_form_type(rubric_name):
    """Map rubric.name to form_type. Strips [ARCHIVE] prefix so old versions classify too."""
    if not rubric_name:
        return 'unknown'
    rn = rubric_name.lower().replace('[archive]', '').strip()

    # PMAPs
    if 'pmap' in rn or 'performance map' in rn or 'performance review' in rn:
        if 'leader' in rn:
            return 'pmap_leader'
        if 'non-instructional' in rn or 'non instructional' in rn or 'support' in rn:
            return 'pmap_support'
        if 'network' in rn:
            return 'pmap_network'
        if 'prek' in rn or 'pre-k' in rn:
            return 'pmap_prek'
        return 'pmap_teacher'

    # Self reflections
    if 'self reflection' in rn or 'self-reflection' in rn:
        if 'leader' in rn:
            return 'self_reflection_leader'
        if 'non-instructional' in rn or 'non instructional' in rn or 'support' in rn:
            return 'self_reflection_support'
        if 'network' in rn:
            return 'self_reflection_network'
        if 'prek' in rn or 'pre-k' in rn:
            return 'self_reflection_prek'
        return 'self_reflection_teacher'

    # Fundamentals
    if 'fundamental' in rn:
        return 'observation_fundamentals'

    # PreK / CLASS
    if 'prek' in rn or 'pre-k' in rn or 'class' in rn:
        return 'observation_prek'

    # Observations
    if 'observation' in rn or 'feedback form' in rn or 'walk' in rn:
        return 'observation_teacher'

    # Discipline
    if 'write up' in rn or 'write-up' in rn:
        return 'discipline_writeup'
    if 'iap' in rn or 'improvement action' in rn:
        return 'discipline_iap'

    # Meetings
    if 'coaching' in rn or 'check-in' in rn or 'check in' in rn or 'priorities' in rn:
        return 'meeting_coaching'

    # Goals / lesson plans / other artifacts — skip from scores
    if 'goal' in rn or 'lesson plan' in rn:
        return 'artifact'

    return 'unknown'


def extract_scores(observations, measurement_map, year_filter=None):
    scores = []
    form_type_counts = {}
    rubric_unknown = {}
    skipped_no_scores = 0
    skipped_year = 0
    skipped_no_dims = 0
    skipped_artifact = 0

    for obs in observations:
        observed_at = obs.get('observedAt', obs.get('created', ''))
        school_year = get_school_year(observed_at)

        if year_filter:
            if isinstance(year_filter, set):
                if school_year not in year_filter:
                    skipped_year += 1
                    continue
            elif school_year != year_filter:
                skipped_year += 1
                continue

        obs_scores = obs.get('observationScores', [])
        if not obs_scores:
            skipped_no_scores += 1
            continue

        teacher = obs.get('teacher', {})
        if isinstance(teacher, str):
            teacher = {'_id': teacher, 'email': '', 'name': ''}
        teacher_email = teacher.get('email', '')
        teacher_name = teacher.get('name', '')

        rubric = obs.get('rubric', {})
        rubric_name = rubric.get('name', '') if isinstance(rubric, dict) else ''

        school_info = obs.get('teachingAssignment', {})
        school = ''
        if isinstance(school_info, dict):
            s = school_info.get('school', {})
            school = s.get('name', '') if isinstance(s, dict) else ''

        form_type = detect_form_type(rubric_name)

        if form_type == 'artifact':
            skipped_artifact += 1
            continue
        if form_type == 'unknown':
            rubric_unknown[rubric_name] = rubric_unknown.get(rubric_name, 0) + 1

        obs_date = observed_at[:10] if observed_at else None
        tp_id = str(uuid.uuid4())

        dims_found = 0
        for s in obs_scores:
            mid = s.get('measurement', '')
            value = s.get('valueScore')
            if value is None or mid not in measurement_map:
                continue
            dim = measurement_map[mid]
            dims_found += 1
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

        if dims_found == 0:
            skipped_no_dims += 1
        else:
            form_type_counts[form_type] = form_type_counts.get(form_type, 0) + 1

    log.info(f"Extracted {len(scores)} dimension scores from {sum(form_type_counts.values())} records")
    log.info(f"Skipped: year={skipped_year}, no_scores={skipped_no_scores}, no_dims_mapped={skipped_no_dims}, artifacts={skipped_artifact}")

    log.info("\nForm type breakdown (records with dimension scores):")
    for ft, c in sorted(form_type_counts.items(), key=lambda x: -x[1]):
        log.info(f"  {c:6d}  {ft}")

    if rubric_unknown:
        log.warning("\nRubric names that didn't map to a form_type (top 20):")
        for rn, c in sorted(rubric_unknown.items(), key=lambda x: -x[1])[:20]:
            log.warning(f"  {c:5d}  {rn}")

    return scores


def truncate_scores(client):
    q = f"TRUNCATE TABLE `{PROJECT_ID}.{DATASET}.scores`"
    log.info(f"Truncating: {q}")
    client.query(q).result()
    log.info("Scores table truncated")


def load_scores(client, scores):
    table_ref = f"{PROJECT_ID}.{DATASET}.scores"
    batch_size = 5000
    total = 0
    for i in range(0, len(scores), batch_size):
        batch = scores[i:i+batch_size]
        errors = client.insert_rows_json(table_ref, batch)
        if errors:
            log.error(f"Insert errors (batch {i//batch_size}): {errors[:3]}")
            raise RuntimeError("Insert failed")
        total += len(batch)
        log.info(f"Loaded {total} of {len(scores)}")
    log.info(f"Total scores loaded: {total}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='Show breakdown, do not touch BQ')
    ap.add_argument('--year', help='Only one school year (default: 2021-2026)')
    ap.add_argument('--all-years', action='store_true', help='Include all years, not just 2021-2026')
    args = ap.parse_args()

    log.info("=" * 60)
    log.info("ObservationPoint — Reload Scores (local dump, rubric.name detection)")
    log.info("=" * 60)

    log.info(f"Reading {DUMP_PATH}...")
    with open(DUMP_PATH) as f:
        observations = json.load(f)
    log.info(f"Loaded {len(observations)} observations from local dump")

    measurement_map = load_measurement_map()

    if args.year:
        year_filter = args.year
    elif args.all_years:
        year_filter = None
    else:
        year_filter = DEFAULT_YEARS

    scores = extract_scores(observations, measurement_map, year_filter=year_filter)

    if args.dry_run:
        log.info("\nDRY RUN — not touching BigQuery")
        return

    if not scores:
        log.warning("No scores to load")
        return

    client = bigquery.Client(project=PROJECT_ID)
    truncate_scores(client)
    load_scores(client, scores)

    log.info("=" * 60)
    log.info("DONE")
    log.info("=" * 60)


if __name__ == '__main__':
    main()
