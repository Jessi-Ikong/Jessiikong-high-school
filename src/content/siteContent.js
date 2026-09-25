// =============================================================================
//  PUBLIC WEBSITE TEXT — edit freely.
//
//  Everything families read on the public website (apart from news, gallery
//  photos and the class / subject lists, which come from the database) lives
//  in this one file. Change the words between the quotes; keep the commas and
//  brackets. Paragraphs are separate strings in a list: add or remove lines.
//
//  Every field is labelled:
//    ✅ CONFIRMED       — a real fact supplied by the school. Don't change
//                         unless the fact itself changes.
//    🤖 AI PLACEHOLDER  — written by the AI assistant as a reasonable draft.
//                         NOT confirmed. Review, then replace or approve (and
//                         change the label to ✅ CONFIRMED once approved).
//
//  Confirmed so far (2026-09-25): founding year, address, phone number.
//  The school is BRAND NEW (founded 2026): nothing here should claim years of
//  history, past results or alumni.
// =============================================================================

export const school = {
  name: 'Jessiikong High School',
  shortName: 'Jessiikong',
  motto: 'Arise and Shine', // 🤖 AI PLACEHOLDER (matches the rising sun on the crest)
  tagline: 'A new secondary school for a new generation in North Ukelle, Cross River State.', // 🤖 AI PLACEHOLDER
  founded: 2026, // ✅ CONFIRMED
}

// Contact details (Contact page, footer, top bar).
export const contact = {
  // ✅ CONFIRMED: Oju Rd, Okah Idah, Wanihem, North Ukelle, Yala LGA, Cross River State
  addressLines: ['Oju Rd, Okah Idah', 'Wanihem, North Ukelle', 'Yala LGA, Cross River State'],
  phone: '+234 708 591 8344', // ✅ CONFIRMED
  whatsapp: '+234 708 591 8344', // 🤖 AI PLACEHOLDER — assumed to be the same number as the phone; confirm it has WhatsApp
  // 🤖 AI PLACEHOLDER — ⚠️ DOMAIN NOT DECIDED YET. These addresses do not exist.
  // Choose the school's real domain (e.g. a .edu.ng or .com.ng) and set up the
  // mailboxes, then replace both lines. Until then, emails sent here will bounce.
  email: 'info@jessiikonghighschool.ng',
  admissionsEmail: 'admissions@jessiikonghighschool.ng',
  officeHours: [
    // 🤖 AI PLACEHOLDER
    'Monday – Friday: 8:00 am – 4:00 pm',
    'Saturday: 9:00 am – 12:00 noon (admissions visits by appointment)',
  ],
  // Built from the ✅ CONFIRMED address (a Google Maps search for it, not a
  // guessed pin). Replace with the school's own Maps "Share" link once the
  // school is listed on Google Maps.
  mapLink:
    'https://www.google.com/maps/search/?api=1&query=Oju%20Rd%2C%20Okah%20Idah%2C%20Wanihem%2C%20North%20Ukelle%2C%20Yala%20LGA%2C%20Cross%20River%20State%2C%20Nigeria',
}

// ---------------------------------------------------------------- Home page
export const home = {
  heroEyebrow: 'Founded 2026 · Admissions open for our founding class', // 🤖 AI PLACEHOLDER (year ✅ confirmed)
  heroTitle: 'A new school, built for a new generation.', // 🤖 AI PLACEHOLDER
  heroText:
    'Jessiikong High School opens its doors in 2026 in North Ukelle, Cross River State — bringing quality secondary education close to home, with dedicated teachers, small classes and a strong foundation in learning and character.', // 🤖 AI PLACEHOLDER
  // Quick facts (big word/number + short label). 🤖 AI PLACEHOLDER — chosen to be
  // TRUE of a brand-new school (no years of operation, results or alumni claimed).
  facts: [
    { value: '2026', label: 'founded — be part of our very first chapter' }, // year ✅ confirmed
    { value: 'JSS1', label: 'founding class now admitting' }, // matches the classes currently set up
    { value: 'Small', label: 'classes, so every student is known by name' },
    { value: 'Online', label: 'parent portal for attendance, results & fees' }, // the school's portal exists
  ],
  // Three highlight cards. 🤖 AI PLACEHOLDER
  highlights: [
    {
      title: 'Be part of the founding class',
      text: 'Our first students help shape the traditions, clubs and culture of a brand-new school — and get the full attention of teachers building it with them.',
    },
    {
      title: 'Strong foundations',
      text: 'A rigorous Junior Secondary curriculum with regular assessment and feedback, so every student knows how they are doing and what comes next.',
    },
    {
      title: 'Character and community',
      text: 'Integrity, respect and service are taught and modelled every day, in a school rooted in the Ukelle community it serves.',
    },
  ],
  ctaTitle: 'Join our founding class', // 🤖 AI PLACEHOLDER
  ctaText: 'Tell us a little about your child and our admissions team will be in touch to arrange a visit.', // 🤖 AI PLACEHOLDER
}

