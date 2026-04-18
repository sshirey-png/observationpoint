import { useState } from 'react'
import Nav from '../components/Nav'
import { api } from '../lib/api'

/**
 * Insights — AI-powered natural language query interface.
 * The differentiator. Leader types a question, gets an answer from the data.
 */

const EXAMPLES = [
  'Which teachers scored below 3 on T4 this year?',
  'Who has the most touchpoints this year?',
  'Show me all staff at Phillis Wheatley with their last PMAP scores',
  'How has T1 changed across schools this year vs last?',
  'Which teachers have no observations this year?',
  'What is the average score for each dimension by school?',
]

export default function Insights() {
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function ask(q) {
    const queryText = q || question
    if (!queryText.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await api.post('/api/insights', { question: queryText })
      if (data) setResult(data)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  function useExample(q) {
    setQuestion(q)
    ask(q)
  }

  return (
    <div className="pb-10">
      <Nav title="Ask ObservationPoint" />

      <div className="px-4 pt-4">
        {/* Search bar */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <div className="text-base font-bold mb-1">Ask a question about your data</div>
          <div className="text-xs text-gray-400 mb-3">
            Natural language — Claude generates SQL, runs it, and summarizes the answer.
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ask()}
              placeholder="Which teachers improved most on T4?"
              className="flex-1 px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-fls-orange placeholder:text-gray-400"
            />
            <button
              onClick={() => ask()}
              disabled={loading || !question.trim()}
              className="px-5 py-3 rounded-[10px] bg-fls-orange text-white text-sm font-semibold disabled:opacity-50 shrink-0"
            >
              {loading ? '...' : 'Ask'}
            </button>
          </div>
        </div>

        {/* Examples */}
        {!result && !loading && !error && (
          <div className="mb-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Try these</div>
            <div className="space-y-1.5">
              {EXAMPLES.map(q => (
                <button
                  key={q}
                  onClick={() => useExample(q)}
                  className="w-full text-left px-3 py-2.5 bg-white rounded-lg text-[13px] text-gray-700 hover:bg-gray-50 shadow-sm"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <div className="text-2xl mb-2">🤔</div>
            <div className="text-sm font-semibold text-gray-700">Thinking...</div>
            <div className="text-xs text-gray-400 mt-1">Generating query and analyzing results</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
            <div className="text-sm font-semibold text-red-600">Something went wrong</div>
            <div className="text-xs text-red-500 mt-1">{error}</div>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-3">
            {/* Answer */}
            <div className="bg-white rounded-xl shadow-sm p-4">
              <div className="text-xs text-gray-400 mb-1">Answer</div>
              <div className="text-sm font-medium leading-relaxed">{result.answer}</div>
            </div>

            {/* Data table */}
            {result.rows && result.rows.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                  <div className="text-xs text-gray-400">{result.total} result{result.total !== 1 ? 's' : ''}</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {result.columns.map(col => (
                          <th key={col} className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                          {result.columns.map(col => (
                            <td key={col} className="px-3 py-2 whitespace-nowrap">
                              {row[col] !== null ? String(row[col]) : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SQL (collapsed) */}
            <details className="bg-gray-50 rounded-xl p-3">
              <summary className="text-[11px] font-semibold text-gray-400 cursor-pointer">View SQL</summary>
              <pre className="mt-2 text-[11px] text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">{result.sql}</pre>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}
