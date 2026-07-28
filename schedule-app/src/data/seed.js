import { uid, todayISO, toISODate, addDays, weekKey } from './helpers.js';

// Starter data so a first-time user sees a populated app instead of blank
// screens. Everything here is editable/deletable from the UI.
export function makeSeed() {
  const today = todayISO();
  const thisWeek = weekKey(today);

  const statuses = [
    { id: 'st_close', label: 'Close', color: '#2e9e6b' },
    { id: 'st_regular', label: 'Regular', color: '#1f5f8b' },
    { id: 'st_reconnect', label: 'Reconnect', color: '#e08a1e' },
    { id: 'st_new', label: 'New', color: '#8a5cd1' },
  ];

  const contacts = [
    {
      id: uid('c'),
      name: 'Maria Alvarez',
      phone: '555-0142',
      email: 'maria@example.com',
      address: '',
      statusId: 'st_close',
      tags: ['family'],
      lastContacted: toISODate(addDays(today, -2)),
      notes: 'Sister. Loves hiking — plan a trail day this month.',
      createdAt: today,
    },
    {
      id: uid('c'),
      name: 'James Okoro',
      phone: '555-0199',
      email: 'james.okoro@example.com',
      address: '',
      statusId: 'st_regular',
      tags: ['friend', 'gym'],
      lastContacted: toISODate(addDays(today, -9)),
      notes: 'Training partner. Check in about the 10k in the fall.',
      createdAt: today,
    },
    {
      id: uid('c'),
      name: 'Grandma Lee',
      phone: '555-0110',
      email: '',
      address: '',
      statusId: 'st_reconnect',
      tags: ['family'],
      lastContacted: toISODate(addDays(today, -34)),
      notes: 'Call on Sundays. Ask about the garden.',
      createdAt: today,
    },
    {
      id: uid('c'),
      name: 'Priya Raman',
      phone: '',
      email: 'priya@example.com',
      address: '',
      statusId: 'st_new',
      tags: ['work'],
      lastContacted: '',
      notes: 'Met at the design meetup. Follow up about the mentorship idea.',
      createdAt: today,
    },
  ];

  const goals = [
    {
      id: uid('g'),
      title: 'Drink water',
      category: 'Health',
      period: 'daily',
      target: 8,
      unit: 'glasses',
      progress: { [today]: 3 },
      reminder: { time: '09:00' },
      createdAt: today,
    },
    {
      id: uid('g'),
      title: 'Read',
      category: 'Growth',
      period: 'daily',
      target: 30,
      unit: 'minutes',
      progress: { [today]: 10 },
      reminder: null,
      createdAt: today,
    },
    {
      id: uid('g'),
      title: 'Workouts',
      category: 'Health',
      period: 'weekly',
      target: 4,
      unit: 'sessions',
      progress: { [thisWeek]: 2 },
      reminder: null,
      createdAt: today,
    },
    {
      id: uid('g'),
      title: 'Reach out to people',
      category: 'Relationships',
      period: 'weekly',
      target: 5,
      unit: 'people',
      progress: { [thisWeek]: 3 },
      reminder: null,
      createdAt: today,
    },
    {
      id: uid('g'),
      title: 'Deep work blocks',
      category: 'Work',
      period: 'weekly',
      target: 10,
      unit: 'blocks',
      progress: { [thisWeek]: 6 },
      reminder: null,
      createdAt: today,
    },
  ];

  const eventTypes = [
    { id: 'et_personal', label: 'Personal', color: '#1f5f8b' },
    { id: 'et_work', label: 'Work', color: '#8a5cd1' },
    { id: 'et_health', label: 'Health', color: '#2e9e6b' },
    { id: 'et_social', label: 'Social', color: '#e08a1e' },
  ];

  const baseEvent = {
    repeat: 'none',
    repeatUntil: '',
    done: false,
    doneDates: [],
    skipDates: [],
    typeId: '',
    color: '',
    reminder: 0,
  };
  const events = [
    {
      ...baseEvent,
      id: uid('e'),
      title: 'Morning run',
      date: today,
      start: '07:00',
      end: '07:45',
      contactId: contacts[1].id,
      location: 'Riverside trail',
      notes: '',
      repeat: 'daily',
      typeId: 'et_health',
      reminder: 15,
    },
    {
      ...baseEvent,
      id: uid('e'),
      title: 'Coffee with Maria',
      date: today,
      start: '10:30',
      end: '11:30',
      contactId: contacts[0].id,
      location: 'Bluebird Cafe',
      notes: 'Plan the hiking trip.',
      typeId: 'et_social',
      reminder: 30,
    },
    {
      ...baseEvent,
      id: uid('e'),
      title: 'Deep work',
      date: today,
      start: '14:00',
      end: '16:00',
      contactId: '',
      location: '',
      notes: 'Project proposal draft.',
      typeId: 'et_work',
    },
    {
      ...baseEvent,
      id: uid('e'),
      title: 'Call Grandma',
      date: toISODate(addDays(today, 1)),
      start: '18:00',
      end: '18:30',
      contactId: contacts[2].id,
      location: '',
      notes: '',
      repeat: 'weekly',
      typeId: 'et_personal',
    },
    // --- History ----------------------------------------------------------
    // A person's timeline is a record of what has already happened, and with
    // only today's and tomorrow's events seeded it opened empty for everyone
    // — the feature that most needs explaining had nothing to show. These
    // are dated backwards from today so the sample timeline reads like one
    // that's been kept for a couple of months.
    {
      ...baseEvent,
      id: uid('e'),
      title: 'Lunch with Maria',
      date: toISODate(addDays(today, -9)),
      start: '12:00',
      end: '13:00',
      contactId: contacts[0].id,
      location: 'Toca Madera',
      notes: 'She mentioned wanting to do the coastal trail in spring.',
      typeId: 'et_social',
    },
    {
      ...baseEvent,
      id: uid('e'),
      title: 'Helped Maria move',
      date: toISODate(addDays(today, -31)),
      start: '09:00',
      end: '15:00',
      contactId: contacts[0].id,
      location: '',
      notes: '',
      typeId: 'et_personal',
    },
    {
      ...baseEvent,
      id: uid('e'),
      title: '10k with James',
      date: toISODate(addDays(today, -16)),
      start: '07:30',
      end: '09:00',
      contactId: contacts[1].id,
      location: 'Riverside trail',
      notes: 'Beat his PB by two minutes.',
      typeId: 'et_health',
    },
    {
      ...baseEvent,
      id: uid('e'),
      title: "James's birthday dinner",
      date: toISODate(addDays(today, -44)),
      start: '19:00',
      end: '21:30',
      contactId: contacts[1].id,
      location: '',
      notes: '',
      typeId: 'et_social',
    },
    {
      ...baseEvent,
      id: uid('e'),
      title: 'Sunday visit',
      date: toISODate(addDays(today, -21)),
      start: '14:00',
      end: '16:00',
      contactId: contacts[2].id,
      location: '',
      notes: '',
      typeId: 'et_personal',
    },
  ];

  // Logged contact — the quick "we spoke" entries the timeline mixes in
  // between calendar events. Seeded for the same reason as the past events:
  // without them, "Log a contact" is a button whose output you've never seen.
  const interactions = [
    {
      id: uid('ix'),
      contactId: contacts[0].id,
      date: toISODate(addDays(today, -2)),
      text: 'Texted about the trail day — she is in for the 14th.',
    },
    {
      id: uid('ix'),
      contactId: contacts[0].id,
      date: toISODate(addDays(today, -19)),
      text: 'Quick call, caught up about work.',
    },
    {
      id: uid('ix'),
      contactId: contacts[1].id,
      date: toISODate(addDays(today, -9)),
      text: 'Ran into him at the gym.',
    },
    {
      id: uid('ix'),
      contactId: contacts[1].id,
      date: toISODate(addDays(today, -37)),
      text: 'Called about the fall 10k sign-up.',
    },
    {
      id: uid('ix'),
      contactId: contacts[2].id,
      date: toISODate(addDays(today, -6)),
      text: 'Sunday phone call.',
    },
    {
      id: uid('ix'),
      contactId: contacts[2].id,
      date: toISODate(addDays(today, -13)),
      text: 'Sunday phone call.',
    },
    {
      id: uid('ix'),
      contactId: contacts[2].id,
      date: toISODate(addDays(today, -20)),
      text: 'Sunday phone call.',
    },
  ];

  // Sample pins around downtown San Francisco so the map opens with something
  // to see. Edit or delete them and drop your own.
  const pins = [
    {
      id: uid('p'),
      emoji: '🏠',
      label: 'Home',
      notes: 'Front door code is on the fridge.',
      lat: 37.7749,
      lng: -122.4194,
      contactId: '',
      createdAt: today,
    },
    {
      id: uid('p'),
      emoji: '☕',
      label: 'Bluebird Cafe',
      notes: 'Where I meet Maria.',
      lat: 37.7799,
      lng: -122.4144,
      contactId: contacts[0].id,
      createdAt: today,
    },
    {
      id: uid('p'),
      emoji: '🏋️',
      label: 'Gym',
      notes: '',
      lat: 37.7699,
      lng: -122.4269,
      contactId: contacts[1].id,
      createdAt: today,
    },
  ];

  const tasks = [
    { id: uid('t'), title: 'Renew car registration', done: false, dueDate: toISODate(addDays(today, 3)), dueTime: '', reminderOffsets: [], createdAt: today },
    { id: uid('t'), title: 'Pick up dry cleaning', done: false, dueDate: today, dueTime: '17:00', reminderOffsets: [30], createdAt: today },
    { id: uid('t'), title: 'Email the landlord', done: true, dueDate: '', dueTime: '', reminderOffsets: [], createdAt: today },
  ];

  const notes = [
    {
      id: uid('n'),
      title: 'Grocery list',
      body: '',
      checklist: [
        { text: 'Eggs', done: false },
        { text: 'Coffee', done: false },
        { text: 'Spinach', done: true },
      ],
      color: '#e1f3ee',
      pinned: true,
      reminder: null,
      createdAt: today,
      updatedAt: today,
    },
    {
      id: uid('n'),
      title: 'Trip ideas',
      body: 'Look into the coastal trail Maria mentioned. Ask James about the gear he used last time.',
      checklist: null,
      color: '',
      pinned: false,
      reminder: null,
      createdAt: today,
      updatedAt: today,
    },
  ];

  return {
    version: 1,
    goals,
    events,
    contacts,
    pins,
    tasks,
    notes,
    interactions,
    templates: [],
    statuses,
    eventTypes,
    settings: { theme: 'system', reconnectDays: 30, notifications: false },
  };
}
