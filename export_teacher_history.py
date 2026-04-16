"""
ObservationPoint — Export teacher history from BigQuery → static JSON.

Produces one JSON file the prototype pages fetch client-side:
    prototypes/teacher_history.json

Shape:
{
  "generated_at": "2026-04-15T...",
  "school_years": ["2021-2022", ..., "2025-2026"],
  "teachers": {
    "<email>": {
      "email": "...",
      "name": "Marcus Williams",
      "school": "Samuel J. Green",
      "pmap_by_year": {
        "2024-2025": {"T1": 4, "T2": 3, ...},
        ...
      },
      "touchpoints": [
        {
          "id": "<uuid>",
          "form_type": "pmap_teacher",
          "rubric": "PMAP: Teacher",
          "school_year": "2024-2025",
          "date": "2025-04-12",
          "scores": {"T1": 4, "T2": 3, ...}
        },
        ...
      ]
    }
  }
}
"""
import os
import json
import logging
from datetime import datetime, timezone, date
from collections import defaultdict
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

PROJECT_ID = 'talent-demo-482004'
OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prototypes', 'teacher_history.json')


def main():
    client = bigquery.Client(project=PROJECT_ID)

    q = """
    SELECT
      teacher_email,
      teacher_name,
      school,
      touchpoint_id,
      form_type,
      rubric_id,
      school_year,
      touchpoint_date,
      dimension_code,
      score
    FROM `talent-demo-482004.observationpoint.scores`
    WHERE teacher_email IS NOT NULL AND teacher_email != ''
    ORDER BY teacher_email, touchpoint_date DESC, touchpoint_id
    """

    log.info("Querying scores table...")
    rows = list(client.query(q).result())
    log.info(f"Got {len(rows)} score rows")

    teachers = {}
    touchpoints_by_teacher = defaultdict(dict)

    for r in rows:
        email = r.teacher_email.lower().strip()
        if not email:
            continue

        if email not in teachers:
            teachers[email] = {
                'email': email,
                'name': r.teacher_name or '',
                'school': r.school or '',
            }
        else:
            if not teachers[email]['name'] and r.teacher_name:
                teachers[email]['name'] = r.teacher_name
            if not teachers[email]['school'] and r.school:
                teachers[email]['school'] = r.school

        tp_id = r.touchpoint_id
        tps = touchpoints_by_teacher[email]
        if tp_id not in tps:
            tps[tp_id] = {
                'id': tp_id,
                'form_type': r.form_type,
                'rubric': r.rubric_id,
                'school_year': r.school_year,
                'date': r.touchpoint_date.isoformat() if isinstance(r.touchpoint_date, date) else r.touchpoint_date,
                'scores': {},
            }
        if r.dimension_code:
            tps[tp_id]['scores'][r.dimension_code] = r.score

    years_set = set()
    for email, tps in touchpoints_by_teacher.items():
        t = teachers[email]
        t['touchpoints'] = sorted(tps.values(), key=lambda x: (x.get('date') or '', x['id']), reverse=True)

        pmap_by_year_agg = defaultdict(lambda: defaultdict(list))
        for tp in t['touchpoints']:
            if tp['form_type'] in ('pmap_teacher', 'pmap_leader', 'pmap_prek', 'pmap_support', 'pmap_network'):
                for code, s in tp['scores'].items():
                    pmap_by_year_agg[tp['school_year']][code].append(s)

        pmap_by_year = {}
        for yr, dims in pmap_by_year_agg.items():
            pmap_by_year[yr] = {code: round(sum(vals) / len(vals), 2) for code, vals in dims.items()}
            years_set.add(yr)
        t['pmap_by_year'] = pmap_by_year

        obs_dates = [tp['date'] for tp in t['touchpoints']
                     if tp['form_type'] in ('observation_teacher', 'observation_prek', 'observation_fundamentals')
                     and tp.get('date')]
        t['last_observation_date'] = max(obs_dates) if obs_dates else None

        t['touchpoint_count'] = len(t['touchpoints'])

    output = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'school_years': sorted(years_set),
        'teachers': teachers,
    }

    with open(OUT_PATH, 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    size_mb = os.path.getsize(OUT_PATH) / (1024 * 1024)
    log.info(f"Wrote {OUT_PATH} ({size_mb:.2f} MB)")
    log.info(f"Teachers: {len(teachers)}")
    log.info(f"School years: {sorted(years_set)}")

    with_pmap = sum(1 for t in teachers.values() if t['pmap_by_year'])
    log.info(f"Teachers with PMAP history: {with_pmap}")

    multi_year = sum(1 for t in teachers.values() if len(t['pmap_by_year']) >= 2)
    log.info(f"Teachers with 2+ years of PMAPs: {multi_year}")


if __name__ == '__main__':
    main()
