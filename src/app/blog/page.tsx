import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getArticles, getBlogIntro, ARTICLE_CATEGORIES } from "@/lib/articles";

export const metadata: Metadata = {
  title: "Blog",
};

type BlogPageProps = {
  searchParams: Promise<{ category?: string }>;
};

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const { category } = await searchParams;
  const [articles, intro] = await Promise.all([
    getArticles(category),
    getBlogIntro(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Blog
        </h1>
        <p className="mt-3 text-foreground/70">{intro}</p>
      </header>

      {/* Category filter — link-based, no client JS required */}
      <nav aria-label="Filter by category" className="mt-8 flex flex-wrap gap-2">
        <Link
          href="/blog"
          className={`rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
            !category
              ? "border-foreground bg-foreground text-background"
              : "border-black/20 hover:border-black/40 dark:border-white/20 dark:hover:border-white/40"
          }`}
        >
          All
        </Link>
        {ARTICLE_CATEGORIES.map((cat) => (
          <Link
            key={cat.slug}
            href={`/blog?category=${cat.slug}`}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
              category === cat.slug
                ? "border-foreground bg-foreground text-background"
                : "border-black/20 hover:border-black/40 dark:border-white/20 dark:hover:border-white/40"
            }`}
          >
            {cat.name}
          </Link>
        ))}
      </nav>

      {articles.length === 0 ? (
        <p className="mt-12 text-foreground/60">
          No articles in this category yet.
        </p>
      ) : (
        <ul className="mt-10 grid items-start gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((article) => (
            <li key={article.slug}>
              <Link
                href={`/blog/${article.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-lg border border-black/10 transition-colors hover:border-black/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/15 dark:hover:border-white/40"
              >
                {article.coverImage && (
                  <Image
                    src={article.coverImage.src}
                    alt={article.coverImage.alt}
                    width={article.coverImage.width}
                    height={article.coverImage.height}
                    unoptimized
                    className="h-auto w-full"
                  />
                )}
                <div className="flex flex-1 flex-col p-6">
                  <div className="flex flex-wrap gap-1.5">
                    {article.categories.map((cat) => (
                      <span
                        key={cat.slug}
                        className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium dark:bg-white/10"
                      >
                        {cat.name}
                      </span>
                    ))}
                  </div>
                  <h2 className="mt-3 text-lg font-medium leading-snug tracking-tight">
                    {article.title}
                  </h2>
                  <p className="mt-2 text-sm text-foreground/70">
                    {article.excerpt}
                  </p>
                  <time
                    dateTime={article.publishedAt}
                    className="mt-4 text-xs text-foreground/50"
                  >
                    {new Date(article.publishedAt).toLocaleDateString("en-GB", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </time>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
