import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { gradeFor, scaleProblems } from '../../lib/grading'
import { useAsyncData } from '../../hooks/useAsyncData'
import { Alert, Button, Card, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { TextInput } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'

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
      <PageHeader
        title="Grade scale"
        subtitle="The letter grade for each percentage, used across the whole school (Gradebook, Class Ranking, and later report cards). Bands are whole numbers and include both ends (e.g. B = 60–69). A percentage is rounded to the nearest whole number first, so 69.5% counts as 70%."
      />

      {query.loading ? (
        <LoadingState lines={6} />
      ) : query.error ? (
        <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
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
      {savedMessage && <Alert tone="success">{savedMessage}</Alert>}

      <Card title="Try a score">
        <label className="ds-inline" style={{ fontSize: 'var(--ds-text-sm)' }}>
          e.g. a score of
          <span style={{ width: 96 }}>
            <TextInput
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="any"
              value={previewScore}
              onChange={(e) => setPreviewScore(e.target.value)}
              aria-label="Example score"
            />
          </span>
          % would currently be graded:{' '}
          <strong style={{ fontSize: 'var(--ds-text-lg)' }}>
            {previewValid ? (previewSaved ? `${previewSaved.grade}${previewSaved.remark ? ` (${previewSaved.remark})` : ''}` : '—') : '—'}
          </strong>
        </label>
        {isDirty && previewValid && (
          <p className="ds-note" style={{ marginTop: 8, marginBottom: 0 }}>
            With your unsaved changes it would be: <strong>{previewDraft ? previewDraft.grade : '— (fix the problems below first)'}</strong>
          </p>
        )}
      </Card>

      <Card title="Grade bands" flush>
        <DataTable
          caption="Grade bands"
          rowKey={(b) => b.key}
          rows={draft}
          columns={[
            {
              key: 'grade',
              header: 'Grade',
              primary: true,
              render: (b) => <TextInput value={b.grade} onChange={(e) => update(b.key, 'grade', e.target.value)} aria-label="Grade letter" placeholder="A" required />,
            },
            {
              key: 'min',
              header: 'From (%)',
              stack: true,
              render: (b) => (
                <TextInput
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="100"
                  step="1"
                  value={b.min_score}
                  onChange={(e) => update(b.key, 'min_score', e.target.value)}
                  aria-label={`Lowest score for ${b.grade || 'this grade'}`}
                  required
                />
              ),
            },
            {
              key: 'max',
              header: 'To (%)',
              stack: true,
              render: (b) => (
                <TextInput
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="100"
                  step="1"
                  value={b.max_score}
                  onChange={(e) => update(b.key, 'max_score', e.target.value)}
                  aria-label={`Highest score for ${b.grade || 'this grade'}`}
                  required
                />
              ),
            },
            {
              key: 'remark',
              header: 'Remark (optional)',
              stack: true,
              render: (b) => (
                <TextInput value={b.remark} onChange={(e) => update(b.key, 'remark', e.target.value)} aria-label={`Remark for ${b.grade || 'this grade'}`} placeholder="Excellent" />
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (b) => (
                <div className="ds-row-actions">
                  <button type="button" className="ds-btn ds-btn-link ds-btn-link-danger" onClick={() => removeBand(b.key)}>
                    Delete
                  </button>
                </div>
              ),
            },
          ]}
        />
        <div className="ds-card-body">
          <div className="ds-inline">
            <Button variant="secondary" onClick={addBand}>
              + Add band
            </Button>
            <span className="ds-muted ds-small">Edit the bands above, then save. Changes only take effect once saved.</span>
          </div>
        </div>
      </Card>

      {problems.length > 0 && (
        <Alert tone="danger">
          <strong>Fix these before saving:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="ds-form-actions">
        {isDirty && (
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(toDraft(saved))
              setError(null)
            }}
          >
            Discard changes
          </Button>
        )}
        <Button type="submit" disabled={saving || !isDirty || problems.length > 0}>
          {saving ? 'Saving…' : 'Save grade scale'}
        </Button>
      </div>
    </form>
  )
}
