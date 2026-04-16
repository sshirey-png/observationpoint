"""
Generate teacher_history_demo.json for the public GitHub Pages prototype.
All data is fictional — names, emails, scores invented for design iteration only.
"""
import json
import os
import random
import uuid
from datetime import date, timedelta

random.seed(42)

OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        'prototypes', 'teacher_history_demo.json')

SCHOOL_YEARS = ['2021-2022', '2022-2023', '2023-2024', '2024-2025', '2025-2026']


def yr_start(sy):
    y = int(sy.split('-')[0])
    return date(y, 7, 1)


def random_date_in_month(sy, month):
    y = int(sy.split('-')[0])
    if month < 7:
        y += 1
    dmax = 28
    return date(y, month, random.randint(1, dmax))


def clamp(v, lo=1, hi=5):
    return max(lo, min(hi, v))


def scored(code_to_score):
    return {k: round(v, 1) for k, v in code_to_score.items()}


TEACHERS = [
    {
        'email': 'marcus.williams@demo.local',
        'name': 'Marcus Williams',
        'school': 'Samuel J. Green Charter School',
        'role': 'teacher',
        'trajectory_note': 'Growth story — 3rd year teacher trending up',
        'pmap_trajectory': {
            '2023-2024': {'T1': 3, 'T2': 2, 'T3': 3, 'T4': 2, 'T5': 3},
            '2024-2025': {'T1': 4, 'T2': 3, 'T3': 3, 'T4': 3, 'T5': 3},
            '2025-2026': {'T1': 4, 'T2': 3, 'T3': 4, 'T4': 3, 'T5': 4},
        },
    },
    {
        'email': 'sarah.thompson@demo.local',
        'name': 'Sarah Thompson',
        'school': 'Arthur Ashe Charter School',
        'role': 'teacher',
        'trajectory_note': 'Veteran star — consistent 4s and 5s',
        'pmap_trajectory': {
            '2021-2022': {'T1': 4, 'T2': 4, 'T3': 5, 'T4': 4, 'T5': 4},
            '2022-2023': {'T1': 5, 'T2': 4, 'T3': 5, 'T4': 4, 'T5': 5},
            '2023-2024': {'T1': 5, 'T2': 5, 'T3': 5, 'T4': 5, 'T5': 5},
            '2024-2025': {'T1': 5, 'T2': 5, 'T3': 5, 'T4': 5, 'T5': 5},
            '2025-2026': {'T1': 5, 'T2': 4, 'T3': 5, 'T4': 5, 'T5': 5},
        },
    },
    {
        'email': 'david.chen@demo.local',
        'name': 'David Chen',
        'school': 'Langston Hughes Academy',
        'role': 'teacher',
        'trajectory_note': 'New teacher, 2nd year',
        'pmap_trajectory': {
            '2024-2025': {'T1': 2, 'T2': 2, 'T3': 3, 'T4': 2, 'T5': 2},
            '2025-2026': {'T1': 3, 'T2': 3, 'T3': 3, 'T4': 3, 'T5': 3},
        },
    },
    {
        'email': 'ashley.davis@demo.local',
        'name': 'Ashley Davis',
        'school': 'Phillis Wheatley Community School',
        'role': 'teacher',
        'trajectory_note': 'Dip and recovery — bounced back after tough year',
        'pmap_trajectory': {
            '2021-2022': {'T1': 4, 'T2': 3, 'T3': 4, 'T4': 3, 'T5': 3},
            '2022-2023': {'T1': 2, 'T2': 2, 'T3': 3, 'T4': 2, 'T5': 2},
            '2023-2024': {'T1': 3, 'T2': 3, 'T3': 3, 'T4': 3, 'T5': 3},
            '2024-2025': {'T1': 4, 'T2': 3, 'T3': 4, 'T4': 3, 'T5': 4},
            '2025-2026': {'T1': 4, 'T2': 4, 'T3': 4, 'T4': 4, 'T5': 4},
        },
    },
    {
        'email': 'jennifer.rodriguez@demo.local',
        'name': 'Jennifer Rodriguez',
        'school': 'Arthur Ashe Charter School',
        'role': 'prek',
        'trajectory_note': 'PreK teacher — CLASS scores',
        'pmap_trajectory': {
            '2023-2024': {'PK1': 5, 'PK2': 2, 'PK3': 4, 'PK4': 4, 'PK5': 5,
                          'PK6': 5, 'PK7': 4, 'PK8': 3, 'PK9': 3, 'PK10': 4},
            '2024-2025': {'PK1': 6, 'PK2': 2, 'PK3': 5, 'PK4': 4, 'PK5': 6,
                          'PK6': 6, 'PK7': 5, 'PK8': 4, 'PK9': 4, 'PK10': 5},
            '2025-2026': {'PK1': 6, 'PK2': 1, 'PK3': 6, 'PK4': 5, 'PK5': 6,
                          'PK6': 6, 'PK7': 5, 'PK8': 5, 'PK9': 5, 'PK10': 5},
        },
    },
    {
        'email': 'michael.jackson@demo.local',
        'name': 'Michael Jackson',
        'school': 'Samuel J. Green Charter School',
        'role': 'leader',
        'trajectory_note': 'Assistant Principal — 4 years of leadership PMAPs',
        'pmap_trajectory': {
            '2022-2023': {'L1': 3, 'L2': 4},
            '2023-2024': {'L1': 4, 'L2': 4},
            '2024-2025': {'L1': 4, 'L2': 5},
            '2025-2026': {'L1': 5, 'L2': 5},
        },
    },
]


