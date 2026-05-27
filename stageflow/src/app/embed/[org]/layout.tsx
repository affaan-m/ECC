import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "StageFlow", template: "%s | StageFlow" },
};

interface EmbedLayoutProps {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}

export default async function EmbedLayout({ children, params }: EmbedLayoutProps) {
  const { org } = await params;

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center bg-[#FFC000]">
            <span className="text-xs font-black text-black">SF</span>
          </div>
          <span className="text-sm font-bold text-white">
            {org}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
      <footer className="border-t border-white/10 px-6 py-4 text-center text-xs text-white/30">
        Powered by Stage<span className="text-[#FFC000]">Flow</span>
      </footer>
    </div>
  );
}
