import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, MapPin, ArrowRight, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Event Details" };

interface Props {
  params: Promise<{ org: string; eventId: string }>;
}

const categories = [
  { id: "cat-1", name: "Mini Solo", ageRange: "6-8", entryFee: "$45", spotsLeft: 12 },
  { id: "cat-2", name: "Junior Solo", ageRange: "9-11", entryFee: "$50", spotsLeft: 8 },
  { id: "cat-3", name: "Teen Solo", ageRange: "12-14", entryFee: "$55", spotsLeft: 15 },
  { id: "cat-4", name: "Senior Solo", ageRange: "15-18", entryFee: "$60", spotsLeft: 20 },
  { id: "cat-5", name: "Junior Group", ageRange: "9-11", entryFee: "$35/dancer", spotsLeft: 6 },
  { id: "cat-6", name: "Teen Group", ageRange: "12-14", entryFee: "$35/dancer", spotsLeft: 10 },
  { id: "cat-7", name: "Senior Group", ageRange: "15-18", entryFee: "$35/dancer", spotsLeft: 14 },
  { id: "cat-8", name: "Open Duo/Trio", ageRange: "Any", entryFee: "$40/dancer", spotsLeft: 18 },
];

export default async function EmbedEventDetailPage({ params }: Props) {
  const { org, eventId } = await params;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Summer Showcase 2026</h1>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-white/50">
          <span className="flex items-center gap-1">
            <CalendarDays className="h-4 w-4" /> Jul 12-14, 2026
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="h-4 w-4" /> Grand Ballroom, Sydney
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-4 w-4" /> Registration closes Jun 15
          </span>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/50">
          Categories
        </h2>
        <div className="rounded-none border border-white/10">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-[#202020]">
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Category</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Ages</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Fee</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Spots</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {categories.map((cat) => (
                <tr key={cat.id} className="transition-colors hover:bg-white/5">
                  <td className="px-4 py-2 text-sm font-medium text-white">{cat.name}</td>
                  <td className="px-4 py-2 text-sm text-white/60">{cat.ageRange}</td>
                  <td className="px-4 py-2 text-sm text-white/60">{cat.entryFee}</td>
                  <td className="px-4 py-2">
                    <Badge variant={cat.spotsLeft > 10 ? "outline" : "destructive"}>
                      {cat.spotsLeft} left
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-center">
        <Link
          href={`/embed/${org}/register`}
          className="inline-flex items-center gap-2 rounded-none bg-[#FFC000] px-8 py-3 text-sm font-bold text-black transition-colors hover:bg-[#FFC000]/90"
        >
          Register Your Studio <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
