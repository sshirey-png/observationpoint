import { useState } from 'react'
import AIPanel from './AIPanel'

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
      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} context={context} subject={subject} />
    </>
  )
}
