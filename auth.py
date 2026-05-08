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


# --- Tier-based scope (Network + drill-downs) ---
# Mirrors permissions.yaml. Order MATTERS: content_lead is checked BEFORE
# admin so ExDir of Teach and Learn (which matches C_TEAM_KEYWORDS via
# "ExDir") gets the narrower content-lead scope, not full admin.

CONTENT_LEAD_TITLES_EXACT = ['K-8 Content Lead']
SCHOOL_LEADER_TITLE_KEYWORDS = ['principal', 'assistant principal', 'dean', 'director of culture']


def is_content_lead(job_title):
    return bool(job_title) and job_title.strip() in CONTENT_LEAD_TITLES_EXACT


def is_school_leader(job_title):
    if not job_title:
        return False
    title_lower = job_title.lower()
    return any(kw in title_lower for kw in SCHOOL_LEADER_TITLE_KEYWORDS)


def get_user_scope(user):
    """Return the user's permission tier + (for school_leader) their school.

    Returns one of:
      {'tier': 'admin'}
      {'tier': 'content_lead'}
      {'tier': 'school_leader', 'school': '<school name>'}
      {'tier': 'supervisor'}
      {'tier': 'self_only'}
      {'tier': None}  # not authenticated

    Tier order matters — see docstring above.
    """
    if not user:
        return {'tier': None}
    job_title = user.get('job_title') or ''
    school = user.get('school') or ''

    if is_content_lead(job_title):
        return {'tier': 'content_lead'}
    if is_admin_title(job_title):
        return {'tier': 'admin'}
    if is_school_leader(job_title) and school:
        return {'tier': 'school_leader', 'school': school}
    if is_supervisor(user):
        return {'tier': 'supervisor'}
    return {'tier': 'self_only'}


# --- Org hierarchy (email-based recursive CTE) ---

def get_accessible_emails(conn, email, job_title):
    """
    Get all staff emails the user can access. Used by check_access() for
    per-record authorization on staff profiles, action steps, touchpoints.

    Tier behavior (mirrors permissions.yaml):
      - admin / content_lead: all active staff (Content Leads coach across
        all schools; their PMAP exclusion is enforced at the capability
        layer, not by trimming this list)
      - school_leader: own downline + ALL active staff at their school
        (so when they click into any teacher at their school the profile
        loads, not just their direct reports)
      - other supervisors: own + recursive downline
      - everyone else: self only
    """
    # All-staff tiers: admin and content_lead.
    # Order matters — is_content_lead BEFORE is_admin_title so ExDir of
    # Teach and Learn (which would also match is_cteam) gets here too.
    if is_content_lead(job_title) or is_admin_title(job_title):
        cur = conn.cursor()
        cur.execute("SELECT email FROM staff WHERE is_active")
        return [r[0] for r in cur.fetchall()]

    # Always include self
    own = (email or '').lower()
    accessible = {own} if own else set()

    # Add recursive downline for supervisors
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM staff WHERE supervisor_email = %s AND is_active", (email,))
    if cur.fetchone()[0] > 0:
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
        for r in cur.fetchall():
            accessible.add(r[0])

    # School leaders: also include all active staff at their school. This
    # is what makes click-through-from-drill-down to a teacher's profile
    # actually load data instead of returning 403.
    if is_school_leader(job_title):
        cur.execute("SELECT school FROM staff WHERE LOWER(email) = LOWER(%s)", (email,))
        row = cur.fetchone()
        leader_school = row[0] if row else None
        if leader_school:
            cur.execute(
                "SELECT email FROM staff WHERE is_active AND school = %s",
                (leader_school,),
            )
            for r in cur.fetchall():
                if r[0]:
                    accessible.add(r[0])

    return list(accessible)


def check_access(user, target_email):
    """Check if user can view a specific staff member.
    Self is always allowed — every staff member can view their own profile."""
    if not user:
        return False
    if user.get('is_admin'):
        return True
    if user.get('email', '').lower() == (target_email or '').lower():
        return True
    accessible = user.get('accessible_emails', [])
    return target_email.lower() in accessible


def is_supervisor(user):
    """Check if user has any direct reports (accessible emails beyond their own)."""
    if not user:
        return False
    if user.get('is_admin', False):
        return True
    own = (user.get('email') or '').lower()
    accessible = user.get('accessible_emails', [])
    return any((e or '').lower() != own for e in accessible)
