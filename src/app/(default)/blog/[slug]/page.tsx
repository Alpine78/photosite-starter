import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticle, getArticles } from "@/lib/articles";
import { formatDate } from "@/lib/date-format";
import {
  getDefaultLocaleLabels,
  getDeploymentConfig,
} from "@/lib/deployment-config";
import { getPageMetadata } from "@/lib/page-metadata";
import { ArticleBody } from "@/components/article-body";

type ArticlePageProps = {
  params: Promise<{ slug: string }>;
};

/** Pre-render the unprefixed compatibility article routes. */
export async function generateStaticParams() {
  const articles = await getArticles();
  return articles.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticle(slug);
  // An unknown slug renders the not-found page; it gets no canonical URL of
  // its own and keeps the site-level defaults.
  if (!article) return {};

  return getPageMetadata({
    path: `/blog/${article.slug}`,
    title: article.title,
    description: article.excerpt,
    image: article.coverMedia,
    publishedTime: article.publishedAt,
  });
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const { locale } = getDeploymentConfig();
  const labels = getDefaultLocaleLabels();
  const [article, allArticles] = await Promise.all([
    getArticle(slug),
    getArticles(),
  ]);
  if (!article) notFound();

  const index = allArticles.findIndex((a) => a.slug === slug);
  const prev = index > 0 ? allArticles[index - 1] : null;
  const next = index < allArticles.length - 1 ? allArticles[index + 1] : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      {/* Breadcrumb */}
      <nav
        aria-label={labels.navigation.breadcrumb}
        className="text-sm text-foreground/60"
      >
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link
              href="/blog"
              className="hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {labels.pages.blog}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="truncate text-foreground/80">{article.title}</li>
        </ol>
      </nav>

      {/* Header */}
      <header className="mt-6">
        <div className="flex flex-wrap gap-1.5">
          {article.categories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/blog?category=${cat.slug}`}
              className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-white/10 dark:hover:bg-white/20"
            >
              {cat.name}
            </Link>
          ))}
        </div>
        <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {article.title}
        </h1>
        <time
          dateTime={article.publishedAt}
          className="mt-2 block text-sm text-foreground/60"
        >
          {formatDate(article.publishedAt, locale)}
        </time>
      </header>

      {/* Body */}
      <div className="mt-10">
        <ArticleBody blocks={article.body} />
      </div>

      {/* Tags */}
      {article.tags && article.tags.length > 0 && (
        <footer className="mt-12 border-t border-black/10 pt-6 dark:border-white/15">
          <p className="text-xs font-medium uppercase tracking-wider text-foreground/50">
            {labels.blog.tags}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {article.tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-black/10 px-2.5 py-0.5 text-sm text-foreground/70 dark:border-white/15"
              >
                {tag}
              </span>
            ))}
          </div>
        </footer>
      )}

      {/* Prev / next navigation */}
      <nav
        aria-label={labels.navigation.article}
        className="mt-10 grid grid-cols-2 gap-4 border-t border-black/10 pt-8 dark:border-white/15"
      >
        <div>
          {prev && (
            <Link
              href={`/blog/${prev.slug}`}
              className="group flex flex-col gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <span className="text-xs font-medium uppercase tracking-wider text-foreground/50">
                <span aria-hidden="true">← </span>
                {labels.actions.previousArticle}
              </span>
              <span className="text-sm font-medium leading-snug group-hover:underline">
                {prev.title}
              </span>
            </Link>
          )}
        </div>
        <div className="text-right">
          {next && (
            <Link
              href={`/blog/${next.slug}`}
              className="group flex flex-col gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <span className="text-xs font-medium uppercase tracking-wider text-foreground/50">
                {labels.actions.nextArticle}
                <span aria-hidden="true"> →</span>
              </span>
              <span className="text-sm font-medium leading-snug group-hover:underline">
                {next.title}
              </span>
            </Link>
          )}
        </div>
      </nav>
    </main>
  );
}
