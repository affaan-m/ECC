import type { Metadata } from "next";
import { Music, Upload, Users, Tag, StickyNote } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Routine Detail" };

interface Props {
  params: Promise<{ org: string; studio: string; id: string }>;
}

const routine = {
  id: "r-1",
  name: "Gravity",
  category: "Senior Contemporary Solo",
  notes: "Focus on fluidity and emotional expression. Performance cut at 2:45.",
  musicFile: "gravity-performance-mix.mp3",
  musicDuration: "2:47",
  musicUploaded: true,
  dancers: [
    { id: "d-1", name: "Sophie Chen", role: "Soloist" },
  ],
};

export default async function RoutineDetailPage({ params }: Props) {
  const { org, studio, id } = await params;

  return (
    <div className="space-y-6">
      <PageHeader
        title={routine.name}
        description={routine.category}
        actions={
          <div className="flex gap-2">
            <Button variant="outline">Edit Routine</Button>
            <Button className="bg-[#FFC000] text-black hover:bg-[#FFC000]/90">Submit Entry</Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-[#FFC000]" />
              Dancers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {routine.dancers.length > 0 ? (
              <ul className="space-y-3">
                {routine.dancers.map((dancer) => (
                  <li key={dancer.id} className="flex items-center justify-between">
                    <span className="text-sm text-white">{dancer.name}</span>
                    <Badge variant="outline">{dancer.role}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-white/50">No dancers assigned yet.</p>
            )}
            <Button variant="outline" className="mt-4 w-full gap-2">
              <Users className="h-4 w-4" />
              Assign Dancers
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Music className="h-4 w-4 text-[#FFC000]" />
              Music
            </CardTitle>
          </CardHeader>
          <CardContent>
            {routine.musicUploaded ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-none bg-black/50 p-3">
                  <div>
                    <p className="text-sm font-medium text-white">{routine.musicFile}</p>
                    <p className="text-xs text-white/50">Duration: {routine.musicDuration}</p>
                  </div>
                  <Badge>Uploaded</Badge>
                </div>
              </div>
            ) : (
              <Button variant="outline" className="w-full gap-2">
                <Upload className="h-4 w-4" />
                Upload Music File
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Tag className="h-4 w-4 text-[#FFC000]" />
              Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-white">{routine.category}</p>
            <p className="mt-1 text-xs text-white/50">Routine ID: {id}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <StickyNote className="h-4 w-4 text-[#FFC000]" />
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-white/80">{routine.notes}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
