import { useState, useRef, useEffect } from 'react'
import { api } from '../lib/api'

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
    ctx: 'Scoped to the network',
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
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef(null)
  const inputRef = useRef(null)
  const cfg = CONTEXTS[context] || CONTEXTS.home
  const ctxText = typeof cfg.ctx === 'function' ? cfg.ctx(subject) : cfg.ctx

  // Reset chat when context changes or panel closes
  useEffect(() => {
    if (!open) {
      setMessages([])
      setBusy(false)
    }
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

  async function ask(q) {
    if (!q || busy) return
    setBusy(true)
    setMessages(prev => [...prev, { role: 'user', text: q }])
    setInput('')
    setMessages(prev => [...prev, { role: 'ai', text: '…', thinking: true }])

    const finish = (patch) => {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'ai', ...patch }
        return next
      })
      setBusy(false)
      // Refocus input so user can immediately ask the next question
      setTimeout(() => inputRef.current?.focus(), 50)
    }

    try {
      const r = await api.post('/api/insights', { question: q })
      const looksUnhelpful = !r?.answer ||
        /cannot be answered|cannot answer|no data|no results|don't know|i don't have/i.test(r.answer)
      finish({
        text: r?.answer || "I couldn't produce an answer.",
        total: r?.total,
        unhelpful: looksUnhelpful,
      })
    } catch (e) {
      finish({
        text: `Sorry — ${e.message || 'that question failed'}. Try rephrasing?`,
        error: true,
      })
    }
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
      <div className="fixed bottom-0 left-0 right-0 z-[901] bg-white rounded-t-[22px] max-h-[88dvh] flex flex-col shadow-[0_-10px_32px_rgba(0,0,0,.22)] animate-slide-up">
        {/* Handle */}
        <div className="w-11 h-1 bg-gray-200 rounded-md mx-auto mt-2.5" />

        {/* Head (gradient) */}
        <div className="px-4 pt-5 pb-3.5 flex items-center gap-2.5 rounded-t-[22px] -mt-3.5 relative z-10" style={{ background: 'linear-gradient(135deg,#002f60,#1e40af)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base font-extrabold shrink-0" style={{ background: 'rgba(251,190,130,.2)', color: '#fbbe82' }}>✦</div>
          <div className="flex-1 text-white min-w-0">
            <div className="text-sm font-extrabold">Ask ObservationPoint</div>
            <div className="text-[11px] opacity-70 mt-0.5 truncate">{ctxText}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-10 h-10 rounded-lg bg-white/15 hover:bg-white/25 text-white flex items-center justify-center text-xl cursor-pointer border-0 p-0 shrink-0 touch-manipulation"
          >×</button>
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
                <div key={i} className={`rounded-[14px] rounded-tl-[3px] px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.error ? 'bg-red-50 text-red-900' : 'bg-gray-50 text-gray-900'
                }`}>
                  {m.thinking ? (
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" style={{ animationDelay: '300ms' }} />
                    </span>
                  ) : m.text}
                  {m.total != null && !m.thinking && (
                    <div className="text-[10px] text-gray-400 mt-1.5 font-semibold uppercase tracking-wide">
                      {m.total} record{m.total === 1 ? '' : 's'} analyzed
                    </div>
                  )}
                  {(m.error || m.unhelpful) && !m.thinking && (
                    <div className="text-[11px] text-gray-500 mt-2 pt-2 border-t border-gray-200/70">
                      Still stuck? Email{' '}
                      <a href="mailto:talent@firstlineschools.org" className="text-fls-orange font-semibold no-underline hover:underline">talent@firstlineschools.org</a>
                      {' '}for help.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-3.5 pt-2.5 pb-3.5 border-t border-gray-200 flex gap-1.5 relative z-10">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !busy && ask(input.trim())}
            placeholder={busy ? 'Thinking…' : 'Ask anything…'}
            disabled={busy}
            className="flex-1 border border-gray-200 outline-0 px-3.5 py-2.5 rounded-[20px] text-sm bg-gray-50 focus:bg-white focus:border-fls-navy font-[inherit] disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => !busy && ask(input.trim())}
            disabled={busy}
            className="px-4 py-2.5 bg-fls-navy text-white border-0 rounded-[20px] text-sm font-bold cursor-pointer font-[inherit] disabled:opacity-50"
          >↑</button>
        </div>
      </div>
    </>
  )
}
