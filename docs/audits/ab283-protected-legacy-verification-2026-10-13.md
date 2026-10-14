# AB#283 — complete legacy checks on a protected candidate

AB#283 moved New → Active before changes under AB#19. The existing anonymous
mapping check remains unchanged. Its requests cannot pass Vercel Authentication;
this separate command prepares the complete check on an owned protected candidate.
No redirect decision, application route, alias, DNS or CMS content is changed.

`npm run verify:legacy-candidate` accepts an owner-captured private provider response,
immutable URL/deployment/source/project/team expectations, intended canonical origin
and a new private output directory. It first checks that the mapping, tracking,
inventory and redirect engine bytes match the explicitly expected Git commit.
Provider hostname/owner/project/deployment identity and affirmative clean READY source
must pass before the bypass secret is resolved. The saved response is operator-captured
metadata, not a signed provider attestation; capture it freshly with authenticated tooling.

Unauthenticated challenge and bypassed noindex are independently checked. The mapping
scan then reuses the existing complete source/status/declared-target/canonical/fallback
checks with bounded HTML and fixed redacted failures. The bypass wrapper permits only
GETs to the exact HTTPS deployment origin, rejects other origins or credentials, strips
caller cookies/authorization, and insists on manual redirects. Response Locations are
validated but never followed; only the mapping's declared same-origin targets are read.
Shared target attempts, including failures, retain the existing memoization behavior.

Complete per-source results stay in exclusive ignored mode-0700 output, mode-0600
receipt files. Console output is limited to expected identities and counts; raw provider
responses, bypasses, HTML and response headers are not printed. The receipt binds the
provider response SHA-256 and complete mapping digest. Identity and source failures
make zero deployment requests and never resolve the bypass. Fixture tests cover wrong
owners/hosts/IDs/source, dirty/unknown cleanliness, credential replacement, redirect and
cross-origin refusal, protection/noindex refusal and unapproved pending decisions.

A protected Preview pass establishes that candidate's observed mapping behavior.
It does not verify the final Production alias/DNS/canonical surface, artifact bytes,
contact delivery, CMS publication, actual rollback or owner launch acceptance. Run again
on the exact integrated source after #392's Blog alias is merged; the CLI refuses using
that future mapping against an older source. AB#283 remains Active pending review/merge;
AB#19 remains Active until its actual final deployed check and acceptance.

Validation: ESLint, all 6,079 offline tests (33 focused candidate/probe/target cases)
and a production build with the real CMS read configuration pass. The first hosted
415-row execution independently passed ownership/source/protection and all source
statuses/target availability, but refused all 232 redirect canonicals against an
incorrect operator expectation. The Preview intentionally uses `https://preview.invalid`;
the refused receipt is preserved rather than relabelled successful. A separately
bound rerun against the documented Preview configuration is recorded under AB#284.
Final Production canonicals must still match the actual owner-approved launch origin.
