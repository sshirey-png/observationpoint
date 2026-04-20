import { useState } from 'react'
import BottomNav from './BottomNav'
import AIPanel from './AIPanel'

/**
 * FormShell — wraps a page with the persistent BottomNav + inline AIPanel.
 * Form pages are reached via the Touchpoint tab, so "touchpoint" is the
 * default active tab. AI context defaults to 'touchpoint' too.
 *
 * Usage:
 *   export default function MyForm() {
 *     return (
 *       <FormShell>
 *         <div className="pb-20">
 *           ...form content...
 *         </div>
 *       </FormShell>
 *     )
 *   }
 */
export default function FormShell({ children, active = 'touchpoint', context = 'touchpoint', subject = '' }) {
  const [aiOpen, setAiOpen] = useState(false)
  return (
    <>
      {children}
      <BottomNav active={active} onAskClick={() => setAiOpen(true)} aiOpen={aiOpen} />
      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} context={context} subject={subject} />
    </>
  )
}
