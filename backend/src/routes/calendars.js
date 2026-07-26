import { Router } from 'express';
import { requireUser } from '../middleware/requireUser.js';
import { prisma } from '../db.js';

const router = Router();

const INVITE_TTL_DAYS = 7;
const EDIT_ROLES = new Set(['owner', 'editor']);

async function getMembership(calendarId, userId) {
  return prisma.sharedCalendarMember.findUnique({
    where: { calendarId_userId: { calendarId, userId } },
  });
}

// Attaches req.membership for :id routes — every calendar/event route below
// needs "is this person even allowed to see this calendar" first, so it's
// centralized here instead of repeated in each handler.
async function requireMember(req, res, next) {
  const { id } = req.params;
  try {
    const calendar = await prisma.sharedCalendar.findUnique({ where: { id } });
    if (!calendar) return res.status(404).json({ error: 'Calendar not found' });
    const membership = await getMembership(id, req.dbUser.id);
    if (!membership) return res.status(403).json({ error: 'Not a member of this calendar' });
    req.calendar = calendar;
    req.membership = membership;
    next();
  } catch (err) {
    next(err);
  }
}

function requireEditRole(req, res, next) {
  if (!EDIT_ROLES.has(req.membership.role)) {
    return res.status(403).json({ error: 'Viewers cannot make changes' });
  }
  next();
}

