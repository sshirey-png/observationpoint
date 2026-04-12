"""
ObservationPoint — BigQuery Schema Setup
Run once to create the dataset and tables.

Data Model (from brainstorm 2026-04-12):
  touchpoints  — Every interaction: observations, meetings, quick feedback, PMAPs, self-reflections
  scores       — Normalized rubric scores from touchpoints (for trending and reporting)
  action_steps — Coaching tasks linked to touchpoints, teacher-facing
  goals        — WIG + annual goals per teacher per year
  discipline   — IAPs (PIPs), write-ups. Separate for access control / sensitivity.
"""
from google.cloud import bigquery
from config import PROJECT_ID, DATASET

client = bigquery.Client(project=PROJECT_ID)

# Create dataset (NO default table expiration — learned this the hard way)
dataset_ref = f"{PROJECT_ID}.{DATASET}"
dataset = bigquery.Dataset(dataset_ref)
dataset.location = "US"
dataset.default_table_expiration_ms = None  # NEVER set expiration
try:
    client.create_dataset(dataset, exists_ok=True)
    # Double-check: remove any default expiration that might exist
    ds = client.get_dataset(dataset_ref)
    if ds.default_table_expiration_ms is not None:
        ds.default_table_expiration_ms = None
        client.update_dataset(ds, ["default_table_expiration_ms"])
        print(f"WARNING: Removed default table expiration from {dataset_ref}")
    print(f"Dataset {dataset_ref} ready.")
except Exception as e:
    print(f"Dataset error: {e}")


# =================================================================
# TOUCHPOINTS — Every interaction between a leader and a teacher
# =================================================================
# form_type values:
#   observation_teacher, observation_prek, observation_fundamentals
#   pmap_teacher, pmap_prek, pmap_support, pmap_leader, pmap_network
#   self_reflection_teacher, self_reflection_prek, self_reflection_leader,
#   self_reflection_network, self_reflection_support
#   meeting_data_relay, meeting_o3, meeting_coaching
#   quick_feedback
# =================================================================
touchpoints_schema = [
    bigquery.SchemaField("id", "STRING", mode="REQUIRED", description="UUID primary key"),
    bigquery.SchemaField("form_type", "STRING", description="Type of touchpoint (observation_teacher, pmap_teacher, meeting_o3, quick_feedback, etc.)"),
    bigquery.SchemaField("rubric_id", "STRING", description="Rubric config used (fls_teacher_v1, fls_prek_class_v1, etc.)"),
    bigquery.SchemaField("school_year", "STRING", description="School year (e.g., 2025-2026)"),

    # Who
    bigquery.SchemaField("observer_email", "STRING", description="Person who conducted the touchpoint"),
    bigquery.SchemaField("observer_name", "STRING"),
    bigquery.SchemaField("teacher_id", "STRING", description="Employee number from UKG"),
    bigquery.SchemaField("teacher_email", "STRING"),
    bigquery.SchemaField("teacher_name", "STRING"),
    bigquery.SchemaField("school", "STRING"),

    # When
    bigquery.SchemaField("touchpoint_date", "DATE", description="Date of the touchpoint"),
    bigquery.SchemaField("touchpoint_time", "TIME", description="Time of the touchpoint"),
    bigquery.SchemaField("duration_seconds", "INTEGER", description="Duration in seconds (for observations)"),

    # Recording / AI
    bigquery.SchemaField("has_recording", "BOOLEAN", description="Was audio recorded?"),
    bigquery.SchemaField("transcript", "STRING", description="Speech-to-text transcript"),
    bigquery.SchemaField("ai_summary", "STRING", description="AI-generated observation summary"),
    bigquery.SchemaField("ai_enabled", "BOOLEAN", description="Was AI assist turned on?"),

    # Status
    bigquery.SchemaField("status", "STRING", description="draft, published, completed"),

    # Form data (flexible JSON storage)
    bigquery.SchemaField("scores_json", "STRING", description="Rubric scores as JSON: {T1: 4, T2: 3, ...}"),
    bigquery.SchemaField("feedback_json", "STRING", description="Feedback fields as JSON: {see_it_success: ..., see_it_growth: ...}"),
    bigquery.SchemaField("context_json", "STRING", description="Context fields as JSON: {observation_purpose: ..., actmo: ...}"),
    bigquery.SchemaField("meeting_json", "STRING", description="Meeting-specific fields as JSON: {standard: ..., initial_mastery: ..., reteach_date: ...}"),
    bigquery.SchemaField("goals_json", "STRING", description="Goals snapshot as JSON: {wig: ..., wig_status: ..., ag1: ..., ag1_status: ...}"),
    bigquery.SchemaField("commitments_json", "STRING", description="Commitments as JSON: {strength: ..., growth: ...}"),
    bigquery.SchemaField("career_json", "STRING", description="Career/PD as JSON: {goals: ..., licenses: ...}"),
    bigquery.SchemaField("concerns_json", "STRING", description="Areas of concern as JSON: {types: [...], comments: ...}"),
    bigquery.SchemaField("cycle_info_json", "STRING", description="PreK cycle info as JSON (num_students, start_time, academic_content, etc.)"),
    bigquery.SchemaField("notes", "STRING", description="Free-form observation/meeting notes"),
    bigquery.SchemaField("timestamped_notes_json", "STRING", description="Timestamped notes as JSON array"),
    bigquery.SchemaField("payload_json", "STRING", description="Full raw submission payload (complete snapshot)"),

    # Participants (for meetings with multiple people)
    bigquery.SchemaField("participant_emails", "STRING", description="Comma-separated participant emails (meetings)"),
    bigquery.SchemaField("participant_names", "STRING", description="Comma-separated participant names (meetings)"),

    # Metadata
    bigquery.SchemaField("created_at", "TIMESTAMP"),
    bigquery.SchemaField("updated_at", "TIMESTAMP"),
    bigquery.SchemaField("published_at", "TIMESTAMP"),
]

