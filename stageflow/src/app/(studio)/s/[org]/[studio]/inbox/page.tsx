import type { Metadata } from "next";
import { Send } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Inbox" };

interface Props {
  params: Promise<{ org: string; studio: string }>;
}

const threads = [
  {
    id: "t-1",
    subject: "Summer Showcase 2026 - Entry Confirmation",
    from: "Stellar Dance Competitions",
    preview: "Your entries for Summer Showcase 2026 have been confirmed. Please review the attached schedule...",
    date: "May 25, 2026",
    read: false,
  },
  {
    id: "t-2",
    subject: "Invoice #inv-001 Issued",
    from: "Stellar Dance Competitions",
    preview: "A new invoice has been issued for your Summer Showcase 2026 entries. Total: $620.00. Due by...",
    date: "May 10, 2026",
    read: false,
  },
  {
    id: "t-3",
    subject: "Music File Requirements Update",
    from: "Stellar Dance Competitions",
    preview: "Please note that all music files must now be submitted in MP3 format with a maximum duration of...",
    date: "May 5, 2026",
    read: true,
  },
  {
    id: "t-4",
    subject: "Welcome to StageFlow!",
    from: "StageFlow Platform",
    preview: "Thank you for joining StageFlow. Here are some tips to get started with managing your studio...",
    date: "Apr 28, 2026",
    read: true,
  },
];

export default async function InboxPage({ params }: Props) {
  await params;

  const unread = threads.filter((t) => !t.read).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbox"
        description={`${unread} unread message${unread !== 1 ? "s" : ""}`}
        actions={
          <Button className="gap-2 bg-[#FFC000] text-black hover:bg-[#FFC000]/90">
            <Send className="h-4 w-4" />
            New Message
          </Button>
        }
      />

      <div className="space-y-2">
        {threads.map((thread) => (
          <Card
            key={thread.id}
            className={thread.read ? "opacity-70" : "border-[#FFC000]/20"}
          >
            <CardContent className="flex items-start gap-4 p-4">
              <div className="mt-1 flex h-2 w-2 shrink-0">
                {!thread.read && <span className="h-2 w-2 rounded-full bg-[#FFC000]" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-4">
                  <h3 className={`truncate text-sm ${thread.read ? "text-white/70" : "font-semibold text-white"}`}>
                    {thread.subject}
                  </h3>
                  <span className="shrink-0 text-xs text-white/40">{thread.date}</span>
                </div>
                <p className="text-xs text-[#FFC000]">{thread.from}</p>
                <p className="mt-1 truncate text-sm text-white/50">{thread.preview}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
