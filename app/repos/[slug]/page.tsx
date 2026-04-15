import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getRepoBySlug } from "@/lib/db/queries";
import { RepoDetailContent } from "@/components/catalog/repo-detail-content";
import { Button } from "@/components/ui/button";

interface RepoPageProps {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";

export default async function RepoPage({ params }: RepoPageProps) {
  const { slug } = await params;
  const repo = await getRepoBySlug(slug);
  if (!repo) notFound();

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-4xl flex-col gap-4 px-6 py-8">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/?repo=${repo.slug}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to catalog
          </Link>
        </Button>
      </div>
      <RepoDetailContent repo={repo} variant="page" />
    </main>
  );
}
