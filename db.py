"""
ObservationPoint — BigQuery Database Layer
Same pattern as TalentPoint for future integration.
"""
import json
import uuid
from datetime import datetime, timezone
from google.cloud import bigquery
from config import PROJECT_ID, DATASET, get_client


def _table(name):
    return f"{PROJECT_ID}.{DATASET}.{name}"


def generate_id():
    return str(uuid.uuid4())


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# --- Staff Lookup ---

def search_staff(query, limit=10):
    """Search staff by name for autocomplete. Uses staff_master_list_with_function."""
    client = get_client()
    sql = f"""
        SELECT
            employee_id,
            preferred_name_legal_name AS name,
            email,
            job_title,
            location AS school,
            job_function
        FROM `{PROJECT_ID}.talent_dashboard.staff_master_list_with_function`
        WHERE LOWER(preferred_name_legal_name) LIKE LOWER(@query)
            AND status = 'Active'
        ORDER BY preferred_name_legal_name
        LIMIT @limit
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("query", "STRING", f"%{query}%"),
            bigquery.ScalarQueryParameter("limit", "INT64", limit),
        ]
    )
    rows = client.query(sql, job_config=job_config).result()
    return [dict(row) for row in rows]


# --- Observations ---

def save_observation(data):
    """Save an observation to BigQuery."""
    client = get_client()
    row = {
        'id': data.get('id', generate_id()),
        'form_type': data['form_type'],
        'rubric_id': data['rubric_id'],
        'school_year': data['school_year'],
        'observer_email': data['observer_email'],
        'observer_name': data['observer_name'],
        'teacher_id': data.get('teacher_id'),
        'teacher_name': data['teacher_name'],
        'teacher_email': data.get('teacher_email'),
        'school': data['school'],
        'observation_date': data['observation_date'],
        'duration_seconds': data.get('duration_seconds'),
        'has_recording': data.get('has_recording', False),
        'transcript': data.get('transcript'),
        'ai_summary': data.get('ai_summary'),
        'status': data.get('status', 'draft'),
        'scores_json': json.dumps(data.get('scores', {})),
        'feedback_json': json.dumps(data.get('feedback', {})),
        'context_json': json.dumps(data.get('context', {})),
        'payload_json': json.dumps(data),
        'created_at': now_iso(),
        'updated_at': now_iso(),
        'published_at': None,
    }

    errors = client.insert_rows_json(_table('observations'), [row])
    if errors:
        raise Exception(f"BigQuery insert errors: {errors}")
    return row['id']


def save_scores(observation_id, rubric_id, scores, cycle=None):
    """Save individual rubric scores to normalized table for easy querying."""
    client = get_client()
    rows = []
    for dimension_id, score in scores.items():
        if score is not None:
            rows.append({
                'observation_id': observation_id,
                'rubric_id': rubric_id,
                'dimension_id': dimension_id,
                'score': score,
                'cycle': cycle,
                'created_at': now_iso(),
            })

    if rows:
        errors = client.insert_rows_json(_table('scores'), rows)
        if errors:
            raise Exception(f"BigQuery insert errors: {errors}")


def get_observations(observer_email=None, teacher_email=None, school=None,
                     school_year=None, status=None, limit=50):
    """Fetch observations with optional filters."""
    client = get_client()
    conditions = ["1=1"]
    params = []

    if observer_email:
        conditions.append("observer_email = @observer_email")
        params.append(bigquery.ScalarQueryParameter("observer_email", "STRING", observer_email))
    if teacher_email:
        conditions.append("teacher_email = @teacher_email")
        params.append(bigquery.ScalarQueryParameter("teacher_email", "STRING", teacher_email))
    if school:
        conditions.append("school = @school")
        params.append(bigquery.ScalarQueryParameter("school", "STRING", school))
    if school_year:
        conditions.append("school_year = @school_year")
        params.append(bigquery.ScalarQueryParameter("school_year", "STRING", school_year))
    if status:
        conditions.append("status = @status")
        params.append(bigquery.ScalarQueryParameter("status", "STRING", status))

    params.append(bigquery.ScalarQueryParameter("limit", "INT64", limit))

    sql = f"""
        SELECT *
        FROM `{_table('observations')}`
        WHERE {' AND '.join(conditions)}
        ORDER BY created_at DESC
        LIMIT @limit
    """
    job_config = bigquery.QueryJobConfig(query_parameters=params)
    rows = client.query(sql, job_config=job_config).result()
    return [dict(row) for row in rows]