function requireOwner(req, res, next) {
  if (req.membership.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
  next();
}

// List every calendar the signed-in user belongs to (owned or shared with them).
router.get('/', requireUser, async (req, res, next) => {
  try {
    const memberships = await prisma.sharedCalendarMember.findMany({
      where: { userId: req.dbUser.id },
      include: {
        calendar: {
          include: { _count: { select: { members: true, events: true } } },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
    res.json({
      calendars: memberships.map((m) => ({
        id: m.calendar.id,
        name: m.calendar.name,
        color: m.calendar.color,
        role: m.role,
        memberCount: m.calendar._count.members,
        eventCount: m.calendar._count.events,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireUser, async (req, res, next) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const color = typeof req.body?.color === 'string' ? req.body.color : undefined;
  try {
    const calendar = await prisma.sharedCalendar.create({
      data: {
        name,
        ...(color ? { color } : {}),
        ownerId: req.dbUser.id,
        members: { create: { userId: req.dbUser.id, role: 'owner' } },
      },
    });
    res.status(201).json({ calendar });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireUser, requireMember, async (req, res, next) => {
  try {
    const [members, events] = await Promise.all([
      prisma.sharedCalendarMember.findMany({
        where: { calendarId: req.calendar.id },
        include: { user: { select: { id: true, email: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
      prisma.sharedEvent.findMany({
        where: { calendarId: req.calendar.id },
        orderBy: { date: 'asc' },
      }),
    ]);
    res.json({
      calendar: req.calendar,
      role: req.membership.role,
      members: members.map((m) => ({ id: m.id, role: m.role, email: m.user.email, joinedAt: m.joinedAt })),
      events,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireUser, requireMember, requireOwner, async (req, res, next) => {
  const data = {};
  if (typeof req.body?.name === 'string' && req.body.name.trim()) data.name = req.body.name.trim();
  if (typeof req.body?.color === 'string') data.color = req.body.color;
  try {
    const calendar = await prisma.sharedCalendar.update({ where: { id: req.calendar.id }, data });
    res.json({ calendar });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireUser, requireMember, requireOwner, async (req, res, next) => {
  try {
    await prisma.sharedCalendar.delete({ where: { id: req.calendar.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- Members -----------------------------------------------------------

// A member can remove themselves (leave); only the owner can remove someone
// else. The owner can't be removed — delete the calendar instead.
router.delete('/:id/members/:memberId', requireUser, requireMember, async (req, res, next) => {
  try {
    const target = await prisma.sharedCalendarMember.findUnique({ where: { id: req.params.memberId } });
    if (!target || target.calendarId !== req.calendar.id) {
      return res.status(404).json({ error: 'Member not found' });
    }
    if (target.role === 'owner') return res.status(400).json({ error: "Can't remove the owner" });
    const isSelf = target.userId === req.dbUser.id;
    if (!isSelf && req.membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only the owner can remove other members' });
    }
    await prisma.sharedCalendarMember.delete({ where: { id: target.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- Invites -------------------------------------------------------------
// Sending the actual email is out of scope here — this just creates the
// invite row and returns a token the frontend can turn into a shareable
// link (e.g. mailto: or a copy-to-clipboard "invite link").

router.get('/:id/invites', requireUser, requireMember, requireOwner, async (req, res, next) => {
  try {
    const invites = await prisma.sharedCalendarInvite.findMany({
      where: { calendarId: req.calendar.id, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ invites });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/invites', requireUser, requireMember, requireEditRole, async (req, res, next) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email is required' });
  const role = req.body?.role === 'viewer' ? 'viewer' : 'editor';
  try {
    const invite = await prisma.sharedCalendarInvite.create({
      data: {
        calendarId: req.calendar.id,
        email,
        role,
        invitedBy: req.dbUser.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    res.status(201).json({ invite });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/invites/:inviteId', requireUser, requireMember, requireOwner, async (req, res, next) => {
  try {
    const invite = await prisma.sharedCalendarInvite.findUnique({ where: { id: req.params.inviteId } });
    if (!invite || invite.calendarId !== req.calendar.id) return res.status(404).json({ error: 'Invite not found' });
    await prisma.sharedCalendarInvite.delete({ where: { id: invite.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Accepting doesn't require calendar membership (that's the whole point),
// so this is mounted outside requireMember, keyed by the invite token.
router.post('/invites/:token/accept', requireUser, async (req, res, next) => {
  try {
    const invite = await prisma.sharedCalendarInvite.findUnique({ where: { token: req.params.token } });
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    if (invite.acceptedAt) return res.status(400).json({ error: 'Invite already used' });
    if (invite.expiresAt < new Date()) return res.status(400).json({ error: 'Invite expired' });

    const [, membership] = await prisma.$transaction([
      prisma.sharedCalendarInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
      prisma.sharedCalendarMember.upsert({
        where: { calendarId_userId: { calendarId: invite.calendarId, userId: req.dbUser.id } },
        update: {},
        create: { calendarId: invite.calendarId, userId: req.dbUser.id, role: invite.role },
      }),
    ]);
    res.json({ calendarId: invite.calendarId, role: membership.role });
  } catch (err) {
    next(err);
  }
});

// --- Events --------------------------------------------------------------
// Deliberately simple (no recurrence) — see the schema comment for why.

router.post('/:id/events', requireUser, requireMember, requireEditRole, async (req, res, next) => {
  const { title, date, start, end } = req.body || {};
  if (!title?.trim() || !date || !start || !end) {
    return res.status(400).json({ error: 'title, date, start, and end are required' });
  }
  try {
    const event = await prisma.sharedEvent.create({
      data: {
        calendarId: req.calendar.id,
        title: title.trim(),
        date,
        start,
        end,
        notes: typeof req.body.notes === 'string' ? req.body.notes : '',
        createdBy: req.dbUser.id,
      },
    });
    res.status(201).json({ event });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/events/:eventId', requireUser, requireMember, requireEditRole, async (req, res, next) => {
  const data = {};
  for (const field of ['title', 'date', 'start', 'end', 'notes']) {
    if (typeof req.body?.[field] === 'string') data[field] = req.body[field];
  }
  try {
    const existing = await prisma.sharedEvent.findUnique({ where: { id: req.params.eventId } });
    if (!existing || existing.calendarId !== req.calendar.id) return res.status(404).json({ error: 'Event not found' });
    const event = await prisma.sharedEvent.update({ where: { id: existing.id }, data });
    res.json({ event });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/events/:eventId', requireUser, requireMember, requireEditRole, async (req, res, next) => {
  try {
    const existing = await prisma.sharedEvent.findUnique({ where: { id: req.params.eventId } });
    if (!existing || existing.calendarId !== req.calendar.id) return res.status(404).json({ error: 'Event not found' });
    await prisma.sharedEvent.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
