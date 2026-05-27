import type { Metadata } from "next";
import { Plus, Upload } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Dancers" };

interface Props {
  params: Promise<{ org: string; studio: string }>;
}

const dancers = [
  { id: "d-1", name: "Sophie Chen", dob: "2010-03-14", level: "Senior", routines: 3, documentsComplete: true },
  { id: "d-2", name: "Mia Johnson", dob: "2012-07-22", level: "Junior", routines: 2, documentsComplete: true },
  { id: "d-3", name: "Ava Patel", dob: "2014-11-05", level: "Mini", routines: 1, documentsComplete: false },
  { id: "d-4", name: "Lily Nguyen", dob: "2009-01-30", level: "Senior", routines: 4, documentsComplete: true },
  { id: "d-5", name: "Zoe Martinez", dob: "2013-09-18", level: "Junior", routines: 2, documentsComplete: false },
];

export default async function DancersPage({ params }: Props) {
  await params;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dancers"
        description="Manage your studio's dancers and their documents."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2">
              <Upload className="h-4 w-4" />
              CSV Import
            </Button>
            <Button className="gap-2 bg-[#FFC000] text-black hover:bg-[#FFC000]/90">
              <Plus className="h-4 w-4" />
              Add Dancer
            </Button>
          </div>
        }
      />

      <div className="rounded-none border border-white/10">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 bg-[#202020]">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Date of Birth</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Level</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Routines</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Docs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {dancers.map((dancer) => (
              <tr key={dancer.id} className="transition-colors hover:bg-white/5">
                <td className="px-4 py-3 text-sm font-medium text-white">{dancer.name}</td>
                <td className="px-4 py-3 text-sm text-white/60">{dancer.dob}</td>
                <td className="px-4 py-3"><Badge variant="outline">{dancer.level}</Badge></td>
                <td className="px-4 py-3 text-sm text-white/60">{dancer.routines}</td>
                <td className="px-4 py-3">
                  <Badge variant={dancer.documentsComplete ? "default" : "destructive"}>
                    {dancer.documentsComplete ? "Complete" : "Incomplete"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-white/40">{dancers.length} dancers total</p>
    </div>
  );
}
