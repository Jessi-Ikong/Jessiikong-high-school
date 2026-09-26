import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { gradeFor, weightTotal } from '../../lib/grading'
import { useAsyncData } from '../../hooks/useAsyncData'
import { Alert, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui/Primitives'
import { Field, Select } from '../../components/ui/Form'
import DataTable from '../../components/ui/DataTable'

async function fetchSetup() {
  const [terms, classes, sections] = await Promise.all([
    run(supabase.from('terms').select('id, name, is_current, start_date, sessions(name)').order('start_date', { ascending: false })),
    run(supabase.from('classes').select('id, name, level').order('level')),
    run(supabase.from('sections').select('id, class_id, name').order('name')),
  ])
  return { terms, classes, sections }
}

// Ranking rows (computed live by the database) + which subjects are left out
// because their components don't add up to 100%.
async function fetchRanking(termId, sectionId) {
  const [rows, components, scale] = await Promise.all([
    run(supabase.rpc('get_class_rankings', { p_term_id: termId, p_section_id: sectionId })),
    run(supabase.from('assessment_components').select('subject_id, weight, subjects(name)').eq('term_id', termId)),
    run(supabase.from('grading_scale').select('grade, min_score, max_score, remark')),
  ])
  const bySubject = new Map()
  for (const c of components) {
    if (!bySubject.has(c.subject_id)) bySubject.set(c.subject_id, { name: c.subjects.name, components: [] })
    bySubject.get(c.subject_id).components.push(c)
  }
  const incomplete = [...bySubject.values()]
    .map((s) => ({ name: s.name, total: weightTotal(s.components) }))
    .filter((s) => s.total !== 100)
    .sort((a, b) => a.name.localeCompare(b.name))
  return { rows, incomplete, scale }
}

export default function ClassRanking() {
  const setup = useAsyncData(fetchSetup, 'ranking-setup')
  if (setup.loading) return <LoadingState lines={6} />
  if (setup.error) return <Alert tone="danger">{friendlyDbError(setup.error)}</Alert>

  const { terms, sections } = setup.data
  if (terms.length === 0 || sections.length === 0) {
    return (
      <>
        <PageHeader title="Class ranking" />
        <Card>
          <EmptyState icon="chart" title="A few things first">
            Create a <Link to="/admin/terms">term</Link> and a <Link to="/admin/classes">class with a section</Link> first.
          </EmptyState>
        </Card>
      </>
    )
  }
  return <RankingView {...setup.data} />
}

function RankingView({ terms, classes, sections }) {
  const [chosenTermId, setChosenTermId] = useState(null)
  const [chosenClassId, setChosenClassId] = useState(null)
  const [chosenSectionId, setChosenSectionId] = useState(null)

  const term = terms.find((t) => t.id === chosenTermId) ?? terms.find((t) => t.is_current) ?? terms[0]
  const classesWithSections = classes.filter((c) => sections.some((s) => s.class_id === c.id))
  const cls = classesWithSections.find((c) => c.id === chosenClassId) ?? classesWithSections[0]
  const classSections = sections.filter((s) => s.class_id === cls.id)
  const section = classSections.find((s) => s.id === chosenSectionId) ?? classSections[0]

  const query = useAsyncData(() => fetchRanking(term.id, section.id), `ranking:${term.id}:${section.id}`)

  return (
    <>
      <PageHeader
        title="Class ranking"
        subtitle="Position of each student in their section for a term, by their average across all subjects. Worked out live from the scores entered so far. Nothing is stored, so it changes as soon as a score changes."
      />

      <div className="ds-filters">
        <Field label="Term">
          {(p) => (
            <Select {...p} value={term.id} onChange={(e) => setChosenTermId(e.target.value)}>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}, {t.sessions.name}
                  {t.is_current ? ' (current)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Class">
          {(p) => (
            <Select
              {...p}
              value={cls.id}
              onChange={(e) => {
                setChosenClassId(e.target.value)
                setChosenSectionId(null)
              }}
            >
              {classesWithSections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Section">
          {(p) => (
            <Select {...p} value={section.id} onChange={(e) => setChosenSectionId(e.target.value)}>
              {classSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {query.loading ? (
        <LoadingState lines={5} label="Working out positions…" />
      ) : query.error ? (
        <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
      ) : (
        <>
          {query.data.incomplete.length > 0 && (
            <Alert tone="info">
              Not counted this term because their assessment components don&apos;t add up to 100%:{' '}
              {query.data.incomplete.map((s) => `${s.name} (${s.total}%)`).join(', ')}. <Link to="/admin/assessment">Fix in Assessment components</Link>.
            </Alert>
          )}
          <Card title={`${cls.name} ${section.name} · ${term.name}`} flush>
            <DataTable
              caption={`Class ranking for ${cls.name} ${section.name}`}
              rowKey={(r) => r.enrollment_id}
              rows={query.data.rows}
              empty={
                <EmptyState icon="chart">
                  No ranking for {cls.name} {section.name} in {term.name} yet — no scores have been entered for its students.
                </EmptyState>
              }
              columns={[
                { key: 'student', header: 'Student', primary: true, render: (r) => r.full_name },
                {
                  key: 'position',
                  header: 'Position',
                  render: (r) => (
                    <span>
                      <strong>{ordinal(r.position)}</strong> <span className="ds-muted ds-small">of {r.class_size}</span>
                    </span>
                  ),
                },
                { key: 'admission', header: 'Admission no.', render: (r) => r.admission_number },
                { key: 'subjects', header: 'Subjects counted', numeric: true, render: (r) => r.subjects_counted },
                { key: 'average', header: 'Average', numeric: true, render: (r) => `${Number(r.average_score).toFixed(2)}%` },
                {
                  key: 'grade',
                  header: 'Grade',
                  render: (r) => {
                    const band = gradeFor(r.average_score, query.data.scale)
                    return band ? (
                      <span>
                        <strong>{band.grade}</strong>
                        {band.remark && <span className="ds-muted ds-small"> {band.remark}</span>}
                      </span>
                    ) : (
                      '—'
                    )
                  },
                },
              ]}
            />
          </Card>
          <p className="ds-note">
            How it&apos;s worked out: for each subject, each assessment component counts once at least one score has been entered for it in this section (a
            student missing that score gets 0 for it). The subject % is the weighted share of those components. A student&apos;s average is the mean of their
            subject %s. Students with equal averages share a position (1st, 1st, 3rd). The grade is the school grade scale applied to the average, rounded to the
            nearest whole number (<Link to="/admin/grade-scale">edit the grade scale</Link>).
          </p>
        </>
      )}
    </>
  )
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