tp_table = bigquery.Table(f"{dataset_ref}.touchpoints", schema=touchpoints_schema)
tp_table.time_partitioning = bigquery.TimePartitioning(field="created_at")
try:
    client.create_table(tp_table, exists_ok=True)
    print("Table touchpoints ready.")
except Exception as e:
    print(f"touchpoints error: {e}")


# =================================================================
# SCORES — Normalized rubric scores for trending and reporting
# =================================================================
# One row per dimension per touchpoint.
# Pulled from touchpoints that have rubric scores (observations, PMAPs).
# Enables: "Show me T1 trend over time" without parsing JSON.
# =================================================================
scores_schema = [
    bigquery.SchemaField("touchpoint_id", "STRING", mode="REQUIRED", description="Links to touchpoints.id"),
    bigquery.SchemaField("form_type", "STRING", description="Copied from touchpoint for easy filtering (observation_teacher, pmap_teacher, etc.)"),
    bigquery.SchemaField("rubric_id", "STRING", description="Which rubric config was used"),
    bigquery.SchemaField("teacher_email", "STRING"),
    bigquery.SchemaField("teacher_name", "STRING"),
    bigquery.SchemaField("school", "STRING"),
    bigquery.SchemaField("dimension_code", "STRING", description="Rubric dimension (T1, T2, PK1, L1, M1, FL, etc.)"),
    bigquery.SchemaField("dimension_name", "STRING", description="Human-readable name (On Task, Positive Climate, etc.)"),
    bigquery.SchemaField("score", "FLOAT", description="The score value"),
    bigquery.SchemaField("cycle", "INTEGER", description="Cycle number for PreK multi-cycle observations"),
    bigquery.SchemaField("touchpoint_date", "DATE", description="Date of the touchpoint (for trending)"),
    bigquery.SchemaField("school_year", "STRING"),
    bigquery.SchemaField("created_at", "TIMESTAMP"),
]

scores_table = bigquery.Table(f"{dataset_ref}.scores", schema=scores_schema)
try:
    client.create_table(scores_table, exists_ok=True)
    print("Table scores ready.")
except Exception as e:
    print(f"scores error: {e}")


