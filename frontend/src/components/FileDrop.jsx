import { useState, useRef, useEffect } from 'react'
import { api } from '../lib/api'

/**
 * FileDrop — shared upload widget. Drops into any form.
 * Props:
 *   parentType: 'touchpoint' | 'goal' | 'assignment' | 'acknowledgment'
 *   parentId:   string (UUID) — required to associate uploads with a record
 *   formType?:  string — affects bucket selection (HR docs go to locked bucket)
 *   maxFiles?:  default 10
 *   compact?:   smaller render (used inline on tight forms)
 *   onChange?:  (uploads) => void — fires after each upload finalizes
 *
 * Direct-to-GCS via signed URLs. Lists existing uploads + lets user remove.
 */
export default function FileDrop({ parentType, parentId, formType, maxFiles = 10, compact = false, onChange }) {
  const [uploads, setUploads] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!parentType || !parentId) return
    api.get(`/api/uploads?parent_type=${encodeURIComponent(parentType)}&parent_id=${encodeURIComponent(parentId)}`)
      .then(r => { setUploads(Array.isArray(r) ? r : []) ; onChange?.(Array.isArray(r) ? r : []) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentType, parentId])

  async function uploadOne(file) {
    setError('')
    if (uploads.length >= maxFiles) { setError(`Max ${maxFiles} files reached.`); return }
    if (file.size > 100 * 1024 * 1024) { setError(`${file.name} is over 100 MB`); return }

    setBusy(true)
    try {
      const sign = await api.post('/api/uploads/sign', {
        parent_type: parentType,
        parent_id: parentId,
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
        form_type: formType || '',
      })
      if (!sign?.upload_url) throw new Error(sign?.error || 'sign failed')

      // PUT the file directly to GCS via signed URL
      const putRes = await fetch(sign.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': sign.mime_type || file.type || 'application/octet-stream' },
        body: file,
      })
      if (!putRes.ok) throw new Error(`GCS upload failed: ${putRes.status}`)

      const fin = await api.post(`/api/uploads/${sign.upload_id}/finalize`, {})
      if (fin?.id) {
        const next = [{
          id: fin.id, filename: fin.filename, mime_type: fin.mime_type,
          size_bytes: fin.size_bytes, uploaded_by: 'you', uploaded_at: new Date().toISOString(),
          bucket: fin.bucket,
        }, ...uploads]
        setUploads(next)
        onChange?.(next)
      }
    } catch (e) {
      setError(e.message || 'upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleFiles(filesList) {
    const files = Array.from(filesList || [])
    for (const f of files) {
      // serial upload — keeps progress predictable, avoids signed-url-window races
      // eslint-disable-next-line no-await-in-loop
      await uploadOne(f)
    }
  }

  async function downloadUpload(u) {
    try {
      const r = await api.get(`/api/uploads/${u.id}/download`)
      if (r?.url) window.location.href = r.url
    } catch (e) {
      setError('Download failed')
    }
  }

  async function removeUpload(u) {
    if (!confirm(`Remove ${u.filename}?`)) return
    try {
      await api.del(`/api/uploads/${u.id}`)
      const next = uploads.filter(x => x.id !== u.id)
      setUploads(next)
      onChange?.(next)
    } catch (e) {
      setError('Remove failed')
    }
  }

  const dropZone = {
    background: '#fff',
    border: '2px dashed #d1d5db',
    borderRadius: 10,
    padding: compact ? '12px 14px' : '18px 14px',
    textAlign: 'center',
    fontSize: compact ? 11 : 12,
    color: '#6b7280',
    cursor: 'pointer',
    fontFamily: 'inherit',
  }

  function fileIcon(mime) {
    if ((mime || '').startsWith('image/')) return '🖼️'
    if ((mime || '').startsWith('video/')) return '🎬'
    if ((mime || '').startsWith('audio/')) return '🎤'
    if (mime === 'application/pdf') return '📄'
    return '📎'
  }

  function fmtSize(b) {
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
    return `${(b / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault() }}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
        style={dropZone}
      >
        <div style={{ fontSize: compact ? 18 : 22, marginBottom: 4 }}>📎</div>
        <div style={{ fontWeight: 700, color: '#374151' }}>{busy ? 'Uploading…' : 'Drop files or tap to select'}</div>
        <div style={{ fontSize: compact ? 9 : 10, color: '#9ca3af', marginTop: 2 }}>PDF, image, audio, or video — up to 100 MB each</div>
        <input ref={inputRef} type="file" multiple onChange={e => handleFiles(e.target.files)} style={{ display: 'none' }} />
      </div>
      {error && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 6 }}>{error}</div>}
      {uploads.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {uploads.map(u => (
            <div key={u.id} style={{ background: '#fff', borderRadius: 8, padding: '8px 10px', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 16, flexShrink: 0 }}>{fileIcon(u.mime_type)}</div>
              <button
                onClick={() => downloadUpload(u)}
                style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minWidth: 0 }}
              >
                <div style={{ color: '#111827', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.filename}</div>
                <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1 }}>
                  {fmtSize(u.size_bytes)}
                  {u.bucket === 'hr-locked' && <span style={{ marginLeft: 6, color: '#6b7280' }}>🔒 HR-locked</span>}
                  {u.delete_at && <span style={{ marginLeft: 6, color: '#9ca3af' }}>auto-delete {new Date(u.delete_at).toLocaleDateString()}</span>}
                </div>
              </button>
              <button
                onClick={() => removeUpload(u)}
                style={{ fontSize: 10, color: '#dc2626', fontWeight: 700, background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' }}
              >Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
