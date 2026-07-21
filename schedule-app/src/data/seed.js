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
      title: 'Workouts',
      category: 'Health',
      target: 4,
      unit: 'sessions',
      weeklyProgress: { [thisWeek]: 2 },
      createdAt: today,
    },
    {
      id: uid('g'),
      title: 'Reach out to people',
      category: 'Relationships',
      target: 5,
      unit: 'people',
      weeklyProgress: { [thisWeek]: 3 },
      createdAt: today,
    },
    {
      id: uid('g'),
      title: 'Reading',
      category: 'Growth',
      target: 3,
      unit: 'hours',
      weeklyProgress: { [thisWeek]: 1 },
      createdAt: today,
    },
    {
      id: uid('g'),
      title: 'Deep work blocks',
      category: 'Work',
      target: 10,
      unit: 'blocks',
      weeklyProgress: { [thisWeek]: 6 },
      createdAt: today,
    },
  ];

  const events = [
    {
      id: uid('e'),
      title: 'Morning run',
      date: today,
      start: '07:00',
      end: '07:45',
      contactId: contacts[1].id,
      location: 'Riverside trail',
      notes: '',
      done: false,
    },
    {
      id: uid('e'),
      title: 'Coffee with Maria',
      date: today,
      start: '10:30',
      end: '11:30',
      contactId: contacts[0].id,
      location: 'Bluebird Cafe',
      notes: 'Plan the hiking trip.',
      done: false,
    },
    {
      id: uid('e'),
      title: 'Deep work',
      date: today,
      start: '14:00',
      end: '16:00',
      contactId: '',
      location: '',
      notes: 'Project proposal draft.',
      done: false,
    },
    {
      id: uid('e'),
      title: 'Call Grandma',
      date: toISODate(addDays(today, 1)),
      start: '18:00',
      end: '18:30',
      contactId: contacts[2].id,
      location: '',
      notes: '',
      done: false,
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

  return {
    version: 1,
    goals,
    events,
    contacts,
    pins,
    statuses,
    settings: { theme: 'system' },
  };
}
