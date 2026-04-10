"""
ObservationPoint — BigQuery Schema Setup
Run once to create the dataset and tables.
"""
from google.cloud import bigquery
from config import PROJECT_ID, DATASET

client = bigquery.Client(project=PROJECT_ID)

# Create dataset
dataset_ref = f"{PROJECT_ID}.{DATASET}"
dataset = bigquery.Dataset(dataset_ref)
dataset.location = "US"
try:
    client.create_dataset(dataset, exists_ok=True)
    print(f"Dataset {dataset_ref} ready.")
except Exception as e:
    print(f"Dataset error: {e}")

# --- observations table ---
obs_schema = [
    bigquery.SchemaField("id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("form_type", "STRING"),
    bigquery.SchemaField("rubric_id", "STRING"),
    bigquery.SchemaField("school_year", "STRING"),
    bigquery.SchemaField("observer_email", "STRING"),
    bigquery.SchemaField("observer_name", "STRING"),
    bigquery.SchemaField("teacher_id", "STRING"),
    bigquery.SchemaField("teacher_name", "STRING"),
    bigquery.SchemaField("teacher_email", "STRING"),
    bigquery.SchemaField("school", "STRING"),
    bigquery.SchemaField("observation_date", "STRING"),
    bigquery.SchemaField("duration_seconds", "INTEGER"),
    bigquery.SchemaField("has_recording", "BOOLEAN"),
    bigquery.SchemaField("transcript", "STRING"),
    bigquery.SchemaField("ai_summary", "STRING"),
    bigquery.SchemaField("ai_enabled", "BOOLEAN"),
    bigquery.SchemaField("status", "STRING"),  # draft, published
    bigquery.SchemaField("scores_json", "STRING"),
    bigquery.SchemaField("feedback_json", "STRING"),
    bigquery.SchemaField("context_json", "STRING"),
    bigquery.SchemaField("action_step_json", "STRING"),
    bigquery.SchemaField("payload_json", "STRING"),
    bigquery.SchemaField("created_at", "TIMESTAMP"),
    bigquery.SchemaField("updated_at", "TIMESTAMP"),
    bigquery.SchemaField("published_at", "TIMESTAMP"),
]

obs_table = bigquery.Table(f"{dataset_ref}.observations", schema=obs_schema)
obs_table.time_partitioning = bigquery.TimePartitioning(field="created_at")
try:
    client.create_table(obs_table, exists_ok=True)
    print("Table observations ready.")
except Exception as e:
    print(f"observations error: {e}")

# --- scores table (normalized for easy querying) ---
scores_schema = [
    bigquery.SchemaField("observation_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("rubric_id", "STRING"),
    bigquery.SchemaField("dimension_id", "STRING"),
    bigquery.SchemaField("dimension_code", "STRING"),
    bigquery.SchemaField("score", "FLOAT"),
    bigquery.SchemaField("cycle", "INTEGER"),  # for PreK multi-cycle
    bigquery.SchemaField("created_at", "TIMESTAMP"),
]

scores_table = bigquery.Table(f"{dataset_ref}.scores", schema=scores_schema)
try:
    client.create_table(scores_table, exists_ok=True)
    print("Table scores ready.")
except Exception as e:
    print(f"scores error: {e}")

# --- action_steps table ---
actions_schema = [
    bigquery.SchemaField("id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("observation_id", "STRING"),
    bigquery.SchemaField("teacher_email", "STRING"),
    bigquery.SchemaField("teacher_name", "STRING"),
    bigquery.SchemaField("observer_email", "STRING"),
    bigquery.SchemaField("category", "STRING"),
    bigquery.SchemaField("action_step", "STRING"),
    bigquery.SchemaField("coaching_prompt", "STRING"),
    bigquery.SchemaField("rtc_cue", "STRING"),
    bigquery.SchemaField("rubric_dimension", "STRING"),
    bigquery.SchemaField("progress_percent", "INTEGER"),
    bigquery.SchemaField("status", "STRING"),  # active, completed, archived
    bigquery.SchemaField("school_year", "STRING"),
    bigquery.SchemaField("created_at", "TIMESTAMP"),
    bigquery.SchemaField("updated_at", "TIMESTAMP"),
    bigquery.SchemaField("completed_at", "TIMESTAMP"),
]

actions_table = bigquery.Table(f"{dataset_ref}.action_steps", schema=actions_schema)
try:
    client.create_table(actions_table, exists_ok=True)
    print("Table action_steps ready.")
except Exception as e:
    print(f"action_steps error: {e}")

# --- goals table ---
goals_schema = [
    bigquery.SchemaField("id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("teacher_email", "STRING"),
    bigquery.SchemaField("teacher_name", "STRING"),
    bigquery.SchemaField("goal_type", "STRING"),  # wig, annual_1, annual_2, annual_3
    bigquery.SchemaField("goal_text", "STRING"),
    bigquery.SchemaField("status", "STRING"),  # off_track, on_track
    bigquery.SchemaField("progress_notes", "STRING"),
    bigquery.SchemaField("school_year", "STRING"),
    bigquery.SchemaField("created_at", "TIMESTAMP"),
    bigquery.SchemaField("updated_at", "TIMESTAMP"),
]

goals_table = bigquery.Table(f"{dataset_ref}.goals", schema=goals_schema)
try:
    client.create_table(goals_table, exists_ok=True)
    print("Table goals ready.")
except Exception as e:
    print(f"goals error: {e}")

# --- meetings table ---
meetings_schema = [
    bigquery.SchemaField("id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("title", "STRING"),
    bigquery.SchemaField("meeting_type", "STRING"),  # o3, pmap, coaching, other
    bigquery.SchemaField("date", "STRING"),
    bigquery.SchemaField("creator_email", "STRING"),
    bigquery.SchemaField("creator_name", "STRING"),
    bigquery.SchemaField("participant_emails", "STRING"),  # comma-separated
    bigquery.SchemaField("participant_names", "STRING"),
    bigquery.SchemaField("discussion_notes", "STRING"),
    bigquery.SchemaField("next_steps", "STRING"),
    bigquery.SchemaField("school_year", "STRING"),
    bigquery.SchemaField("created_at", "TIMESTAMP"),
    bigquery.SchemaField("updated_at", "TIMESTAMP"),
]

meetings_table = bigquery.Table(f"{dataset_ref}.meetings", schema=meetings_schema)
try:
    client.create_table(meetings_table, exists_ok=True)
    print("Table meetings ready.")
except Exception as e:
    print(f"meetings error: {e}")

# --- self_reflections table ---
sr_schema = [
    bigquery.SchemaField("id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("form_type", "STRING"),  # self_reflection_teacher, self_reflection_prek, etc.
    bigquery.SchemaField("rubric_id", "STRING"),
    bigquery.SchemaField("school_year", "STRING"),
    bigquery.SchemaField("teacher_email", "STRING"),
    bigquery.SchemaField("teacher_name", "STRING"),
    bigquery.SchemaField("school", "STRING"),
    bigquery.SchemaField("reflection_period", "STRING"),  # sr1, sr2
    bigquery.SchemaField("scores_json", "STRING"),
    bigquery.SchemaField("strengths", "STRING"),
    bigquery.SchemaField("growth_areas", "STRING"),
    bigquery.SchemaField("commitment_strengths", "STRING"),
    bigquery.SchemaField("commitment_growth", "STRING"),
    bigquery.SchemaField("career_goals", "STRING"),
    bigquery.SchemaField("licenses_certs", "STRING"),
    bigquery.SchemaField("payload_json", "STRING"),
    bigquery.SchemaField("status", "STRING"),  # draft, submitted
    bigquery.SchemaField("created_at", "TIMESTAMP"),
    bigquery.SchemaField("updated_at", "TIMESTAMP"),
    bigquery.SchemaField("submitted_at", "TIMESTAMP"),
]

sr_table = bigquery.Table(f"{dataset_ref}.self_reflections", schema=sr_schema)
try:
    client.create_table(sr_table, exists_ok=True)
    print("Table self_reflections ready.")
except Exception as e:
    print(f"self_reflections error: {e}")

print("\nAll tables created. ObservationPoint schema ready.")
