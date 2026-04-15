import Link from "next/link";

// Stub — frontend agent will replace with full catalog UI
export default function Home() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="font-mono text-3xl font-semibold tracking-tight">
        AllTheRepos
      </h1>
      <p className="mt-2 text-muted-foreground">
        Scaffold ready. Frontend agent will populate this page.
      </p>
      <Link
        href="/settings"
        className="mt-6 inline-flex items-center rounded-md border border-border bg-primary px-4 py-2 text-sm font-medium hover:bg-secondary"
      >
        Settings
      </Link>
    </main>
  );
}
