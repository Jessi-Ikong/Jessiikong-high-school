// The school crest: a shield with a rising sun over an open book.
// Colours come from the public site's palette (see styles/public.css).
export default function Crest({ size = 44, title = 'Jessiikong High School crest' }) {
  return (
    <svg className="pub-crest" width={size} height={size * 1.15} viewBox="0 0 80 92" role="img" aria-label={title}>
      <path d="M40 2 L76 12 V44 C76 66 60 82 40 90 C20 82 4 66 4 44 V12 Z" fill="var(--pub-green)" stroke="var(--pub-gold)" strokeWidth="3" />
      <path d="M40 9 L69 17 V44 C69 61 57 74 40 81 C23 74 11 61 11 44 V17 Z" fill="none" stroke="var(--pub-gold)" strokeWidth="1" opacity="0.55" />
      {/* rising sun */}
      <path d="M22 44 A18 18 0 0 1 58 44 Z" fill="var(--pub-gold)" />
      {[-60, -30, 0, 30, 60].map((a) => (
        <line
          key={a}
          x1="40"
          y1="44"
          x2={40 + 26 * Math.sin((a * Math.PI) / 180)}
          y2={44 - 26 * Math.cos((a * Math.PI) / 180)}
          stroke="var(--pub-gold)"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.8"
        />
      ))}
      {/* open book */}
      <path d="M17 50 C26 46 34 47 40 52 C46 47 54 46 63 50 V66 C54 62 46 63 40 68 C34 63 26 62 17 66 Z" fill="var(--pub-cream)" />
      <path d="M40 52 V68" stroke="var(--pub-green)" strokeWidth="1.5" />
    </svg>
  )
}
