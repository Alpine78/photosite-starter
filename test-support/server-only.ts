/**
 * Stand-in for the `server-only` marker package under Vitest.
 *
 * `server-only` resolves to an empty module inside a React Server Component
 * build and to a module that throws everywhere else — that throw is the whole
 * mechanism, and it is what turns a Client Component importing a server module
 * into a build error.
 *
 * Vitest runs plain Node, so the marker would make every module carrying it
 * unimportable and no server module could be unit-tested at all. Aliasing it
 * here restores the server build's behavior. Nothing is weakened: the marker
 * guards a Next.js bundling boundary, and a Node test never crosses one.
 */
export {};
