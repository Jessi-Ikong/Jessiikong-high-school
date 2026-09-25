import { termLabel } from '../lib/corrections'

// Term / class / section selects for the admin correction screens.
// value: { termId, classId, sectionId }; onChange(next). allowAll: the class
// and section can be left as "All" (assignment browsing).
export default function TermClassSectionPicker({ setup, value, onChange, allowAll = false, children }) {
  const { terms, classes, sections } = setup
  const classSections = sections.filter((s) => s.class_id === value.classId)

  return (
    <div className="filter-bar">
      <label className="inline-field">
        Term
        <select value={value.termId} onChange={(e) => onChange({ ...value, termId: e.target.value })}>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {termLabel(t)}
            </option>
          ))}
        </select>
      </label>
      <label className="inline-field">
        Class
        <select value={value.classId} onChange={(e) => onChange({ ...value, classId: e.target.value, sectionId: '' })}>
          <option value="">{allowAll ? 'All classes' : 'Choose a class'}</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="inline-field">
        Section
        <select value={value.sectionId} onChange={(e) => onChange({ ...value, sectionId: e.target.value })} disabled={!value.classId}>
          <option value="">
            {!value.classId ? 'Choose a class first' : allowAll ? 'All sections' : classSections.length ? 'Choose a section' : 'No sections'}
          </option>
          {classSections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {children}
    </div>
  )
}
