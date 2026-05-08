# ObservationPoint — Tester Walk-through

Thanks for taking time to test this. **OP** is FirstLine's new in-house observation, feedback, and PMAP tool — built to replace Grow, with everything tied to the FLS rubric and to our actual coaching and accountability work. We're aiming for a July 1 rollover (start of '26-'27); your feedback over the next few weeks shapes what's launched.

---

## Quick start

**URL:** https://observationpoint-daem7b6ydq-uc.a.run.app
**Sign in:** Google sign-in with your `@firstlineschools.org` account. Use whatever browser you normally use; works on phone too.
**No install, no setup.** Just sign in.

---

## What you'll see

- **Home page** — your role-specific landing. Buttons for the touchpoint forms you use, plus links into your profile, team, or network views.
- **Network page** (admins, school leaders, content leads only) — KPI strip + per-school comparison strips for Observations, PMAP/SR, Action Steps, Fundamentals, Celebrations.
- **Drill-downs** — tap any per-school comparison cell to see the teacher list for that section.
- **Staff profile** — full record for any teacher you have access to (observations, action steps, PMAPs, goals, etc.).
- **TouchPoint forms** — Observe, Quick Feedback, Celebrate, Fundamentals, Meeting, Solicit Feedback, PMAP, Self-Reflection, PIP, Write-Up, Goals.

---

## What to test (by role)

Find the section that matches your role. Run through the checklist. Don't worry about being exhaustive — **what feels broken, awkward, or wrong is the gold**.

### If you're CPO / HR / a Chief

- [ ] Land on Home — does it feel like a useful starting point?
- [ ] Open Network → click into each comparison strip cell (any school). Does the drill-down show the right teachers for that school?
- [ ] On any drill-down, try the **filters**: search box, status segments (e.g. "Both Done" / "1 Open" on Evaluations), role dropdown
- [ ] Tap the **school-year toggle** at the top of Network. Switch to 25-26. Click into a school. Hit back — do you land back on 25-26 or get bounced to 26-27? *(known issue — testing whether the URL fix held)*
- [ ] Tap into a teacher's profile. Confirm you see their observation, PMAP, action-step, and goal history.
- [ ] Try **Impersonation**: profile menu → View As → pick another staff member. Does the app feel right from their seat? Exit View-as before submitting anything.
- [ ] Visit `/app/admin/permissions` (paste in browser bar). Does the matrix make sense? Anything missing or wrong about who can do what?

### If you're a Principal, AP, Dean, or Director of Culture

- [ ] Land on Home — buttons should be the ones you'd actually use day-to-day. Anything obviously missing?
- [ ] Open Network. You should see the comparison numbers for **all 4 schools** (that's intentional — comparison is the value).
- [ ] Click your own school's cell on each strip — does the drill-down show your teachers?
- [ ] Click **another school's** cell. **Right now this still works** (it shouldn't). Tell us if you see another school's teacher list — that's a known gap we're closing.
- [ ] Submit an **Observe** on one of your teachers. Walk through the rubric. Does the form match what you'd expect from an observation?
- [ ] Submit a **Quick Feedback** or **Celebrate** for someone you supervise. Does the recipient's profile pick it up?
- [ ] Open one of your teachers' staff profiles. Look at their action steps, observations, PMAP. Anything labeled or organized in a confusing way?
- [ ] Try writing an **Action Step** for a teacher. Does the workflow feel right?

### If you're a Content Lead (K-8 Content Lead)

> Your role is intentionally **formative-only**: you see observation/coaching data across all 4 schools, but **not** PMAP scores, PIP, or Write-Up records — those belong to the direct supervisor and HR.

- [ ] Land on Network. The **Evaluations · by school** strip should be hidden from you (it's PMAP/SR data). The Observations, Action Steps, and Fundamentals strips should all be there.
- [ ] Walk through the Observations and Fundamentals drill-downs across all 4 schools — full access expected.
- [ ] Tap into a teacher's profile. Look at observations + action steps + goals. Is this enough for your coaching work? What's missing?
- [ ] Try to reach a PMAP drill-down (paste `/app/network/evaluations` in the URL bar). You should see a friendly **"This section is HR-only"** screen. If you can read PMAP data, that's a bug — tell us.
- [ ] Try the Action Steps drill-down — sort and filter. Useful?

### If you're a Supervisor (with direct reports, not a school leader)

- [ ] Open the **Team** page (`/app/team`). Are your direct reports listed correctly?
- [ ] Tap into one of them. Do you see what you need to coach them?
- [ ] Submit an Observe / Quick Feedback / Meeting on one of your reports.
- [ ] If you have someone reporting to someone reporting to you — can you reach them via Team? (recursive downline)

### If you're a Teacher (no direct reports)

- [ ] Land on Home. Are the buttons there the ones a teacher would actually use?
- [ ] Open your own profile (`/app/me`). Do you see your action steps, observations, and goals correctly?
- [ ] Submit a **Self-Reflection** on yourself.
- [ ] Submit a **Goals** entry.
- [ ] Try to navigate to Network (paste `/app/network` in URL bar). You **shouldn't** be able to reach it. If you do, that's a bug.

---

## Known gaps — don't report these

These are already on our list and in active work — no need to flag them again:

- **Cycle filter on drill-downs is not yet active** — the year/cycle from Network does propagate, but a per-cycle filter inside a drill-down isn't built. The dropdown is hidden for now.
- **Mobile (iOS Safari) hasn't been tested end-to-end** — small UI details on phones may be cramped. Note them but don't expect polish yet.
- **PMAP acknowledgment** is brand-new today — if the email doesn't arrive or the link doesn't work, flag it.
- **All form submissions are flagged `is_test=true`** during this round, which means every email goes BACK to you (the submitter), not to the named teacher. That's intentional — no real teachers should be receiving anything during testing.

---

## How to report what you find

**Quick & easy** — text or Slack me directly. Include:
1. **What you were doing** (the page or button you tapped)
2. **What you expected**
3. **What actually happened**
4. **Screenshot if you can grab one** (phone: hold side button + volume up; computer: Win+Shift+S)

**For longer feedback** — email `talent@firstlineschools.org` with subject **"OP feedback"**.

The **what feels off** is just as valuable as **what's broken**. If a page is confusing, slow, or labeled wrong, that's a fix. Don't filter — just dump.

---

## What we're explicitly NOT looking for in this round

- **Visual polish nitpicks** (a logo size, a color shade) — there's a polish pass at the end.
- **Exhaustive bug hunting** of edge cases — focus on the workflows you'd actually use.
- **Features that aren't there yet** — if something's missing, mention it; we'll prioritize.

What we **do** want:
- Does this feel **better than Grow** for your real work? Why or why not?
- Are the **drill-downs** giving you what you need to make decisions or coach?
- Is the **mobile experience** OK? (most of us live on our phones)
- Does anything feel **dishonest about the data** (counts, percentages, dates)? Trust matters more than anything else.

Thanks for the time. Real feedback in the next few weeks is what gets this right before launch.

— Scott
