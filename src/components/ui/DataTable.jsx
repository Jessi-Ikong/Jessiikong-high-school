import '../../styles/app.css'

// A data table that works on phones: a normal table when it has 600px+ of
// its own width; below that each row becomes a card (the "primary" column is the card title, the
// others are "Label  value" lines) — no sideways scrolling.
//
// columns: [{ key, header, render?: (row) => node, primary?: bool, numeric?: bool, stack?: bool }]
// stack: on phones, put the label ABOVE the value (for rich cells: lists, forms).
export default function DataTable({ columns, rows, rowKey, caption, empty = null }) {
  if (rows.length === 0 && empty) return empty
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">
        {caption && <caption className="ds-visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'ds-table-num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  data-label={c.header}
                  className={[c.primary ? 'ds-td-primary' : '', c.numeric ? 'ds-table-num' : '', c.stack ? 'ds-td-stack' : ''].filter(Boolean).join(' ') || undefined}
                >
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
