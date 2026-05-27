import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, MapPin, ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Events" };

interface Props {
  params: Promise<{ org: string }>;
}

const events = [
  {
    id: "evt-1",
    name: "Summer Showcase 2026",
    date: "Jul 12-14, 2026",
    location: "Grand Ballroom, Sydney",
    registrationOpen: true,
    categories: 24,
  },
  {
    id: "evt-2",
    name: "Fall Championship 2026",
    date: "Oct 4-6, 2026",
    location: "Convention Centre, Melbourne",
    registrationOpen: false,
    categories: 32,
  },
  {
    id: "evt-3",
    name: "Holiday Spectacular 2026",
    date: "Dec 13-15, 2026",
    location: "Civic Theatre, Auckland",
    registrationOpen: false,
    categories: 18,
  },
];

export default async function EmbedLandingPage({ params }: Props) {
  const { org } = await params;

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">Welcome to {org}</h1>
        <p className="mt-2 text-sm text-white/60">
          Browse upcoming events and register your studio.
        </p>
      </div>

      <div className="space-y-4">
        {events.map((event) => (
          <div
            key={event.id}
            className="rounded-none border border-white/10 bg-[#202020] p-5 transition-colors hover:border-[#FFC000]/30"
          >
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-white">{event.name}</h2>
                <div className="flex flex-wrap items-center gap-4 text-xs text-white/50">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {event.date}
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {event.location}
                  </span>
                </div>
                <p className="text-xs text-white/40">{event.categories} categories</p>
              </div>
              <Badge variant={event.registrationOpen ? "default" : "secondary"}>
                {event.registrationOpen ? "Open" : "Coming Soon"}
              </Badge>
            </div>
            {event.registrationOpen && (
              <div className="mt-4 flex gap-3">
                <Link
                  href={`/embed/${org}/events/${event.id}`}
                  className="text-xs font-medium text-[#FFC000] hover:underline"
                >
                  View Details
                </Link>
                <Link
                  href={`/embed/${org}/register`}
                  className="inline-flex items-center gap-1 rounded-none bg-[#FFC000] px-4 py-1.5 text-xs font-bold text-black transition-colors hover:bg-[#FFC000]/90"
                >
                  Register <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
