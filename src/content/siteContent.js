// =============================================================================
//  PUBLIC WEBSITE TEXT — edit freely.
//
//  Everything families read on the public website (apart from news, gallery
//  photos and the class / subject lists, which come from the database) lives
//  in this one file. Change the words between the quotes; keep the commas and
//  brackets. Paragraphs are separate strings in a list: add or remove lines.
//
//  Items marked PLACEHOLDER are made up and MUST be replaced with the
//  school's real details before the site goes public.
// =============================================================================

export const school = {
  name: 'Jessiikong High School',
  shortName: 'Jessiikong',
  motto: 'Knowledge · Character · Service', // PLACEHOLDER
  tagline: 'A secondary school where curious minds grow into confident, caring leaders.', // PLACEHOLDER
  founded: 2010, // PLACEHOLDER
}

// Contact details (Contact page, footer, top bar). PLACEHOLDER — all of them.
export const contact = {
  addressLines: ['12 Unity Crescent', 'Off Ahmadu Bello Way', 'Abuja, FCT, Nigeria'],
  phone: '+234 800 000 0000',
  whatsapp: '+234 800 000 0000',
  email: 'info@jessiikong.edu.ng',
  admissionsEmail: 'admissions@jessiikong.edu.ng',
  officeHours: ['Monday – Friday: 7:30 am – 4:00 pm', 'Saturday: 9:00 am – 1:00 pm (admissions visits by appointment)'],
  // Link for "Get directions" (paste the school's Google Maps share link here).
  mapLink: 'https://maps.google.com/?q=Abuja',
}

// ---------------------------------------------------------------- Home page
export const home = {
  heroEyebrow: 'Admissions open for the new session', // PLACEHOLDER
  heroTitle: 'Where every learner is known, stretched and celebrated.',
  heroText:
    'From JSS1 to SS3, Jessiikong High School pairs a strong academic foundation with character, creativity and care — in small classes led by dedicated teachers.', // PLACEHOLDER
  // Quick facts (big number + short label). PLACEHOLDER numbers.
  facts: [
    { value: '15+', label: 'years of teaching excellence' },
    { value: '1:20', label: 'teacher-to-student ratio' },
    { value: '98%', label: 'WAEC credit pass rate' },
    { value: '12', label: 'clubs & societies' },
  ],
  // Three highlight cards.
  highlights: [
    {
      title: 'Strong academics',
      text: 'A broad, rigorous curriculum with regular feedback, so every student knows how they are doing and what comes next.',
    },
    {
      title: 'Character first',
      text: 'Integrity, respect and service are taught, modelled and celebrated in every classroom and on every field.',
    },
    {
      title: 'Room to explore',
      text: 'Sports, arts, debate, coding and more — because confident young people grow outside the classroom too.',
    },
  ],
  ctaTitle: 'Thinking about joining us?',
  ctaText: 'Tell us a little about your child and our admissions team will be in touch to arrange a visit.',
}

// --------------------------------------------------------------- About page
export const about = {
  intro:
    'Jessiikong High School is a co-educational secondary school committed to academic excellence and to raising young people of good character.', // PLACEHOLDER
  mission:
    'To provide a safe, stimulating environment where every student achieves their best academically, grows in character, and learns to serve their community.', // PLACEHOLDER
  vision:
    'To be a school families trust and students love — known for excellent teaching, strong values and graduates ready for the world.', // PLACEHOLDER
  history: [
    // PLACEHOLDER — replace with the school's real story.
    'Jessiikong High School opened its doors in 2010 with a handful of classrooms, a small team of teachers and a big belief: that every child deserves to be known by name and taught with care.',
    'Over the years the school has grown in students, staff and facilities, adding science laboratories, a library and sports grounds — while keeping the close, family feel that parents value.',
    'Today our graduates continue to universities across Nigeria and beyond, and many return to share their stories with the students following in their footsteps.',
  ],
  values: [
    { title: 'Excellence', text: 'We aim high and support one another to get there.' },
    { title: 'Integrity', text: 'We are honest, fair and responsible for our actions.' },
    { title: 'Respect', text: 'We value every person and every voice.' },
    { title: 'Service', text: 'We use what we learn to help others.' },
  ],
  principal: {
    // PLACEHOLDER
    name: 'The Principal',
    message:
      'Welcome to Jessiikong High School. Our doors are always open — we would love to show you around and introduce you to the students and teachers who make this school special.',
  },
}

// ----------------------------------------------------------- Academics page
export const academics = {
  intro:
    'Our curriculum follows the Nigerian national curriculum from Junior Secondary (JSS) to Senior Secondary (SS), preparing students for BECE, WAEC and NECO examinations — and for life beyond them.', // PLACEHOLDER
  // Shown above the class list and the subject list (which come from the school's records).
  classesNote: 'Classes currently offered',
  subjectsNote: 'Subjects taught across the school',
  approach: [
    { title: 'Small classes', text: 'Teachers know every student and adapt to how they learn.' }, // PLACEHOLDER
    { title: 'Continuous assessment', text: 'Regular tests, assignments and projects — not just end-of-term exams.' },
    { title: 'Parents in the loop', text: 'Families follow attendance, results and messages through our online portal.' },
  ],
}

// ---------------------------------------------------------- Admissions page
export const admissions = {
  intro:
    'We welcome applications into JSS1 and, where places are available, other classes. The process is simple and our team is happy to help at every step.', // PLACEHOLDER
  steps: [
    // PLACEHOLDER
    { title: 'Send an inquiry', text: 'Fill in the form below. It takes two minutes.' },
    { title: 'Visit the school', text: 'We will call to arrange a tour and answer your questions.' },
    { title: 'Entrance assessment', text: 'A short assessment in English and Mathematics, plus a friendly interview.' },
    { title: 'Offer & enrolment', text: 'Successful candidates receive an offer letter and enrolment pack.' },
  ],
  requirements: [
    // PLACEHOLDER
    'Copy of birth certificate',
    'Last two school reports (for transfer students)',
    'Two recent passport photographs',
    'Transfer letter from the previous school (where applicable)',
  ],
  feesNote:
    'For current fees and payment plans, please send an inquiry or contact the admissions office.', // PLACEHOLDER
  formTitle: 'Admissions inquiry',
  formIntro: 'Tell us about your child and we will get back to you within two working days.', // PLACEHOLDER
  thankYou:
    'Thank you! Your inquiry has been received. Our admissions team will contact you within two working days.',
}

// ------------------------------------------------------------- Contact page
export const contactPage = {
  intro: 'We would love to hear from you. Call, email or send us a message and we will reply as soon as we can.',
  formTitle: 'Send us a message',
  thankYou: 'Thank you for your message. We will reply as soon as we can.',
}
