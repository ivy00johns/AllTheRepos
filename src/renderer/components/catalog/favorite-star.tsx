/**
 * Favourite toggle.
 *
 * Always present on a card rather than revealed on hover: a star that
 * only appears when you're already pointing at the thing is useless for
 * *scanning* a grid, and telling favourites apart at a glance is the
 * entire point of having them.
 *
 * Unstarred renders as a dim outline so it reads as an affordance
 * without competing with the repo's own content.
 */

import * as React from "react";
import { Star } from "lucide-react";

import { cn } from "@renderer/lib/cn";
import { useToggleFavorite } from "@renderer/hooks/use-actions";

interface FavoriteStarProps {
  slug: string;
  name: string;
  isFavorite: boolean;
  className?: string;
}

export function FavoriteStar({
  slug,
  name,
  isFavorite,
  className,
}: FavoriteStarProps) {
  const toggle = useToggleFavorite();

  return (
    <button
      type="button"
      aria-pressed={isFavorite}
      aria-label={isFavorite ? `Unpin ${name}` : `Pin ${name}`}
      title={isFavorite ? "Remove from favourites" : "Add to favourites"}
      onClick={(event) => {
        // The card around this selects on click, so a star click must not
        // also select or open the repo.
        event.stopPropagation();
        toggle.mutate({ slug, favorite: !isFavorite });
      }}
      className={cn(
        "shrink-0 cursor-pointer rounded p-0.5 transition-colors duration-150",
        isFavorite
          ? "text-warning hover:text-warning/80"
          : "text-muted-foreground/40 hover:text-muted-foreground",
        className,
      )}
    >
      <Star
        className="h-3.5 w-3.5"
        fill={isFavorite ? "currentColor" : "none"}
        aria-hidden
      />
    </button>
  );
}
