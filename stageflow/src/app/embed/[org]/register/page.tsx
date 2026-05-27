import type { Metadata } from "next";
import { UserPlus, Users, Send } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Register" };

interface Props {
  params: Promise<{ org: string }>;
}

export default async function EmbedRegisterPage({ params }: Props) {
  const { org } = await params;

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">Register with {org}</h1>
        <p className="mt-2 text-sm text-white/60">
          Create your studio account, add dancers, and submit entries.
        </p>
      </div>

      <div className="space-y-6">
        {/* Step 1: Studio Signup */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <div className="flex h-6 w-6 items-center justify-center bg-[#FFC000] text-xs font-bold text-black">1</div>
              <UserPlus className="h-4 w-4 text-[#FFC000]" />
              Studio Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-white/50">Studio Name</label>
                <input
                  type="text"
                  placeholder="e.g. Rhythm Dance Academy"
                  className="mt-1 w-full rounded-none border border-white/10 bg-black px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#FFC000] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-white/50">Email</label>
                <input
                  type="email"
                  placeholder="studio@example.com"
                  className="mt-1 w-full rounded-none border border-white/10 bg-black px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#FFC000] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-white/50">Contact Name</label>
                <input
                  type="text"
                  placeholder="Jane Smith"
                  className="mt-1 w-full rounded-none border border-white/10 bg-black px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#FFC000] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-white/50">Phone</label>
                <input
                  type="tel"
                  placeholder="+61 400 000 000"
                  className="mt-1 w-full rounded-none border border-white/10 bg-black px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#FFC000] focus:outline-none"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Step 2: Add Dancers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <div className="flex h-6 w-6 items-center justify-center bg-[#FFC000] text-xs font-bold text-black">2</div>
              <Users className="h-4 w-4 text-[#FFC000]" />
              Add Dancers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <input type="text" placeholder="Dancer name" className="rounded-none border border-white/10 bg-black px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#FFC000] focus:outline-none" />
                <input type="date" className="rounded-none border border-white/10 bg-black px-3 py-2 text-sm text-white focus:border-[#FFC000] focus:outline-none" />
                <input type="text" placeholder="Level (e.g. Senior)" className="rounded-none border border-white/10 bg-black px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#FFC000] focus:outline-none" />
              </div>
              <button type="button" className="text-xs font-medium text-[#FFC000] hover:underline">
                + Add another dancer
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Step 3: Submit */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <div className="flex h-6 w-6 items-center justify-center bg-[#FFC000] text-xs font-bold text-black">3</div>
              <Send className="h-4 w-4 text-[#FFC000]" />
              Submit Registration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-white/60">
              By registering you agree to the organiser&apos;s terms and conditions
              and StageFlow&apos;s privacy policy.
            </p>
            <button
              type="submit"
              className="w-full rounded-none bg-[#FFC000] px-6 py-3 text-sm font-bold text-black transition-colors hover:bg-[#FFC000]/90"
            >
              Complete Registration
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
