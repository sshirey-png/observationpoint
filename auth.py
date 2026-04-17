"""
ObservationPoint — Authentication & Authorization
Google OAuth + email-based org hierarchy.
Pattern from bigquery-dashboards/auth.py, adapted to use emails instead of names.
"""
import os
import logging
import functools
import psycopg2
from flask import session, redirect, request, jsonify

from config import (
    DEV_MODE, CPO_TITLE, C_TEAM_KEYWORDS, HR_TEAM_TITLES,
    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
)

log = logging.getLogger(__name__)

# OAuth setup
from authlib.integrations.flask_client import OAuth
oauth = OAuth()


def init_oauth(app):
    oauth.init_app(app)
    oauth.register(
        name='google',
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
        client_kwargs={'scope': 'openid email profile'},
    )


def get_current_user():
    return session.get('user')


def require_auth(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if DEV_MODE:
            return f(*args, **kwargs)
        user = get_current_user()
        if not user:
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Not authenticated'}), 401
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated


# --- Role checks ---

def is_cteam(job_title):
    if not job_title:
        return False
    title_lower = job_title.lower()
    return any(kw.lower() in title_lower for kw in C_TEAM_KEYWORDS)


def is_admin_title(job_title):
    """CPO, C-Team, or HR Team title."""
    if not job_title:
        return False
    return is_cteam(job_title) or job_title in HR_TEAM_TITLES


def is_admin_user(user):
    if not user:
        return False
    return user.get('is_admin', False)


# --- Org hierarchy (email-based recursive CTE) ---

def get_accessible_emails(conn, email, job_title):
    """
    Get all staff emails the user can access.
    Admins see everyone. Others see their recursive downline.
    """
    if is_admin_title(job_title):
        cur = conn.cursor()
        cur.execute("SELECT email FROM staff WHERE is_active")
        return [r[0] for r in cur.fetchall()]

    # Check if this user is a supervisor
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM staff WHERE supervisor_email = %s AND is_active", (email,))
    if cur.fetchone()[0] == 0:
        return []  # Not a supervisor, no team

    # Recursive CTE: walk downline by supervisor_email
    cur.execute("""
        WITH RECURSIVE downline AS (
            SELECT email FROM staff
            WHERE supervisor_email = %s AND is_active

            UNION ALL

            SELECT s.email FROM staff s
            INNER JOIN downline d ON s.supervisor_email = d.email
            WHERE s.is_active
        )
        SELECT DISTINCT email FROM downline
    """, (email,))
    return [r[0] for r in cur.fetchall()]


def check_access(user, target_email):
    """Check if user can view a specific staff member."""
    if not user:
        return False
    if user.get('is_admin'):
        return True
    accessible = user.get('accessible_emails', [])
    return target_email.lower() in accessible


def is_supervisor(user):
    """Check if user has any direct reports."""
    if not user:
        return False
    return user.get('is_admin', False) or len(user.get('accessible_emails', [])) > 0