ROLE_META = {
    'teacher': {
        'pmap_form': 'pmap_teacher',
        'sr_form': 'self_reflection_teacher',
        'obs_form': 'observation_teacher',
        'pmap_rubric': 'PMAP: Teacher',
        'sr_rubric': 'Self Reflection: Teacher',
        'obs_rubric': 'Observation/Feedback Form: Teacher',
    },
    'prek': {
        'pmap_form': 'pmap_prek',
        'sr_form': 'self_reflection_prek',
        'obs_form': 'observation_prek',
        'pmap_rubric': 'PMAP: PreK',
        'sr_rubric': 'Self Reflection: PreK',
        'obs_rubric': 'Observation/Feedback Form: PreK (CLASS-based)',
    },
    'leader': {
        'pmap_form': 'pmap_leader',
        'sr_form': 'self_reflection_leader',
        'obs_form': None,
        'pmap_rubric': 'PMAP: Leader',
        'sr_rubric': 'Self Reflection: Leader',
        'obs_rubric': None,
    },
}


def jitter_scores(base, noise=0.5):
    return {k: clamp(round(v + random.uniform(-noise, noise))) for k, v in base.items()}


def make_touchpoints(teacher):
    tps = []
    meta = ROLE_META[teacher['role']]
    traj = teacher['pmap_trajectory']
    years = sorted(traj.keys())

    for sy in years:
        base_scores = traj[sy]

        # PMAP in November
        tps.append({
            'id': str(uuid.uuid4()),
            'form_type': meta['pmap_form'],
            'rubric': meta['pmap_rubric'],
            'school_year': sy,
            'date': random_date_in_month(sy, 11).isoformat(),
            'scores': {k: v for k, v in base_scores.items()},
        })

        # Self-reflection in October (before PMAP) and March
        for month in (10, 3):
            tps.append({
                'id': str(uuid.uuid4()),
                'form_type': meta['sr_form'],
                'rubric': meta['sr_rubric'],
                'school_year': sy,
                'date': random_date_in_month(sy, month).isoformat(),
                'scores': jitter_scores(base_scores, 0.3),
            })

        # 3 observations per year (teacher/prek only)
        if meta['obs_form']:
            for month in (9, 1, 4):
                tps.append({
                    'id': str(uuid.uuid4()),
                    'form_type': meta['obs_form'],
                    'rubric': meta['obs_rubric'],
                    'school_year': sy,
                    'date': random_date_in_month(sy, month).isoformat(),
                    'scores': jitter_scores(base_scores, 0.6),
                })

        # Fundamentals (teachers only, a couple per year)
        if teacher['role'] == 'teacher':
            for month in (10, 2):
                pct_avg = int(base_scores.get('T1', 3) * 18 + random.randint(-5, 5))
                pct_avg = max(50, min(100, pct_avg))
                tps.append({
                    'id': str(uuid.uuid4()),
                    'form_type': 'observation_fundamentals',
                    'rubric': 'Observation: Fundamentals',
                    'school_year': sy,
                    'date': random_date_in_month(sy, month).isoformat(),
                    'scores': {
                        'M1': round(pct_avg / 20, 1),
                        'M2': round((pct_avg + random.randint(-5, 5)) / 20, 1),
                        'M3': round((pct_avg + random.randint(-5, 5)) / 20, 1),
                        'M4': round((pct_avg + random.randint(-5, 5)) / 20, 1),
                        'M5': round((pct_avg + random.randint(-5, 5)) / 20, 1),
                    },
                })

    tps.sort(key=lambda x: x['date'], reverse=True)
    return tps


def main():
    teachers = {}
    years_set = set()

    for t in TEACHERS:
        tps = make_touchpoints(t)
        pmap_by_year = {sy: dict(scores) for sy, scores in t['pmap_trajectory'].items()}
        years_set.update(pmap_by_year.keys())

        obs_dates = [tp['date'] for tp in tps
                     if tp['form_type'].startswith('observation_') and tp.get('date')]
        last_obs = max(obs_dates) if obs_dates else None

        teachers[t['email']] = {
            'email': t['email'],
            'name': t['name'],
            'school': t['school'],
            'role': t['role'],
            'touchpoints': tps,
            'touchpoint_count': len(tps),
            'pmap_by_year': pmap_by_year,
            'last_observation_date': last_obs,
        }

    out = {
        'generated_at': date.today().isoformat(),
        'note': 'Demo data — all names, emails, and scores are fictional',
        'school_years': sorted(years_set),
        'teachers': teachers,
    }

    with open(OUT_PATH, 'w') as f:
        json.dump(out, f, indent=2)

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"Wrote {OUT_PATH} ({size_kb:.1f} KB)")
    for email, t in teachers.items():
        print(f"  {t['name']:25s} {t['role']:8s} {len(t['touchpoints']):3d} tps  {len(t['pmap_by_year'])} PMAP yrs")


if __name__ == '__main__':
    main()
