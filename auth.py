"""
ObservationPoint — Authentication & Authorization
Google OAuth with role-based access. Same pattern as TalentPoint.
"""
import os
import functools
from flask import session, redirect, url_for, request, jsonify
from authlib.integrations.flask_client import OAuth

oauth = OAuth()

# Roles and permissions
ROLES = {
    'admin': {
        'can_observe': True,
        'can_view_all': True,
        'can_manage_forms': True,
        'can_manage_users': True,
        'can_view_reports': True,
    },
    'leader': {  # Principals, APs, coaches
        'can_observe': True,
        'can_view_all': True,  # Can see all observations at their school
        'can_manage_forms': False,
        'can_manage_users': False,
        'can_view_reports': True,
    },
    'observer': {  # Anyone who can do observations
        'can_observe': True,
        'can_view_all': False,
        'can_manage_forms': False,
        'can_manage_users': False,
        'can_view_reports': False,
    },
    'teacher': {  # Can view their own observations
        'can_observe': False,
        'can_view_all': False,
        'can_manage_forms': False,
        'can_manage_users': False,
        'can_view_reports': False,
    },
}


def init_oauth(app):
    """Initialize Google OAuth."""
    oauth.init_app(app)
    oauth.register(
        name='google',
        client_id=os.environ.get('GOOGLE_CLIENT_ID'),
        client_secret=os.environ.get('GOOGLE_CLIENT_SECRET'),
        server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
        client_kwargs={'scope': 'openid email profile'},
    )


def get_current_user():
    """Get current logged-in user from session."""
    return session.get('user')


def require_auth(f):
    """Decorator: require authentication."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if not user:
            if request.is_json:
                return jsonify({'error': 'Not authenticated'}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated


def require_role(*allowed_roles):
    """Decorator: require specific role(s)."""
    def decorator(f):
        @functools.wraps(f)
        def decorated(*args, **kwargs):
            user = get_current_user()
            if not user:
                return redirect(url_for('login'))
            if user.get('role') not in allowed_roles:
                return jsonify({'error': 'Insufficient permissions'}), 403
            return f(*args, **kwargs)
        return decorated
    return decorator


def can(user, permission):
    """Check if user has a specific permission."""
    if not user:
        return False
    role = user.get('role', 'teacher')
    return ROLES.get(role, {}).get(permission, False)
