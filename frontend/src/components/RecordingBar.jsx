import { useState, useRef } from 'react'

/**
 * RecordingBar — audio recording toggle with timer and AI toggle.
 * Matches the vanilla JS prototype: red pulse when recording, timer counting up.
 *
 * Props:
 *   onToggleAI(enabled) — called when AI toggle changes
 */
export default function RecordingBar({ onToggleAI }) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [aiEnabled, setAiEnabled] = useState(true)
  const intervalRef = useRef(null)

  function toggle() {
    if (recording) {
      // Stop
      clearInterval(intervalRef.current)
      setRecording(false)
    } else {
      // Start
      setRecording(true)
      intervalRef.current = setInterval(() => {
        setSeconds(s => s + 1)
      }, 1000)
    }
  }

  function toggleAI() {
    const next = !aiEnabled
    setAiEnabled(next)
    onToggleAI?.(next)
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <div
      onClick={toggle}
      className={`flex items-center gap-3 px-3.5 py-3 rounded-xl shadow-sm cursor-pointer transition-all ${
        recording ? 'bg-red-50 border border-red-200' : 'bg-white'
      }`}
    >
      {/* Record button */}
      <div
        className={`w-11 h-11 rounded-full border-[2.5px] border-red-600 bg-white flex items-center justify-center shrink-0 ${
          recording ? 'animate-pulse' : ''
        }`}
      >
        <div
          className={`bg-red-600 transition-all ${
            recording ? 'w-3.5 h-3.5 rounded-sm' : 'w-[18px] h-[18px] rounded-full'
          }`}
        />
      </div>

      {/* Timer */}
      <div>
        <div className={`text-lg font-bold tabular-nums ${recording ? 'text-red-600' : ''}`}>
          {mm}:{ss}
        </div>
        <div className={`text-[11px] ${recording ? 'text-red-600' : 'text-gray-400'}`}>
          {recording ? 'Recording...' : seconds > 0 ? 'Paused — tap to resume' : 'Tap to record'}
        </div>
      </div>

      {/* AI Toggle */}
      <div
        className="ml-auto flex items-center gap-1.5 text-xs text-gray-500"
        onClick={(e) => { e.stopPropagation(); toggleAI() }}
      >
        <span>AI</span>
        <div
          className={`w-10 h-[22px] rounded-full relative cursor-pointer transition-colors ${
            aiEnabled ? 'bg-fls-orange' : 'bg-gray-300'
          }`}
        >
          <div
            className={`w-[18px] h-[18px] rounded-full bg-white absolute top-[2px] shadow transition-all ${
              aiEnabled ? 'left-5' : 'left-[2px]'
            }`}
          />
        </div>
      </div>
    </div>
  )
}
