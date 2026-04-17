"""
ObservationPoint — PostgreSQL schema setup.
Creates core tables for the observation/coaching platform.

Usage:
    python setup_postgres.py
"""
import os
import psycopg2

DB_HOST = os.environ.get('DB_HOST', '35.184.9.224')
DB_NAME = os.environ.get('DB_NAME', 'observationpoint')
DB_USER = os.environ.get('DB_USER', 'postgres')
DB_PASS = os.environ.get('DB_PASS', '')

SCHEMA = """

-- Staff (cached from staff_master_list, refreshed daily)
CREATE TABLE IF NOT EXISTS staff (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    first_name TEXT,
    last_name TEXT,
    employee_number INTEGER,
    job_title TEXT,
    job_function TEXT,
    school TEXT,
    department TEXT,
    supervisor_email TEXT,
    subject TEXT,
    grade_level TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_email ON staff(email);
CREATE INDEX IF NOT EXISTS idx_staff_school ON staff(school);

-- Touchpoints (every interaction: observations, PMAPs, meetings, feedback, etc.)
CREATE TABLE IF NOT EXISTS touchpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_type TEXT NOT NULL,
    teacher_email TEXT NOT NULL REFERENCES staff(email),
    observer_email TEXT NOT NULL REFERENCES staff(email),
    school TEXT,
    school_year TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'draft',
    is_published BOOLEAN DEFAULT FALSE,
    notes TEXT,
    feedback TEXT,
    audio_url TEXT,
    transcript TEXT,
    ai_analysis JSONB,
    grow_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tp_teacher ON touchpoints(teacher_email);
CREATE INDEX IF NOT EXISTS idx_tp_observer ON touchpoints(observer_email);
CREATE INDEX IF NOT EXISTS idx_tp_school_year ON touchpoints(school_year);
CREATE INDEX IF NOT EXISTS idx_tp_form_type ON touchpoints(form_type);
CREATE INDEX IF NOT EXISTS idx_tp_observed ON touchpoints(observed_at DESC);

-- Scores (dimension-level scores per touchpoint)
CREATE TABLE IF NOT EXISTS scores (
    id SERIAL PRIMARY KEY,
    touchpoint_id UUID NOT NULL REFERENCES touchpoints(id) ON DELETE CASCADE,
    dimension_code TEXT NOT NULL,
    dimension_name TEXT,
    score NUMERIC(4,2) NOT NULL,
    cycle INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scores_tp ON scores(touchpoint_id);
CREATE INDEX IF NOT EXISTS idx_scores_dim ON scores(dimension_code);

-- Action steps (coaching actions assigned to teachers)
CREATE TABLE IF NOT EXISTS action_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    touchpoint_id UUID REFERENCES touchpoints(id),
    teacher_email TEXT NOT NULL REFERENCES staff(email),
    assigned_by TEXT REFERENCES staff(email),
    dimension_code TEXT,
    action_text TEXT NOT NULL,
    category TEXT,
    status TEXT DEFAULT 'active',
    progress INTEGER DEFAULT 0,
    due_date DATE,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_as_teacher ON action_steps(teacher_email);
CREATE INDEX IF NOT EXISTS idx_as_status ON action_steps(status);

-- Goals (WIG + academic goals per teacher per year)
CREATE TABLE IF NOT EXISTS goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_email TEXT NOT NULL REFERENCES staff(email),
    school_year TEXT NOT NULL,
    goal_type TEXT NOT NULL,
    goal_text TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goals_teacher_year ON goals(teacher_email, school_year);

"""


def main():
    if not DB_PASS:
        print("Set DB_PASS environment variable")
        return

    conn = psycopg2.connect(host=DB_HOST, dbname=DB_NAME, user=DB_USER, password=DB_PASS)
    conn.autocommit = True
    cur = conn.cursor()

    for statement in SCHEMA.split(';'):
        stmt = statement.strip()
        if not stmt:
            continue
        try:
            cur.execute(stmt)
        except Exception as e:
            print(f"Error: {e}")
            print(f"  Statement: {stmt[:80]}...")

    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name
    """)
    tables = [r[0] for r in cur.fetchall()]
    print(f"Tables created: {', '.join(tables)}")

    for t in tables:
        cur.execute(f"SELECT COUNT(*) FROM {t}")
        print(f"  {t}: {cur.fetchone()[0]} rows")

    conn.close()
    print("Done.")


if __name__ == '__main__':
    main()
