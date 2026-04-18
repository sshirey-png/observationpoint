/**
 * Shared dimension name map — used everywhere scores or dimensions are displayed.
 * Scott's feedback: "replace with name or shorthand — CoL for T2"
 */

export const DIM_NAMES = {
  T1: { full: 'On Task', short: 'On Task' },
  T2: { full: 'Community of Learners', short: 'CoL' },
  T3: { full: 'Essential Content', short: 'Content' },
  T4: { full: 'Cognitive Engagement', short: 'Cog Eng' },
  T5: { full: 'Demonstration of Learning', short: 'Demo' },
  L1: { full: 'Instructional Leadership', short: 'Instr Lead' },
  L2: { full: 'Cultural Leadership and Builder', short: 'Culture' },
  L3: { full: 'Personal Leadership and Builder', short: 'Personal' },
  L4: { full: 'Talent Management', short: 'Talent' },
  L5: { full: 'Strategic and Operations Leadership', short: 'Strategy' },
  PK1: { full: 'Positive Climate', short: 'Pos Climate' },
  PK2: { full: 'Negative Climate', short: 'Neg Climate' },
  PK3: { full: 'Teacher Sensitivity', short: 'Sensitivity' },
  PK4: { full: 'Regard for Student Perspectives', short: 'Regard' },
  PK5: { full: 'Behavior Management', short: 'Behavior' },
  PK6: { full: 'Productivity', short: 'Productivity' },
  PK7: { full: 'Instructional Learning Formats', short: 'Instr Format' },
  PK8: { full: 'Concept Development', short: 'Concept Dev' },
  PK9: { full: 'Quality of Feedback', short: 'Feedback' },
  PK10: { full: 'Language Modeling', short: 'Language' },
  M1: { full: 'On Task Minute 1', short: 'Min 1' },
  M2: { full: 'On Task Minute 2', short: 'Min 2' },
  M3: { full: 'On Task Minute 3', short: 'Min 3' },
  M4: { full: 'On Task Minute 4', short: 'Min 4' },
  M5: { full: 'On Task Minute 5', short: 'Min 5' },
}

/** Get the short display name for a dimension code. Falls back to the code itself. */
export function dimName(code) {
  return DIM_NAMES[code]?.short || code
}

/** Get the full display name for a dimension code. */
export function dimFullName(code) {
  return DIM_NAMES[code]?.full || code
}

/** Standard dimension ordering by type */
export const DIM_ORDER = {
  teacher: ['T1', 'T2', 'T3', 'T4', 'T5'],
  leader: ['L1', 'L2', 'L3', 'L4', 'L5'],
  prek: ['PK1', 'PK2', 'PK3', 'PK4', 'PK5', 'PK6', 'PK7', 'PK8', 'PK9', 'PK10'],
}
