-- Pro becomes a one-time lifetime purchase.
--
-- Additive only. The subscription columns are deliberately left in place so
-- anyone who subscribed before the switch keeps their access and can still
-- cancel through the billing portal; nothing new writes to them.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lifetimePurchasedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "lifetimeSessionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_lifetimeSessionId_key" ON "User"("lifetimeSessionId");
