import type { Metadata } from "next";
import { Download, CreditCard, FileText } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Invoices" };

interface Props {
  params: Promise<{ org: string; studio: string }>;
}

type InvoiceStatus = "paid" | "unpaid" | "overdue" | "refunded";

const statusVariant: Record<InvoiceStatus, "default" | "secondary" | "destructive" | "outline"> = {
  paid: "default",
  unpaid: "outline",
  overdue: "destructive",
  refunded: "secondary",
};

const invoices = [
  { id: "inv-001", event: "Summer Showcase 2026", amount: "$620.00", status: "unpaid" as InvoiceStatus, issuedAt: "2026-05-10", dueDate: "2026-06-10" },
  { id: "inv-002", event: "Spring Fling 2026", amount: "$340.00", status: "paid" as InvoiceStatus, issuedAt: "2026-03-01", dueDate: "2026-04-01" },
  { id: "inv-003", event: "Winter Gala 2025", amount: "$280.00", status: "paid" as InvoiceStatus, issuedAt: "2025-11-15", dueDate: "2025-12-15" },
  { id: "inv-004", event: "Summer Showcase 2025", amount: "$510.00", status: "refunded" as InvoiceStatus, issuedAt: "2025-05-12", dueDate: "2025-06-12" },
];

export default async function InvoicesPage({ params }: Props) {
  await params;

  const outstanding = invoices.filter((i) => i.status === "unpaid" || i.status === "overdue");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description={`${outstanding.length} outstanding invoice${outstanding.length !== 1 ? "s" : ""}`}
      />

      <div className="rounded-none border border-white/10">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 bg-[#202020]">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Invoice</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Event</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Due</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/50">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {invoices.map((inv) => (
              <tr key={inv.id} className="transition-colors hover:bg-white/5">
                <td className="px-4 py-3 text-sm font-medium text-white">{inv.id}</td>
                <td className="px-4 py-3 text-sm text-white/60">{inv.event}</td>
                <td className="px-4 py-3 text-sm font-medium text-white">{inv.amount}</td>
                <td className="px-4 py-3">
                  <Badge variant={statusVariant[inv.status]}>{inv.status}</Badge>
                </td>
                <td className="px-4 py-3 text-sm text-white/50">{inv.dueDate}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {(inv.status === "unpaid" || inv.status === "overdue") && (
                      <Button size="sm" className="gap-1 bg-[#FFC000] text-black hover:bg-[#FFC000]/90">
                        <CreditCard className="h-3 w-3" />
                        Pay
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="gap-1">
                      <Download className="h-3 w-3" />
                      PDF
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
