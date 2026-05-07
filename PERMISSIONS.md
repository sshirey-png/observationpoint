# ObservationPoint — Permissions Spec

**Source of truth:** `bigquery-dashboards/config.py` title lists. OP mirrors them via `observationpoint/config.py`. **Never invent new role categories.** If a role isn't here, it doesn't have OP access.

Status as of revision `observationpoint-00200-t9h`. Items marked **(GAP)** are not yet enforced in code.

---

## Tiers (existing, from `auth.is_admin_title()`)

### Tier 1 — Admin (full access, all schools)

`auth.is_admin_title()` returns `True` when `job_title` is C-Team OR in HR_TEAM_TITLES.

**C-Team** — title contains `'Chief'` or `'ExDir'` (case-insensitive). From `config.C_TEAM_KEYWORDS`.

**HR Team** — exact title match. From `config.HR_TEAM_TITLES`:
- Chief Executive Officer
- Chief HR Officer
- Manager, HR
- Manager Payroll
- Manager - Benefits
- Talent Operations Manager
- Recruitment Manager

CPO is C-Team via keyword match (`Chief People Officer`).

### Tier 1c — Content Lead (formative data, all schools, **no personnel review**)

**(GAP — not yet enforced.)** Sees observation/coaching data network-wide but not PMAP, Self-Reflection, PIP, Write-Up, or other personnel-review surfaces.

Roles in this bucket (from `bigquery-dashboards/config.SCHOOLS_DASHBOARD_ROLES`):
- ExDir of Teach and Learn
- K-8 Content Lead

**Note:** ExDir of Teach and Learn matches `C_TEAM_KEYWORDS` (because of "ExDir") and so currently lands in Tier 1 admin via `is_cteam()`. To honor the Content-Lead scope, OP needs per-feature narrowing for these two titles specifically — same pattern as `SCHOOLS_DASHBOARD_ROLES['teachers_only']` in the dashboards repo.

**Why this tier exists:** Content leads coach instructional practice across all 4 schools. They need observation visibility (the formative data) without seeing personnel-review records (PMAP scores, PIPs, write-ups) — those belong to the direct supervisor and HR.

### Tier 2 — Supervisor (org-tree downline, **not yet school-scoped**)

`auth.is_supervisor()` — anyone with at least one direct report. Sees their recursive downline via `get_accessible_emails()`.

This bucket today includes both:
- **School Leadership** — Principal, Assistant Principal, Dean, Director of Culture *(from `bigquery-dashboards/config.KICKBOARD_SCHOOL_LEADER_TITLES`, minus "Head of School" which is in the dashboards config but not an actual FLS role)*
- **Network supervisors with direct reports** — anyone else with a downline

OP does not currently distinguish them. **(GAP)** see § School-scoping below.

### Tier 3 — Self only

Any active staff member who is not a supervisor and not an admin. Can see their own profile, their own action steps, and complete their own self-reflection / acknowledgment.

### Tier 0 — No access

Inactive staff, or anyone without a `firstlineschools.org` (or aliased) account. Login refused.

---

## Page-by-page rules

Cells: ✅ allowed, 🟡 allowed but scoped, ⛔ blocked, **(GAP)** = not yet enforced.

