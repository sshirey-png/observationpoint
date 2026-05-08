# Archived Users — Design Spec

How OP handles staff who leave FLS: archive trigger, data retention, admin access path. **Design only — implementation deferred.**

---

## Archive trigger

- **Source of truth:** `staff.is_active` column in the OP Postgres DB.
- HR sets `is_active = false` when an employee leaves. (Already wired today via the staff-master-list pipeline; the same flag drives access in BigQuery dashboards.)
- No deletion. The staff record stays in the table, plus all of their related records (touchpoints, action_steps, goals, scores, scores_v2, uploads).
- Active vs archived is purely the boolean — there's no separate "archived_staff" table.

---

## What archived staff look like to the rest of the app

Most queries already filter `WHERE is_active`. Effect on existing surfaces:

| Surface | Behavior for archived staff |
|---|---|
| Staff search / pickers | Hidden — `WHERE is_active` already on the search endpoint |
| Network drill-downs | Hidden — every drill-down query filters `s.is_active` |
| Network landing KPIs | Hidden — denominators use `is_active` |
| Team page | Hidden — recursive downline only walks `is_active` rows |
| Staff profile page | **Loads if URL is pasted** — the page itself doesn't gate on `is_active` |
| Touchpoint forms (Observe, etc.) | Cannot select archived person as subject (search hides them) |
| `check_access()` | Returns False for archived target (their email not in any user's accessible_emails since accessible_emails query filters `is_active`) |

So today: anyone with admin access who knows an archived staff member's email can still navigate to `/app/staff/<email>` and see their record. Other roles cannot.

---

## Data retention

Per FLS policy plus existing OP infrastructure:

| Data type | Retention | Mechanism |
|---|---|---|
| Touchpoints, action_steps, goals, scores | Indefinite | No deletion logic |
| HR-locked uploads (PIP, Write-Up attachments) | 7 years | GCS bucket lifecycle rule auto-deletes after 7y (already configured) |
| Short-term uploads (Observe, Quick Feedback evidence) | 90 days | GCS lifecycle rule auto-deletes after 90d (already configured) |
| Vimeo exemplar videos (Mastery clips) | Indefinite | Not auto-deleted; HR review only |

For an archived employee: their HR-locked PIPs/Write-Ups stay accessible to admins for 7 years from upload date. After that the original file is gone but the touchpoint record (with metadata: type, date, summary, ack signature) remains in Postgres forever.

---

## Admin access — current path

Admins have all archived staff in their `accessible_emails` only if the archived person's email was on staff at the time the admin's session was minted. This is a session-state issue:
- Session-time `accessible_emails` is built once at login. Archived-after-login → still in the admin's session list → access works.
- Admin re-login → `is_active` filter excludes them → archived person no longer in the list → `check_access` returns False.

**Result today:** an admin who logs in fresh after an employee was archived cannot reach that person's profile via the URL. **(GAP)**

---

## Admin access — proposed path (deferred build)

Two pieces, both small:

### 1. `Admin · Archived staff` page at `/app/admin/archived`

- Admin-only (mirrors `/app/admin/permissions`)
- Lists all `staff WHERE NOT is_active`, sorted by `terminated_date DESC` (or by `last_active_date` if termination not captured)
- Each row links to `/app/staff/<email>?archived=true` for read-only profile view
- Search box for fast lookup by name or email

### 2. Allow admin access to archived staff records

Update `check_access()`:
- If `user.is_admin == true`, allow access regardless of target's `is_active` status (admins should be able to see anyone's record at any time)

This is a one-line change in `auth.py` — admin tier is unconditional.

### 3. Read-only mode on archived profiles

When `staff.is_active == false` for the viewed profile:
- Show a banner: "🗄️ Archived staff · {terminated_date} · read-only"
- Hide all action buttons (no "Assign Action Step", no "Submit Observation", no "Mark Mastered")
- Show an "Export full record" button (calls existing `/api/staff/<email>/touchpoints/export.csv`)

### 4. Export-on-archive automation (later)

When HR sets `is_active = false`, fire a cloud function that:
- Generates a complete CSV of the staff member's record
- Drops it in `gs://fls-archived-staff/<terminated_date>/<email>.csv`
- Sends a copy to `hr@firstlineschools.org` with subject `[OP Archive] <name>'s record`

**Why:** belt-and-suspenders. If OP ever loses an employee record, HR has a snapshot.

---

## What's NOT in scope

- **Re-hires** — if an employee returns, HR flips `is_active` back to true. Their old records become visible again automatically. No special handling needed.
- **Hard deletes** — never delete a staff row. Even after 7 years, keep the row + touchpoint metadata for institutional memory.
- **GDPR-style "right to be forgotten"** — Louisiana doesn't have a right-to-erase law; FLS retention policy controls.

---

## Build order if we ship this

1. One-line `check_access()` update — admin always allowed (5 min)
2. Read-only banner + button-hiding on `StaffProfile.jsx` when `is_active == false` (15 min)
3. `/app/admin/archived` page + `/api/admin/archived-staff` endpoint (30 min)
4. Export-on-archive cloud function — separate project (later)

Total for items 1-3: ~50 min. Defer to post-July-1 launch unless HR has an urgent need.
