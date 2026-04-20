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
    """
    The EFFECTIVE current user. If an admin is impersonating another staff
    member, this returns that impersonated user (with is_admin forced False
    so they don't accidentally wield admin powers). Otherwise returns the
    real signed-in user.
    """
    real_user = session.get('user')
    if not real_user:
        return None
    imp = session.get('impersonating_as')
    if imp and real_user.get('is_admin'):
        return {
            'email': imp['email'],
            'name': imp.get('name', ''),
            'job_title': imp.get('job_title', ''),
            'school': imp.get('school', ''),
            'job_function': imp.get('job_function', ''),
            'is_admin': False,           # impersonated users never have admin powers
            'accessible_emails': imp.get('accessible_emails', []),
            '_impersonating': True,
            '_real_user_email': real_user.get('email'),
        }
    return real_user


def get_real_user():
    """The real signed-in user, regardless of impersonation. Use for audit."""
    return session.get('user')


def is_impersonating():
    return bool(session.get('impersonating_as'))


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


def require_admin(f):
    """Only the real signed-in user's is_admin flag counts — impersonated
    users are never admins."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        real = get_real_user()
        if not real or not real.get('is_admin'):
            return jsonify({'error': 'Admin required'}), 403
        return f(*args, **kwargs)
    return decorated


def require_no_impersonation(f):
    """Block the endpoint while impersonating. Use on write endpoints —
    admins in view-as mode shouldn't be able to create/modify data as the
    impersonated user."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if is_impersonating():
            return jsonify({
                'error': 'Cannot modify data while viewing as another user. Exit view-as mode first.',
                'code': 'impersonating',
            }), 403
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
