import { getRepoBySlug, listGroups, listRepos } from "@/lib/db/queries";
import { CatalogShell } from "@/components/catalog/catalog-shell";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const [{ items, total }, groups] = await Promise.all([
    listRepos({ limit: 200 }),
    listGroups(),
  ]);

  async function loadRepoDetail(slug: string) {
    "use server";
    return getRepoBySlug(slug);
  }

  return (
    <CatalogShell
      initialRepos={items}
      groups={groups}
      totalCount={total}
      loadRepoDetail={loadRepoDetail}
    />
  );
}
