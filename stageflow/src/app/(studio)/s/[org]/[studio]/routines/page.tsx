import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Music, CheckCircle2, AlertCircle } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Routines" };

interface Props {
  params: Promise<{ org: string; studio: string }>;
}

const routines = [
  { id: "r-1", name: "Gravity", category: "Senior Contemporary Solo", musicUploaded: true, status: "ready", dancers: 1 },
  { id: "r-2", name: "Electric Dreams", category: "Teen Jazz Group", musicUploaded: true, status: "ready", dancers: 6 },
  { id: "r-3", name: "Swan Lake Variation", category: "Senior Ballet Solo", musicUploaded: false, status: "needs-music", dancers: 1 },
  { id: "r-4", name: "Breaking Free", category: "Junior Hip-Hop Duo", musicUploaded: true, status: "draft", dancers: 2 },
  { id: "r-5", name: "Firebird", category: "Mini Lyrical Group", musicUploaded: false, status: "needs-music", dancers: 4 },
];

export default async function RoutinesPage({ params }: Props) {
  const { org, studio } = await params;
  const base = `/s/${org}/${studio}/routines`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Routines"
        description="Manage routines, assign dancers, and upload music."
        actions={
          <Button className="gap-2 bg-[#FFC000] text-black hover:bg-[#FFC000]/90">
            <Plus className="h-4 w-4" />
            New Routine
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {routines.map((routine) => (
          <Link key={routine.id} href={`${base}/${routine.id}`}>
            <Card className="transition-colors hover:border-[#FFC000]/30">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-white">{routine.name}</h3>
                    <p className="text-xs text-white/50">{routine.category}</p>
                  </div>
                  <Badge
                    variant={routine.status === "ready" ? "default" : routine.status === "draft" ? "secondary" : "destructive"}
                  >
                    {routine.status === "ready" ? "Ready" : routine.status === "draft" ? "Draft" : "Needs Music"}
                  </Badge>
                </div>
                <div className="mt-4 flex items-center gap-4 text-xs text-white/50">
                  <span className="flex items-center gap-1">
                    {routine.musicUploaded ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <AlertCircle className="h-3 w-3 text-red-400" />
                    )}
                    <Music className="h-3 w-3" />
                    {routine.musicUploaded ? "Uploaded" : "Missing"}
                  </span>
                  <span>{routine.dancers} dancer{routine.dancers !== 1 ? "s" : ""}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
