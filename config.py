"""
ObservationPoint — Tenant Configuration
Loads org config from BigQuery. Designed to work standalone (FirstLine)
or as a TalentPoint module with shared tenant config.
"""
import os
from google.cloud import bigquery

PROJECT_ID = os.environ.get('GCP_PROJECT', 'talent-demo-482004')
DATASET = os.environ.get('BQ_DATASET', 'observationpoint')

# Tenant defaults (FirstLine Schools)
DEFAULTS = {
    'org_name': 'FirstLine Schools',
    'org_short': 'FLS',
    'primary_color': '#e47727',
    'secondary_color': '#002f60',
    'font_family': 'Inter',
    'logo_url': '',
    'domain': 'firstlineschools.org',
    'schools': [
        'Arthur Ashe Charter School',
        'George Washington Carver High School',
        'George Washington Carver Preparatory Academy',
        'Langston Hughes Academy',
        'Live Oak Elementary School',
        'Samuel J. Green Charter School',
        'FirstLine Schools Network Office',
    ],
    'school_years': [
        '2025-2026',
        '2024-2025',
        '2023-2024',
    ],
    'current_school_year': '2025-2026',
}

_config = None
_client = None


def get_client():
    global _client
    if _client is None:
        _client = bigquery.Client(project=PROJECT_ID)
    return _client


def tenant():
    """Return tenant configuration. Loads from BQ if available, falls back to defaults."""
    global _config
    if _config is not None:
        return _config

    _config = DEFAULTS.copy()

    # Try loading from BigQuery tenant config (TalentPoint pattern)
    try:
        client = get_client()
        query = f"""
            SELECT key, value
            FROM `{PROJECT_ID}.{DATASET}.tenant_config`
        """
        rows = client.query(query).result()
        for row in rows:
            _config[row.key] = row.value
    except Exception:
        pass  # Use defaults

    return _config


def schools():
    """Return list of schools."""
    return tenant().get('schools', [])


def current_school_year():
    """Return current school year."""
    return tenant().get('current_school_year', '2025-2026')
