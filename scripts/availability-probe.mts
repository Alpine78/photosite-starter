/** AB#206: configuration and semantic HTML decisions; no network calls. */
import { isIP } from "node:net";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
export type AvailabilityCheck = { url: string; heading: string; link?: { text: string; href: string }; canonicalUrl?: string };
const invalid = () => { throw new Error("invalid-probe-config"); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) invalid();
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) return invalid();
  return value.replace(/\s+/g, " ").trim();
}
export function publicProbeUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || /[\u0000-\u0020\u007f\\]/.test(value)) return invalid();
  let url: URL;
  try { url = new URL(value); } catch { return invalid(); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || /[?#]/.test(url.href) || (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
      (!loopback && (isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0 || !url.hostname.includes(".") || /\.(?:localhost|local|internal|home|invalid)$/.test(url.hostname)))) return invalid();
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return invalid(); }
  if (/[\u0000-\u0020\u007f\\%]/.test(path) || path.split("/").some((part) => /^(?:private|api|admin|studio)(?:-|$)/i.test(part))) return invalid();
  return url.href;
}
export function parseAvailabilityConfig(value: unknown) {
  const config = object(value); keys(config, ["checks", "timeoutMs", "maxBytes"]);
  if (!Array.isArray(config.checks) || config.checks.length < 1 || config.checks.length > 2 || !Number.isInteger(config.timeoutMs) || (config.timeoutMs as number) < 1 || (config.timeoutMs as number) > 60_000 || !Number.isInteger(config.maxBytes) || (config.maxBytes as number) < 1 || (config.maxBytes as number) > 2 * 1024 * 1024) return invalid();
  const checks: AvailabilityCheck[] = config.checks.map((raw: unknown) => {
    const check = object(raw); keys(check, ["url", "heading"], ["link", "canonicalUrl"]);
    const result: AvailabilityCheck = { url: publicProbeUrl(check.url), heading: text(check.heading) };
    if (Object.hasOwn(check, "canonicalUrl")) result.canonicalUrl = publicProbeUrl(check.canonicalUrl);
    if (Object.hasOwn(check, "link")) {
      const link = object(check.link); keys(link, ["text", "href"]);
      if (typeof link.href !== "string" || !link.href.startsWith("/") || link.href.startsWith("//") || /[?#\\\s]/.test(link.href)) return invalid();
      publicProbeUrl(new URL(link.href, result.url).href);
      result.link = { text: text(link.text), href: link.href };
    }
    return result;
  });
  if (new Set(checks.map((check) => check.url)).size !== checks.length) return invalid();
  return { checks, timeoutMs: config.timeoutMs as number, maxBytes: config.maxBytes as number };
}
type Node = DefaultTreeAdapterTypes.Node;
function hidden(node: DefaultTreeAdapterTypes.Element) {
  return ["script", "style", "template", "noscript"].includes(node.tagName) || node.attrs.some((attr) => attr.name === "hidden" || (attr.name === "aria-hidden" && attr.value.toLowerCase() === "true") || (attr.name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(attr.value)));
}
function visibleText(root: Node): string {
  const stack = [root], parts: string[] = []; let visited = 0;
  while (stack.length) {
    const node = stack.pop()!; if (++visited > 100_000) return "";
    if ("tagName" in node && hidden(node)) continue;
    if ("value" in node && node.nodeName === "#text") parts.push(node.value);
    if ("childNodes" in node) for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}
export function htmlHasMarkers(html: string, check: AvailabilityCheck): boolean {
  const stack: Node[] = [parse(html)]; let heading = false, link = !check.link, visited = 0;
  while (stack.length) {
    const node = stack.pop()!; if (++visited > 100_000) return false;
    if ("tagName" in node) {
      if (hidden(node)) continue;
      if (node.namespaceURI === "http://www.w3.org/1999/xhtml") {
        if (node.tagName === "h1" && visibleText(node) === check.heading) heading = true;
        if (check.link && node.tagName === "a" && node.attrs.some((attr) => attr.name === "href" && attr.value === check.link!.href) && visibleText(node) === check.link.text) link = true;
      }
    }
    if ("childNodes" in node) for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
  }
  return heading && link;
}
