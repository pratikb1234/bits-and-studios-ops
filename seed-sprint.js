// Bits & Studios — Documentation Week Sprint (May 24–30, 2026)
// 19 documents · 7 team members · 6 review meetings · daily standup

const SPRINT = {
  name:      'Bits and Studios — Documentation Week',
  window:    'May 24 to May 30, 2026',
  goal:      '19 documents created, reviewed, and locked across 7 owners',
  milestone: 'Saturday May 30, 5pm — Sprint Review',
  policy:    'Owner creates → shares 24h before → creator speaks first → team responds → Anjalee + Pratik close',
};

const TEAM = [
  { id: 'user_pratik',   name: 'Pratik Bhatt',  role: 'admin',    color: '#534AB7', avatar: 'PB', department: 'management', title: 'Founder' },
  { id: 'user_anjalee',  name: 'Anjalee Bhatt', role: 'admin',    color: '#1D9E75', avatar: 'AB', department: 'management', title: 'Co-founder' },
  { id: 'user_sohil',    name: 'Sohil',         role: 'employee', color: '#D85A30', avatar: 'SO', department: 'operations', title: 'Operations' },
  { id: 'user_mohit',    name: 'Mohit',         role: 'employee', color: '#378ADD', avatar: 'MO', department: 'curriculum', title: 'Senior Educator' },
  { id: 'user_aryan',    name: 'Aryan',         role: 'employee', color: '#D4537E', avatar: 'AR', department: 'brand',      title: 'Tech + Brand' },
  { id: 'user_mantasha', name: 'Mantasha',      role: 'employee', color: '#BA7517', avatar: 'MA', department: 'community',  title: 'Community Manager' },
  { id: 'user_foram',    name: 'Foram',         role: 'employee', color: '#639922', avatar: 'FO', department: 'operations', title: 'Organization' },
];

// Due dates at end-of-day IST
const D = (day) => new Date(`2026-05-${String(day).padStart(2,'0')}T23:59:00+05:30`).getTime();

