import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { gradeFor, scaleProblems } from '../../lib/grading'
import { useAsyncData } from '../../hooks/useAsyncData'

function fetchScale() {
  return run(
    supabase.from('grading_scale').select('id, grade, min_score, max_score, remark').order('min_score', { ascending: false }),
  )
}

const toDraft = (scale) =>
  scale.map((b) => ({
    key: b.id,
    grade: b.grade,
    min_score: String(b.min_score),
    max_score: String(b.max_score),
    remark: b.remark ?? '',
  }))

export default function GradeScale() {
  const query = useAsyncData(fetchScale, 'grading-scale')
  const [savedMessage, setSavedMessage] = useState(null)

  return (
    <>
      <h1>Grade scale</h1>
      <p className="muted">
        The letter grade for each percentage, used across the whole school (Gradebook, Class Ranking, and later report
        cards). Bands are whole numbers and include both ends (e.g. B = 60–69). A percentage is rounded to the nearest
        whole number first, so 69.5% counts as 70%.
      </p>

      {query.loading ? (
        <p className="muted">Loading the grade scale…</p>
      ) : query.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
      ) : (
        <ScaleEditor
          key={JSON.stringify(query.data)}
          saved={query.data}
          savedMessage={savedMessage}
          onSaved={() => {
            setSavedMessage('Grade scale saved.')
            query.reload()
          }}
          onEdit={() => setSavedMessage(null)}
        />
      )}
    </>
  )
}

function ScaleEditor({ saved, savedMessage, onSaved, onEdit }) {
  const [draft, setDraft] = useState(() => toDraft(saved))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [previewScore, setPreviewScore] = useState('72')

  const problems = scaleProblems(draft)
  const isDirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved))
  const draftScale = draft.map((b) => ({ ...b, min_score: Number(b.min_score), max_score: Number(b.max_score) }))

  function update(key, field, value) {
    setDraft((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)))
    setError(null)
    onEdit()
  }

  function addBand() {
    setDraft((rows) => [...rows, { key: `new-${Date.now()}`, grade: '', min_score: '', max_score: '', remark: '' }])
    onEdit()
  }

  function removeBand(key) {
    setDraft((rows) => rows.filter((r) => r.key !== key))
    setError(null)
    onEdit()
  }

  async function handleSave(event) {
    event.preventDefault()
    setError(null)
    if (problems.length > 0) return
    setSaving(true)
    try {
      // The whole scale is replaced in one save; the database re-checks the
      // no-gaps / no-overlaps rule before accepting it.
      await run(
        supabase.rpc('replace_grading_scale', {
          p_bands: draft.map((b) => ({
            grade: b.grade.trim(),
            min_score: Number(b.min_score),
            max_score: Number(b.max_score),
            remark: b.remark.trim() || null,
          })),
        }),
      )
      onSaved()
    } catch (err) {
      setError(
        friendlyDbError(err, {
          unique: 'Each grade letter can only be used once.',
          exclusion: 'Two grade bands overlap. Every score from 0 to 100 must belong to exactly one grade.',
          check: 'Scores must be whole numbers from 0 to 100, with each band’s lowest score not above its highest.',
        }),
      )
    } finally {
      setSaving(false)
    }
  }

  const previewSaved = gradeFor(previewScore, saved)
  const previewDraft = problems.length === 0 ? gradeFor(previewScore, draftScale) : null
  const previewValid = previewScore.trim() !== '' && !Number.isNaN(Number(previewScore))

  return (
    <form onSubmit={handleSave}>
      {savedMessage && <p className="alert alert-success" role="status">{savedMessage}</p>}

      <div className="panel preview-panel">
        <label className="preview-line">
          e.g. a score of
          <input
            type="number"
            min="0"
            max="100"
            step="any"
            value={previewScore}
            onChange={(e) => setPreviewScore(e.target.value)}
            aria-label="Example score"
          />
          % would currently be graded:{' '}
          <strong className="preview-grade">
            {previewValid ? (previewSaved ? `${previewSaved.grade}${previewSaved.remark ? ` (${previewSaved.remark})` : ''}` : '—') : '—'}
          </strong>
        </label>
        {isDirty && previewValid && (
          <p className="muted small">
            With your unsaved changes it would be:{' '}
            <strong>{previewDraft ? previewDraft.grade : '— (fix the problems below first)'}</strong>
          </p>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table scale-table">
          <thead>
            <tr>
              <th>Grade</th>
              <th>From (%)</th>
              <th>To (%)</th>
              <th>Remark (optional)</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {draft.map((b) => (
              <tr key={b.key}>
                <td>
                  <input value={b.grade} onChange={(e) => update(b.key, 'grade', e.target.value)} aria-label="Grade letter" placeholder="A" required />
                </td>
                <td>
                  <input type="number" min="0" max="100" step="1" value={b.min_score} onChange={(e) => update(b.key, 'min_score', e.target.value)} aria-label={`Lowest score for ${b.grade || 'this grade'}`} required />
                </td>
                <td>
                  <input type="number" min="0" max="100" step="1" value={b.max_score} onChange={(e) => update(b.key, 'max_score', e.target.value)} aria-label={`Highest score for ${b.grade || 'this grade'}`} required />
                </td>
                <td>
                  <input value={b.remark} onChange={(e) => update(b.key, 'remark', e.target.value)} aria-label={`Remark for ${b.grade || 'this grade'}`} placeholder="Excellent" />
                </td>
                <td className="row-actions">
                  <button type="button" className="button-link danger" onClick={() => removeBand(b.key)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar">
        <button type="button" className="button-secondary" onClick={addBand}>
          + Add band
        </button>
        <span className="muted small">Edit the bands above, then save. Changes only take effect once saved.</span>
      </div>

      {problems.length > 0 && (
        <div className="alert alert-error" role="alert">
          <strong>Fix these before saving:</strong>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="form-actions">
        <button type="submit" disabled={saving || !isDirty || problems.length > 0}>
          {saving ? 'Saving…' : 'Save grade scale'}
        </button>
        {isDirty && (
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setDraft(toDraft(saved))
              setError(null)
            }}
          >
            Discard changes
          </button>
        )}
      </div>
    </form>
  )
}