# =================================================================
# ACTION STEPS — Coaching tasks linked to touchpoints
# =================================================================
# Can originate from any touchpoint (observation, meeting, PMAP).
# Includes Get Better Faster coaching prompts and RTC cues.
# Teacher-facing — teachers see their active action steps.
# =================================================================
action_steps_schema = [
    bigquery.SchemaField("id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("touchpoint_id", "STRING", description="Source touchpoint (observation, meeting, etc.)"),
    bigquery.SchemaField("teacher_email", "STRING"),
    bigquery.SchemaField("teacher_name", "STRING"),
    bigquery.SchemaField("assigned_by_email", "STRING", description="Leader who assigned the action step"),
    bigquery.SchemaField("assigned_by_name", "STRING"),

    # Action step content
    bigquery.SchemaField("category", "STRING", description="Get Better Faster category (e.g., Routines & Procedures)"),
    bigquery.SchemaField("rubric_dimension", "STRING", description="Related rubric dimension (T1, T2, etc.)"),
    bigquery.SchemaField("action_step", "STRING", description="The action step text"),
    bigquery.SchemaField("coaching_prompt", "STRING", description="Coaching question for the teacher"),
    bigquery.SchemaField("rtc_cue", "STRING", description="Real-time coaching cue for next visit"),
    bigquery.SchemaField("practice", "STRING", description="Practice activity description"),

    # Progress
    bigquery.SchemaField("progress_percent", "INTEGER", description="0=In Progress, 100=Mastered, -1=Not Mastered"),
    bigquery.SchemaField("progress_notes", "STRING", description="Notes on progress"),
    bigquery.SchemaField("status", "STRING", description="active, mastered, not_mastered, archived"),

    # Metadata
    bigquery.SchemaField("school_year", "STRING"),
    bigquery.SchemaField("school", "STRING"),
    bigquery.SchemaField("created_at", "TIMESTAMP"),
    bigquery.SchemaField("updated_at", "TIMESTAMP"),
    bigquery.SchemaField("completed_at", "TIMESTAMP"),
]

actions_table = bigquery.Table(f"{dataset_ref}.action_steps", schema=action_steps_schema)
try:
    client.create_table(actions_table, exists_ok=True)
    print("Table action_steps ready.")
except Exception as e:
    print(f"action_steps error: {e}")


# =================================================================
# GOALS — WIG + Annual Goals per teacher per year
# =================================================================
goals_schema = [
    bigquery.SchemaField("id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("teacher_email", "STRING"),
    bigquery.SchemaField("teacher_name", "STRING"),
    bigquery.SchemaField("school", "STRING"),
    bigquery.SchemaField("school_year", "STRING"),

    # Goal content
    bigquery.SchemaField("goal_type", "STRING", description="wig, annual_1, annual_2, annual_3"),
    bigquery.SchemaField("goal_text", "STRING"),
    bigquery.SchemaField("status", "INTEGER", description="1=Off Track, 2=On Track"),
    bigquery.SchemaField("progress_notes", "STRING"),

    # For rubric-linked goals (e.g., Attain a 3+ on T1 On Task)
    bigquery.SchemaField("rubric_dimension", "STRING", description="Target dimension (T1, T2, etc.)"),
    bigquery.SchemaField("target_score", "INTEGER", description="Target score to achieve"),

    # Metadata
    bigquery.SchemaField("created_at", "TIMESTAMP"),
    bigquery.SchemaField("updated_at", "TIMESTAMP"),
]

goals_table = bigquery.Table(f"{dataset_ref}.goals", schema=goals_schema)
try:
    client.create_table(goals_table, exists_ok=True)
    print("Table goals ready.")
except Exception as e:
    print(f"goals error: {e}")


# =================================================================
# DISCIPLINE — IAPs (PIPs), Write-ups
# =================================================================
# Separate table for access control and sensitivity.
# Only HR and the direct supervisor should see these.
# =================================================================
discipline_schema = [
    bigquery.SchemaField("id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("form_type", "STRING", description="iap, write_up"),
    bigquery.SchemaField("school_year", "STRING"),
    bigquery.SchemaField("teacher_email", "STRING"),
    bigquery.SchemaField("teacher_name", "STRING"),
    bigquery.SchemaField("school", "STRING"),
    bigquery.SchemaField("supervisor_email", "STRING"),
    bigquery.SchemaField("supervisor_name", "STRING"),

    # Content
    bigquery.SchemaField("reason", "STRING", description="Reason for discipline action"),
    bigquery.SchemaField("description", "STRING", description="Details of the issue"),
    bigquery.SchemaField("action_plan", "STRING", description="Improvement plan / corrective action"),
    bigquery.SchemaField("success_indicators", "STRING", description="Non-negotiable indicators of success"),
    bigquery.SchemaField("timeline", "STRING", description="Timeline for improvement"),
    bigquery.SchemaField("concern_areas_json", "STRING", description="JSON array: [Professionalism, Performance, Commitment]"),
    bigquery.SchemaField("payload_json", "STRING", description="Full form submission"),

    # Status
    bigquery.SchemaField("status", "STRING", description="active, resolved, escalated, closed"),

    # Metadata
    bigquery.SchemaField("created_at", "TIMESTAMP"),
    bigquery.SchemaField("updated_at", "TIMESTAMP"),
    bigquery.SchemaField("resolved_at", "TIMESTAMP"),
]

discipline_table = bigquery.Table(f"{dataset_ref}.discipline", schema=discipline_schema)
try:
    client.create_table(discipline_table, exists_ok=True)
    print("Table discipline ready.")
except Exception as e:
    print(f"discipline error: {e}")


print("\n" + "=" * 50)
print("ObservationPoint schema ready.")
print("5 tables: touchpoints, scores, action_steps, goals, discipline")
print("=" * 50)