| Route | Admin | School Leader | Other Supervisor | Self-only |
|------|------|------|------|------|
| `/app` (Home) | ✅ | ✅ | ✅ | ✅ |
| `/app/me` | ✅ | ✅ | ✅ | ✅ |
| `/app/team` | ✅ | ✅ (own school) | ✅ (own downline) | ⛔ |
| `/app/staff/<email>` | ✅ | 🟡 own school staff | 🟡 own downline | 🟡 self only |
| `/app/network` | ✅ | ✅ (read all comparisons) | ✅ | ⛔ **(GAP — currently allowed for any supervisor; verify intent)** |
| `/app/network/observations` (no school) | ✅ | ⛔ **(GAP)** | ⛔ **(GAP)** | ⛔ |
| `/app/network/observations?school=X` | ✅ (any X) | 🟡 (X = own school only) **(GAP)** | ⛔ **(GAP)** | ⛔ |
| `/app/network/evaluations` (+ same `?school=X` rules) | ✅ | 🟡 | ⛔ | ⛔ |
| `/app/network/action-steps` | ✅ | 🟡 | ⛔ | ⛔ |
| `/app/network/fundamentals` | ✅ | 🟡 | ⛔ | ⛔ |
| `/app/network/celebration` | ✅ | 🟡 | ⛔ | ⛔ |
| `/app/network/school/<name>` | ✅ | 🟡 (own school only) **(GAP)** | ⛔ **(GAP)** | ⛔ |
| `/app/insights` | ✅ | ✅ | ✅ | ✅ (self) |
| TouchPoint forms (`/app/observe`, `/app/feedback`, `/app/celebrate`, `/app/fundamentals`, `/app/meeting`, `/app/solicit`, `/app/quick-meeting`, `/app/goals`) | ✅ | ✅ | ✅ | ✅ (self-targeted only) |
| `/app/pmap`, `/app/self-reflection` | ✅ | ✅ supervises target | ✅ supervises target | ✅ (self SR only) |
| `/app/pip`, `/app/write-up` | ✅ | ✅ supervises target | ✅ supervises target | ⛔ |
| `/acknowledge/<token>` | ✅ (anyone with token) | ✅ | ✅ | ✅ |
| Impersonation banner / view-as | ✅ admins only | ⛔ | ⛔ | ⛔ |

---

## School-scoping rule (school leadership) — **GAP, design locked**

**Rule:** School leaders can see Network-level trends and per-school comparison numbers. They can only **click into their own school**.

**Implementation pattern** (mirrors what `bigquery-dashboards/blueprints/kickboard.py` does for school-leader Kickboard scope):

1. **Backend** — new helper `auth.get_user_school_scope(user)`:
   - Returns `'admin'` for Tier 1
   - Returns the user's school name (string) if `job_title.lower()` matches a `KICKBOARD_SCHOOL_LEADER_TITLES` entry **and** `staff.school` is set
   - Returns `None` otherwise

2. **`/api/network/drilldown`** enforcement:
   - `admin` → `school` param honored as-is (any school, or none for network-wide)
   - school-scoped → if `school` param missing or different from user's, force it to user's
   - `None` → existing supervisor check applies; if not a supervisor, 200 with `{'authorized': False}` (friendly screen, never raw 403 — see memory rule)

3. **Frontend** — `Network.jsx` reads scope from `/api/auth/status`:
   - Comparison strip cells render `cursor: default` with no nav handler for non-own-school cells when scope is school-name
   - Hero footer school cells follow the same rule
   - "Network-wide" entries (no school) are non-clickable for school-scoped users

---

## Same-school check (today, mostly working)

`auth.check_access(user, target_email)` already restricts staff-profile access:
- Admins → see anyone
- Supervisors → see their downline (recursive CTE)
- Everyone else → self only

**No `(GAP)` for `/app/staff/<email>`** — covered by the existing decorator.

The gaps above are specifically for the **Network landing page + drill-downs + school deep-dive page**, which today rely only on `is_supervisor()` and don't enforce the same-school constraint.

---

## What testing readiness needs

1. **Implement the `get_user_school_scope()` helper** and wire it into the drill-down API + Network frontend (above).
2. **Friendly screen** for unauthorized users hitting `/app/network/*` — wrap the 403 (memory rule).
3. **Verify HR Team membership in OP** — current `HR_TEAM_TITLES` matches dashboards; spot-check that everyone listed has an active `firstlineschools.org` account and lands on `/app/network` without errors.
4. **Test impersonation** — admin can impersonate any school leader and confirm scope behaves correctly under impersonation (impersonating user inherits target's scope).
5. **Test data isolation** — confirm `is_test=true` records don't bleed into school-leader views during pre-launch testing.
