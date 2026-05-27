import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Entries" };

interface Props {
  params: Promise<{ org: string; studio: string }>;
}

type EntryStatus = "draft" | "submitted" | "approved" | "rejected" | "waitlisted";

const statusVariant: Record<EntryStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  submitted: "outline",
  approved: "default",
  rejected: "destructive",
  waitlisted: "secondary",
};

const entries = [
  { id: "e-1", routine: "Gravity", event: "Summer Showcase 2026", category: "Senior Contemporary Solo", status: "submitted" as EntryStatus, submittedAt: "2026-05-20" },
  { id: "e-2", routine: "Electric Dreams", event: "Summer Showcase 2026", category: "Teen Jazz Group", status: "approved" as EntryStatus, submittedAt: "2026-05-18" },
  { id: "e-3", routine: "Swan Lake Variation", event: "Summer Showcase 2026", category: "Senior Ballet Solo", status: "draft" as EntryStatus, submittedAt: null },
  { id: "e-4", routine: "Breaking Free", event: "Fall Championship 2026", category: "Junior Hip-Hop Duo", status: "draft" as EntryStatus, submittedAt: null },
  { id: "e-5", routine: "Firebird", event: "Fall Championship 2026", category: "Mini Lyrical Group", status: "rejected" as EntryStatus, submittedAt: "2026-05-15" },
];

export default async function EntriesPage({ params }: Props) {
  await params;

  const submitted = entries.filter((e) => e.status !== "draft").length;
  const drafts = entries.filter((e) => e.status === "draft").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Entries"
        description={`${submitted} submitted, ${drafts} drafts`}
      />

      <div className="flex gap-3">
        {(["all", "draft", "submitted", "approved", "rejected"] as const).map((filter) => (
          <button
            key={filter}
            type="button"
            className="rounded-none border border-white/10 bg-[#202020] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:border-[#FFC000]/30 hover:text-white"
          >
            {filter.charAt(0).toUpperCase() + filter.slice(1)}
          </button>
        ))}
      </div>

      <div className="rounded-none border border-white/10">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 bg-[#202020]">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Routine</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Event</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Category</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Submitted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {entries.map((entry) => (
              <tr key={entry.id} className="transition-colors hover:bg-white/5">
                <td className="px-4 py-3 text-sm font-medium text-white">{entry.routine}</td>
                <td className="px-4 py-3 text-sm text-white/60">{entry.event}</td>
                <td className="px-4 py-3 text-sm text-white/60">{entry.category}</td>
                <td className="px-4 py-3">
                  <Badge variant={statusVariant[entry.status]}>{entry.status}</Badge>
                </td>
                <td className="px-4 py-3 text-sm text-white/50">{entry.submittedAt ?? "--"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