// --------------------------------------------------------------- About page
export const about = {
  intro:
    'Jessiikong High School is a new co-educational secondary school in North Ukelle, Yala LGA, founded in 2026 to give young people in our community an excellent education close to home.', // 🤖 AI PLACEHOLDER (year and place ✅ confirmed)
  mission:
    'To provide a safe, caring and stimulating school where every student achieves their best academically, grows in character, and learns to serve their family, community and nation.', // 🤖 AI PLACEHOLDER
  vision:
    'To grow into one of the most trusted secondary schools in Cross River State — known for excellent teaching, strong values and young people ready to lead.', // 🤖 AI PLACEHOLDER
  history: [
    // 🤖 AI PLACEHOLDER — a draft founding story. Replace with the real story
    // (who founded the school, why, and any names, dates or milestones).
    'Jessiikong High School was founded in 2026 with a simple conviction: that children in North Ukelle and the wider Yala area deserve a first-class secondary education without having to travel far from home.',
    'We are beginning with our founding JSS1 class and will grow one year at a time, adding classes, teachers and facilities as our first students move up through the school.',
    'Our first students are not just joining a school — they are helping to build one. The traditions, clubs and standards they set now will shape Jessiikong for the generations that follow.',
  ],
  values: [
    // 🤖 AI PLACEHOLDER
    { title: 'Excellence', text: 'We aim high in everything we do, and help one another get there.' },
    { title: 'Integrity', text: 'We are honest, fair and responsible for our actions.' },
    { title: 'Respect', text: 'We value every person, every culture and every voice.' },
    { title: 'Service', text: 'We use what we learn to help our families and our community.' },
  ],
  principal: {
    // 🤖 AI PLACEHOLDER — ⚠️ NEEDS THE PRINCIPAL'S REAL NAME (shown on the site in brackets until replaced).
    name: '[Principal’s name — to be confirmed], Principal',
    message:
      'Welcome to Jessiikong High School. As a brand-new school, we have a rare opportunity: to build, together with our first students and their families, a school our community can be proud of for generations. Our doors are open — come and visit, meet our teachers, and see what we are building.',
  },
}

// ----------------------------------------------------------- Academics page
export const academics = {
  intro:
    'We follow the Nigerian national curriculum, beginning with Junior Secondary (JSS1) in our first year and adding classes as our students progress, through to BECE and, in Senior Secondary, WAEC and NECO. We believe in strong foundations in English and Mathematics, curious minds in science and the arts, and learning that connects to the world around us.', // 🤖 AI PLACEHOLDER
  // Shown above the class list and the subject list (which come from the school's records).
  classesNote: 'Classes currently offered',
  subjectsNote: 'Subjects taught across the school',
  approach: [
    // 🤖 AI PLACEHOLDER
    { title: 'Small classes', text: 'Teachers know every student and adapt to how they learn.' },
    { title: 'Continuous assessment', text: 'Regular tests, assignments and projects — not just end-of-term exams.' },
    { title: 'Parents in the loop', text: 'Families follow attendance, results and messages through our online portal.' },
  ],
}

// ---------------------------------------------------------- Admissions page
export const admissions = {
  intro:
    'Admissions are open for our founding JSS1 class. As a new school, places are limited, and our team is happy to help at every step — from your first question to your child’s first day.', // 🤖 AI PLACEHOLDER
  steps: [
    // 🤖 AI PLACEHOLDER
    { title: 'Send an inquiry', text: 'Fill in the form below. It takes two minutes.' },
    { title: 'Visit the school', text: 'We will call to arrange a visit and answer your questions.' },
    { title: 'Entrance assessment', text: 'A short assessment in English and Mathematics, plus a friendly conversation with your child.' },
    { title: 'Offer & enrolment', text: 'Successful candidates receive an offer letter and enrolment information.' },
  ],
  requirements: [
    // 🤖 AI PLACEHOLDER
    'Birth certificate (or sworn declaration of age)',
    'Primary school leaving certificate or latest Primary 6 report',
    'Two recent passport photographs',
    'Transfer letter and last school report (for transfer students only)',
  ],
  feesNote:
    'Fees are set per term, and full details are shared with every family during the admissions process. Please send an inquiry or call us to receive the current fee schedule.', // 🤖 AI PLACEHOLDER (no figures on purpose)
  formTitle: 'Admissions inquiry',
  formIntro: 'Tell us about your child and we will get back to you within two working days.', // 🤖 AI PLACEHOLDER (response time is a commitment: confirm it)
  thankYou:
    'Thank you for your interest in Jessiikong High School! We have received your inquiry, and our admissions team will contact you within two working days.', // 🤖 AI PLACEHOLDER
}

// ------------------------------------------------------------- Contact page
export const contactPage = {
  intro: 'We would love to hear from you. Call, send a WhatsApp message, email or use the form below, and we will reply as soon as we can.', // 🤖 AI PLACEHOLDER
  formTitle: 'Send us a message',
  thankYou: 'Thank you for your message. We will reply as soon as we can.', // 🤖 AI PLACEHOLDER
}
