import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Clock, FileText, Inbox, AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";

export const metadata: Metadata = { title: "Studio Dashboard" };

interface Props {
  params: Promise<{ org: string; studio: string }>;
}

export default async function StudioDashboardPage({ params }: Props) {
  const { org, studio } = await params;
  const base = `/s/${org}/${studio}`;

  const openEvents = [
    { id: "evt-1", name: "Summer Showcase 2026", deadline: "Jun 15, 2026", entries: 8 },
    { id: "evt-2", name: "Fall Championship 2026", deadline: "Sep 1, 2026", entries: 0 },
  ];

  const draftEntries = [
    { id: "ent-1", routine: "Gravity", category: "Senior Contemporary Solo", status: "draft" },
    { id: "ent-2", routine: "Electric Dreams", category: "Teen Jazz Group", status: "draft" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" description={`Welcome back to ${studio}.`} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open Events" value={openEvents.length} icon={<CalendarDays className="h-5 w-5" />} />
        <StatCard label="Draft Entries" value={draftEntries.length} icon={<Clock className="h-5 w-5" />} />
        <StatCard label="Outstanding Invoices" value="$1,240" icon={<FileText className="h-5 w-5" />} />
        <StatCard label="Unread Messages" value={3} icon={<Inbox className="h-5 w-5" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-white/50">Upcoming Deadlines</CardTitle>
            <Link href={`${base}/entries`} className="text-xs text-[#FFC000] hover:underline">View entries</Link>
          </CardHeader>
          <CardContent className="divide-y divide-white/10">
            {openEvents.map((evt) => (
              <div key={evt.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-white">{evt.name}</p>
                  <p className="text-xs text-white/50">Deadline: {evt.deadline}</p>
                </div>
                <Badge variant={evt.entries > 0 ? "default" : "outline"}>
                  {evt.entries > 0 ? `${evt.entries} entered` : "No entries"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-white/50">Draft Entries</CardTitle>
            <AlertTriangle className="h-4 w-4 text-[#FFC000]" />
          </CardHeader>
          <CardContent className="divide-y divide-white/10">
            {draftEntries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-white">{entry.routine}</p>
                  <p className="text-xs text-white/50">{entry.category}</p>
                </div>
                <Badge variant="secondary">Draft</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