const DOCS = [
  // ── BRAND (6 docs) ────────────────────────────────────────────────────────
  {
    label: 'Brand Identity Document', dept: 'brand', area: 'Brand',
    owner: 'user_pratik', support: 'Aryan', dueDate: D(28), priority: 'p0', icon: '📘',
    summary: '5-7 page master document. Manifesto, mission, vision, positioning, archetype, color palette (lock final hexes), typography, visual aesthetic principles, brand enemy, voice principles.',
  },
  {
    label: 'Brand Voice + Anti-Voice Guide', dept: 'brand', area: 'Brand',
    owner: 'user_pratik', support: 'Aryan', dueDate: D(28), priority: 'p0', icon: '🗣️',
    summary: '10 on-brand examples, 10 off-brand examples, words we use, words we never use, tone by context, the Byju\'s test.',
  },
  {
    label: 'Tagline + Manifesto Lock', dept: 'brand', area: 'Brand',
    owner: 'user_pratik', support: 'Team', dueDate: D(27), priority: 'p0', icon: '✍️',
    summary: 'Final 5-line manifesto. "Build What You Imagine" tagline locked.',
  },
  {
    label: 'Signage + Wall Art Plan', dept: 'brand', area: 'Brand',
    owner: 'user_aryan', support: 'Mantasha', dueDate: D(28), priority: 'p0', icon: '🖼️',
    summary: 'Entry signage (brushed steel logo on navy), internal wayfinding, wall quotes (locations + content), production vendor (3 quotes), installation timeline, budget.',
  },
  {
    label: 'Mountain of Making Wall Spec', dept: 'brand', area: 'Brand',
    owner: 'user_aryan', support: 'Pratik', dueDate: D(28), priority: 'p0', icon: '🏔️',
    summary: 'Feature wall — wall dimensions, stylized peak graphic, 4 levels labelled (Spark Forge Circuit Summit), photo mounting, lighting plan, vendor + quote. Ready by June 14.',
  },
  {
    label: 'Logo Final Files', dept: 'brand', area: 'Brand',
    owner: 'user_aryan', support: 'Pratik', dueDate: D(29), priority: 'p0', icon: '🎨',
    summary: 'Primary, stacked, icon-only, monochrome variants. PNG + SVG + AI/PDF.',
  },

  // ── OPERATIONS (7 docs) ───────────────────────────────────────────────────
  {
    label: 'Furniture Procurement Plan', dept: 'operations', area: 'Operations',
    owner: 'user_sohil', support: 'Mantasha', dueDate: D(26), priority: 'p0', icon: '🪑',
    summary: 'Full list across zones, 3 vendor quotes per major item, recommendations with justification, timeline, total budget, Phase 1 (office) vs Phase 2 (full space) split.',
  },
  {
    label: 'Lighting + Electrical Plan', dept: 'operations', area: 'Operations',
    owner: 'user_sohil', support: 'Pratik supervises', dueDate: D(26), priority: 'p0', icon: '💡',
    summary: 'Electrical points per zone, lighting type per zone, Edison bulb spec, UPS, 3 vendor quotes, installation timeline. Pratik approves vendor commitments.',
  },
  {
    label: 'AC + HVAC Plan', dept: 'operations', area: 'Operations',
    owner: 'user_sohil', support: 'Pratik supervises', dueDate: D(26), priority: 'p0', icon: '❄️',
    summary: 'Phase 1: 1 AC for 24×24 office by June 1. Phase 2: 8-9 units by June 14. Vendor quotes, installation timeline, maintenance plan.',
  },
  {
    label: 'Space Cleaning Plan', dept: 'operations', area: 'Operations',
    owner: 'user_sohil', support: 'Foram', dueDate: D(27), priority: 'p1', icon: '🧹',
    summary: 'Deep clean schedule before fit-out, daily cleaning protocol once operational, vendor (3 quotes), materials needed.',
  },
  {
    label: 'Washroom Enhancement Plan', dept: 'operations', area: 'Operations',
    owner: 'user_sohil', support: 'Pratik supervises', dueDate: D(27), priority: 'p1', icon: '🚿',
    summary: 'Current state assessment, upgrades for premium parent experience, fixtures, tiles, child-friendly considerations, vendor quotes, budget.',
  },
  {
    label: 'Daily Operations Manual', dept: 'operations', area: 'Operations',
    owner: 'user_mantasha', support: 'Foram', dueDate: D(29), priority: 'p1', icon: '📋',
    summary: 'Morning open routine, class transitions, parent welcome script, end-of-day close routine, emergency protocols, daily checklist.',
  },
  {
    label: 'Cleaning + Reset Protocol', dept: 'operations', area: 'Operations',
    owner: 'user_foram', support: 'Sohil', dueDate: D(29), priority: 'p1', icon: '♻️',
    summary: 'Daily cleaning checklist (open, transition, close), weekly deep clean, tool reset after each session, vendor specs, materials inventory.',
  },

  // ── PRODUCT (2 docs) ──────────────────────────────────────────────────────
  {
    label: 'Curriculum Outlines — 4 Tracks', dept: 'curriculum', area: 'Product',
    owner: 'user_mohit', support: '—', dueDate: D(30), priority: 'p0', icon: '📚',
    summary: 'One doc per track (Spark G1-3, Forge G4-6, Circuit G6-8, Summit G7+). Quarter-by-quarter learning arc, sample projects, materials, learning outcomes.',
  },
  {
    label: 'Lesson Plans — First 4 Weeks', dept: 'curriculum', area: 'Product',
    owner: 'user_mohit', support: 'Mantasha + Foram', dueDate: D(30), priority: 'p0', icon: '📝',
    summary: 'For each track. Week 1-4 lessons. 2-hour session breakdown. Materials, learning objectives, build outcomes.',
  },

  // ── MARKETING (4 docs) ────────────────────────────────────────────────────
  {
    label: 'Master Contact Database', dept: 'marketing', area: 'Marketing',
    owner: 'user_anjalee', support: 'Pratik', dueDate: D(27), priority: 'p0', icon: '📊',
    summary: 'Google Sheet of 600+ AIS family contacts. Columns: Name, School, Phone, WhatsApp, Email, Children ages, Tag (A/B/C), Last contact date, Notes, Owner, Next action.',
  },
  {
    label: 'A/B/C Tagging Logic', dept: 'marketing', area: 'Marketing',
    owner: 'user_anjalee', support: 'Pratik', dueDate: D(27), priority: 'p0', icon: '🏷️',
    summary: '1-pager. A-list (50 close), B-list (150 know well), C-list (400 met once). Update process, weekly review.',
  },
  {
    label: 'Super-Connector Map', dept: 'marketing', area: 'Marketing',
    owner: 'user_anjalee', support: 'Pratik', dueDate: D(28), priority: 'p0', icon: '🗺️',
    summary: '2-page doc mapping 15 most influential IB mothers. Name, school, kids ages, WhatsApp groups, what they value, best approach for each, Pratik\'s plan to engage personally.',
  },
  {
    label: 'Testimonial Collection', dept: 'marketing', area: 'Marketing',
    owner: 'user_pratik', support: 'Anjalee + Mohit', dueDate: D(30), priority: 'p0', icon: '⭐',
    summary: '15+ testimonials collected by May 30. 5 Ivy League/international university alumni, 5 robotics champion students, 5 current AIS parents. Mix of video, audio, written.',
  },
];

