import { useState } from 'react'

/**
 * FormShell — wraps a form page. Hides the global BottomNav so forms
 * have full-width bottom real estate for their sticky submit bar.
 * AIPanel (the "Ask" side-sheet) stays available via parent triggers.
 */
export default function FormShell({ children, context = 'touchpoint', subject = '' }) {
  const [aiOpen, setAiOpen] = useState(false)
  return (
    <>
      {children}
    </>
  )
}
