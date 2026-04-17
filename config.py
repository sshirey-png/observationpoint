"""
ObservationPoint — Configuration
"""
import os
import secrets

# Flask
SECRET_KEY = os.environ.get('SECRET_KEY', secrets.token_hex(32))

# OAuth
ALLOWED_DOMAIN = 'firstlineschools.org'
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')

# Dev mode
DEV_MODE = os.environ.get('DEV_MODE', 'false').lower() == 'true'
DEV_USER_EMAIL = os.environ.get('DEV_USER_EMAIL', 'sshirey@firstlineschools.org')

# Database
DB_HOST = os.environ.get('DB_HOST') or '35.184.9.224'
DB_NAME = os.environ.get('DB_NAME') or 'observationpoint'
DB_USER = os.environ.get('DB_USER') or 'postgres'
DB_PASS = os.environ.get('DB_PASS') or ''
DB_PORT = os.environ.get('DB_PORT') or '5432'
DB_SOCKET = os.environ.get('DB_SOCKET') or ''

# GCP
PROJECT_ID = os.environ.get('GCP_PROJECT', 'talent-demo-482004')

# Current school year
CURRENT_SCHOOL_YEAR = '2025-2026'
SCHOOL_YEARS = ['2023-2024', '2024-2025', '2025-2026']

# Role-based access — same pattern as bigquery-dashboards/config.py
CPO_TITLE = 'Chief People Officer'
C_TEAM_KEYWORDS = ['Chief', 'ExDir']

HR_TEAM_TITLES = [
    'Chief Executive Officer',
    'Chief HR Officer',
    'Manager, HR',
    'Manager Payroll',
    'Manager - Benefits',
    'Talent Operations Manager',
    'Recruitment Manager',
]

# Build version for cache busting
BUILD_VERSION = os.environ.get('BUILD_VERSION', '1')