const MEETINGS = [
  {
    label: '📅 Review: Ops Plans — Sohil presents', dept: 'operations', icon: '📅',
    dueDate: D(26), duration: '90 min',
    assignees: ['user_sohil', 'user_pratik', 'user_anjalee'],
    description: 'Sohil presents: Furniture Procurement + Lighting + Electrical + AC/HVAC. Mon May 26, 6 PM.',
  },
  {
    label: '📅 Review: Database + Cleaning — Anjalee + Sohil', dept: 'marketing', icon: '📅',
    dueDate: D(27), duration: '60 min',
    assignees: ['user_anjalee', 'user_sohil', 'user_pratik'],
    description: 'Anjalee: Contact Database + A/B/C Tagging. Sohil: Space Cleaning + Washroom. Tue May 27, 6 PM.',
  },
  {
    label: '📅 Review: Brand + Super-Connector — Pratik + Aryan + Anjalee', dept: 'brand', icon: '📅',
    dueDate: D(28), duration: '90 min',
    assignees: ['user_pratik', 'user_aryan', 'user_anjalee'],
    description: 'Pratik: Brand Identity + Voice. Aryan: Signage + Mountain of Making. Anjalee: Super-Connector Map. Wed May 28, 6 PM.',
  },
  {
    label: '📅 Review: Logo + Ops Manual + Protocol — Aryan + Mantasha + Foram', dept: 'operations', icon: '📅',
    dueDate: D(29), duration: '60 min',
    assignees: ['user_aryan', 'user_mantasha', 'user_foram', 'user_pratik'],
    description: 'Aryan: Logo Finals. Mantasha: Daily Ops Manual. Foram: Cleaning Protocol. Thu May 29, 6 PM.',
  },
  {
    label: '📅 Review: Curriculum + Lessons — Mohit presents', dept: 'curriculum', icon: '📅',
    dueDate: D(30), duration: '90 min',
    assignees: ['user_mohit', 'user_pratik', 'user_anjalee'],
    description: 'Mohit: Curriculum Outlines + First 4 Weeks Lesson Plans. Fri May 30, 6 PM.',
  },
  {
    label: '🏁 Sprint Review — All 7 Owners', dept: 'management', icon: '🏁',
    dueDate: D(30), duration: '120 min',
    assignees: ['user_pratik', 'user_anjalee', 'user_sohil', 'user_mohit', 'user_aryan', 'user_mantasha', 'user_foram'],
    description: 'Sprint Review: all 7 owners present. 17 success criteria checked. Decisions logged. Sat May 30, 5 PM.',
  },
];

const STANDUP = {
  label:       '☀️ 9 AM Daily Standup',
  dept:        'management',
  icon:        '☀️',
  description: 'Mon–Sat 9 AM · 15 min · Status only, no discussion · Order: Sohil → Mohit → Aryan → Mantasha → Foram → Anjalee → Pratik',
  priority:    'p1',
  assignees:   ['user_sohil', 'user_mohit', 'user_aryan', 'user_mantasha', 'user_foram', 'user_anjalee', 'user_pratik'],
  dueDate:     D(30),
};

module.exports = { SPRINT, TEAM, DOCS, MEETINGS, STANDUP };
