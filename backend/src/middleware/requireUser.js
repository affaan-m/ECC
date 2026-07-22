import { getAuth, clerkClient } from '@clerk/express';
import { prisma } from '../db.js';

// Loads (or lazily provisions) the app's User row for the authenticated
// Clerk session and attaches it as req.dbUser. Lazy provisioning covers the
// window before the user.created webhook has landed.
export async function requireUser(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    let user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) {
      const clerkUser = await clerkClient.users.getUser(userId);
      const email =
        clerkUser.emailAddresses?.find((e) => e.id === clerkUser.primaryEmailAddressId)
          ?.emailAddress ?? clerkUser.emailAddresses?.[0]?.emailAddress;
      if (!email) return res.status(400).json({ error: 'Clerk account has no email address' });
      user = await prisma.user.upsert({
        where: { clerkId: userId },
        update: {},
        create: { clerkId: userId, email },
      });
    }
    req.dbUser = user;
    next();
  } catch (err) {
    next(err);
  }
}
