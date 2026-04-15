import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSettings } from "@/lib/db/queries";
import { SettingsForm } from "@/components/settings-form";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure scan locations, embeddings, and your default editor.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Link>
        </Button>
      </div>
      <SettingsForm initialSettings={settings} />
    </main>
  );
}
