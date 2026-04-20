import { useState, useRef, useEffect } from 'react'

/**
 * AIPanel — slide-up inline chat. Opens on the current page; never navigates.
 * Context prop determines the intro text and suggested questions.
 *
 * Usage:
 *   <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} context="profile" subject="Marcus Williams" />
 */

const CONTEXTS = {
  home: {
    ctx: 'Scoped to you · full access to your data',
    intro: 'Ask anything. Suggestions are a starting point; input is open.',
    suggestions: [
      'Worth a look this week?',
      'Has anyone improved a lot this month?',
      'Which PMAPs are due in the next 30 days?',
    ],
  },
  team: {
    ctx: subj => `Scoped to your team${subj ? ' · ' + subj : ''}`,
    intro: 'Ask about your team — or anything else.',
    suggestions: [
      "Who hasn't been observed in 30+ days?",
      "Who's improved the most this year?",
      "What's the team's lowest-scoring dimension?",
    ],
  },
  profile: {
    ctx: subj => `Scoped to ${subj || 'this teacher'}`,
    intro: 'Ask about this teacher — or anything else.',
    suggestions: [
      "What's improved most this year?",
      'Are there open action items from meetings?',
      'Compare to the grade-level average',
    ],
  },
  network: {
    ctx: 'Scoped to the network · 4 schools · 187 teachers',
    intro: 'Ask about the network — or anything else.',
    suggestions: [
      'Which school gained the most on Demo of Learning?',
      'Recognition ratio by school',
      'Teachers quiet for 30+ days by school',
    ],
  },
  touchpoint: {
    ctx: 'Scoped to touchpoint activity',
    intro: 'Ask about touchpoint activity — or anything else.',
    suggestions: [
      'How many touchpoints did I log this month?',
      "Who haven't I touched in 30 days?",
      "What's the mix across observation / feedback / celebrate?",
    ],
  },
}

export default function AIPanel({ open, onClose, context = 'home', subject = '' }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const bodyRef = useRef(null)
  const cfg = CONTEXTS[context] || CONTEXTS.home
  const ctxText = typeof cfg.ctx === 'function' ? cfg.ctx(subject) : cfg.ctx

  // Reset chat when context changes or panel closes
  useEffect(() => {
    if (!open) setMessages([])
  }, [open, context])

  // Auto-scroll on new messages
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages])

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  function ask(q) {
    if (!q) return
    setMessages(prev => [...prev, { role: 'user', text: q }])
    setInput('')
    setTimeout(() => {
      setMessages(prev => [...prev, {
        role: 'ai',
        text: "I'd answer that live from your data. This prototype shows the interaction pattern — a real build hits the API.",
      }])
    }, 450)
  }

  if (!open) return (
    <div
      className="fixed inset-0 bg-black/45 z-[900] opacity-0 pointer-events-none transition-opacity duration-200"
    />
  )

  return (
    <>
      <div
        className="fixed inset-0 bg-black/45 z-[900] opacity-100 transition-opacity duration-200"
        onClick={onClose}
      />
      <div className="fixed bottom-0 left-0 right-0 z-[901] bg-white rounded-t-[22px] max-h-[88vh] flex flex-col shadow-[0_-10px_32px_rgba(0,0,0,.22)] animate-slide-up">
        {/* Handle */}
        <div className="w-11 h-1 bg-gray-200 rounded-md mx-auto mt-2.5" />

        {/* Head (gradient) */}
        <div className="px-4 pt-5 pb-3.5 flex items-center gap-2.5 rounded-t-[22px] -mt-3.5" style={{ background: 'linear-gradient(135deg,#002f60,#1e40af)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base font-extrabold" style={{ background: 'rgba(251,190,130,.2)', color: '#fbbe82' }}>✦</div>
          <div className="flex-1 text-white">
            <div className="text-sm font-extrabold">Ask ObservationPoint</div>
            <div className="text-[11px] opacity-70 mt-0.5">{ctxText}</div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-white/10 text-white flex items-center justify-center text-lg cursor-pointer border-0 p-0">×</button>
        </div>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3.5 min-h-[140px]">
          {messages.length === 0 ? (
            <>
              <div className="text-xs text-gray-500 leading-relaxed mb-3">{cfg.intro}</div>
              {cfg.suggestions.map(s => (
                <div
                  key={s}
                  onClick={() => ask(s)}
                  className="flex gap-2.5 px-3 py-2.5 rounded-lg bg-gray-50 cursor-pointer mb-1.5 items-start border border-transparent hover:bg-gray-100 hover:border-gray-200"
                >
                  <div className="flex-1 text-sm text-gray-900 font-semibold leading-snug">{s}</div>
                  <div className="text-fls-orange font-extrabold text-sm">↑</div>
                </div>
              ))}
            </>
          ) : (
            <div className="flex flex-col gap-2.5">
              {messages.map((m, i) => m.role === 'user' ? (
                <div key={i} className="self-end max-w-[85%] bg-fls-navy text-white px-3.5 py-2 rounded-[14px] rounded-br-[3px] text-sm leading-snug">
                  {m.text}
                </div>
              ) : (
                <div key={i} className="bg-gray-50 rounded-[14px] rounded-tl-[3px] px-3.5 py-2.5 text-sm leading-relaxed text-gray-900">
                  {m.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-3.5 pt-2.5 pb-3.5 border-t border-gray-200 flex gap-1.5">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && ask(input.trim())}
            placeholder="Ask anything…"
            className="flex-1 border border-gray-200 outline-0 px-3.5 py-2.5 rounded-[20px] text-sm bg-gray-50 focus:bg-white focus:border-fls-navy font-[inherit]"
          />
          <button
            onClick={() => ask(input.trim())}
            className="px-4 py-2.5 bg-fls-navy text-white border-0 rounded-[20px] text-sm font-bold cursor-pointer font-[inherit]"
          >↑</button>
        </div>
      </div>
    </>
  )
}
