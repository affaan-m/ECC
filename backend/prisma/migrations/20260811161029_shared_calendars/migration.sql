-- CreateTable
CREATE TABLE "SharedCalendar" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#0f8f72',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedCalendarMember" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedCalendarMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedCalendarInvite" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "invitedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "SharedCalendarInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedEvent" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedCalendarMember_calendarId_userId_key" ON "SharedCalendarMember"("calendarId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SharedCalendarInvite_token_key" ON "SharedCalendarInvite"("token");

-- AddForeignKey
ALTER TABLE "SharedCalendar" ADD CONSTRAINT "SharedCalendar_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedCalendarMember" ADD CONSTRAINT "SharedCalendarMember_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "SharedCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedCalendarMember" ADD CONSTRAINT "SharedCalendarMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedCalendarInvite" ADD CONSTRAINT "SharedCalendarInvite_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "SharedCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedEvent" ADD CONSTRAINT "SharedEvent_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "SharedCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
