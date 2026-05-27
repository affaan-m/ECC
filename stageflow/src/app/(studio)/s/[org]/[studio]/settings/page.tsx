import type { Metadata } from "next";
import { Shield, Users, Download, Building2 } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = { title: "Settings" };

interface Props {
  params: Promise<{ org: string; studio: string }>;
}

const members = [
  { id: "m-1", name: "Jane Smith", email: "jane@rhythmstudio.com", role: "owner" },
  { id: "m-2", name: "Tom Rogers", email: "tom@rhythmstudio.com", role: "admin" },
  { id: "m-3", name: "Lisa Park", email: "lisa@rhythmstudio.com", role: "teacher" },
];

export default async function SettingsPage({ params }: Props) {
  const { studio } = await params;

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Manage your studio settings and team." />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4 text-[#FFC000]" />
            Studio Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-white/50">Studio Name</label>
              <p className="mt-1 text-sm text-white">{studio}</p>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-white/50">Contact Email</label>
              <p className="mt-1 text-sm text-white">info@{studio}.com</p>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-white/50">Phone</label>
              <p className="mt-1 text-sm text-white">+44 7700 900123</p>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-white/50">Address</label>
              <p className="mt-1 text-sm text-white">123 Dance Lane, London, UK</p>
            </div>
          </div>
          <Button variant="outline">Edit Profile</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-[#FFC000]" />
            Team Members
          </CardTitle>
          <Button size="sm" className="bg-[#FFC000] text-black hover:bg-[#FFC000]/90">
            Invite Member
          </Button>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-white/10">
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-white">{member.name}</p>
                  <p className="text-xs text-white/50">{member.email}</p>
                </div>
                <Badge variant={member.role === "owner" ? "default" : "outline"}>
                  {member.role}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Shield className="h-4 w-4 text-[#FFC000]" />
            GDPR &amp; Data Privacy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-white/60">
            Export all data associated with this studio, including dancer records,
            entry history, and invoices. The export will be delivered as a ZIP file.
          </p>
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Request Data Export
          </Button>
          <Separator />
          <div>
            <h4 className="text-sm font-medium text-red-400">Danger Zone</h4>
            <p className="mt-1 text-xs text-white/50">
              Permanently delete this studio and all associated data. This action cannot be undone.
            </p>
            <Button variant="outline" className="mt-3 border-red-500/30 text-red-400 hover:bg-red-500/10">
              Delete Studio
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
