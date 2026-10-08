/**
 * The markdown pipeline itself.
 *
 * Kept in its own module so `components/markdown.tsx` can `import()` it
 * on demand: everything reachable from here — react-markdown, remark-gfm,
 * rehype-raw, rehype-sanitize and the sanitize schema — travels with that
 * dynamic import instead of the bundle the shell parses before its first
 * paint.
 *
 * Sanitizing is not optional: READMEs are arbitrary content from
 * repositories on this machine, and `rehype-raw` has just re-parsed their
 * inline HTML, so the allowlist is what stands between a README and the
 * renderer.
 */

import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { README_SANITIZE_SCHEMA } from "@renderer/lib/markdown";

export default function MarkdownRenderer({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, README_SANITIZE_SCHEMA]]}
    >
      {children}
    </ReactMarkdown>
  );
}
