/**
 * SendCopyToggle — small "Send me a copy" checkbox shared across forms.
 *
 * When checked, the form's submit handler must include `cc_self: true`
 * inside the touchpoint's `feedback` JSON. The notify endpoint reads
 * that flag and adds the submitter to the email CC list.
 *
 * For Self-Reflection, override the label to "Send myself a copy" since
 * the recipient is the user's supervisor (not themselves).
 */
export default function SendCopyToggle({ checked, onChange, label = 'Send me a copy', help }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
      background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb',
      cursor: 'pointer', userSelect: 'none', fontFamily: 'inherit'
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: '#002f60', width: 16, height: 16, cursor: 'pointer' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{label}</div>
        {help && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{help}</div>}
      </div>
    </label>
  )
}
