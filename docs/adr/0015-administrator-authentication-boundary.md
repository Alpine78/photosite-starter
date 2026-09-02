# ADR-0015: Administrator authentication boundary for private client galleries

**Status:** Accepted
**Date:** 2026-09-02
**Accepted:** 2026-09-02
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#29 (decision) / AB#145 (implementation)

## Context

[ADR-0014](0014-private-gallery-security-delivery-retention-boundary.md) §4 fixed that
administration of private client galleries — create, prepare, publish, revoke, replace,
delete, resend, reopen — sits behind its own authentication boundary, **distinct from and
stronger than** a customer capability, sharing no credential and no session with the
customer path. It fixed that the boundary is route-aware and enforced *in the
application*, and it ruled out Vercel Deployment Protection as the mechanism, on checked
evidence: that control is scoped to a project's deployment URLs rather than a path
prefix, so on the shared public production deployment it would gate the whole site or
nothing.

It deliberately left the **administrator identity mechanism** open, as "an implementation
decision for AB#29 with its own review". This record is that review. It is ADR-0014's
action item 3.

Nothing administrative is built yet. AB#29 has built the customer half — the capability
exchange, the session and cookie contract, per-asset authorization, the signed-URL
presigner, the retention rules, object keys, upload preparation and completion. The
administration surface itself was split out of AB#29 into **AB#145** on 2026-09-02. That
split postdates ADR-0014's action item, which still names AB#29. The project owner
resolved that on acceptance: this record is AB#29's, and **the implementation is
AB#145's**. The boundary is administration infrastructure, AB#29's delivery half has no
use for it, and AB#145 cannot start without it.

### What the deployment actually is

- **One operator.** `AGENTS.md`: "A real production project, not a demo. Not a SaaS, not
  multi-tenant." There is one photographer, no user table, no sign-up, no roles, and
  nobody to enumerate.
- **The operator controls the deployment configuration.** They hold the hosting account
  and set environment variables. This is unusual and it matters below: it means a
  credential held in configuration *is* the recovery path, and no password-reset flow —
  with its own mailbox, tokens, and attack surface — has to exist.
- **Minimal dependencies.** `AGENTS.md`: "Do not add a library without a clear, stated
  need."
- **Privacy by default**, with no third-party scripts and a goal of running without a
  cookie banner.
- **The stakes are the customer's photographs.** An attacker with administrator access
  can read every gallery, publish, revoke, and irreversibly delete. This is the highest-
  impact boundary in the repository.

### A finding that shapes the decision

ADR-0014 §4 requires the administrator boundary to be **stronger** than a customer
capability. A customer capability is a 256-bit CSPRNG secret. **A human-chosen passphrase
is not stronger than that** — it is several orders of magnitude weaker, and adopting one
would invert the relationship the ADR states while appearing to satisfy it.

Any mechanism chosen here therefore has to clear that bar explicitly rather than by
assumption. That single observation rules out the most obvious implementation (a
memorable password) and is why the decision below constrains *how* the credential is
produced, not only what checks it.

## Decision

**A generated single-operator secret, verified server-side, exchanged for an
administrator session — with the boundary designed so the identity mechanism can be
replaced without touching anything else.**

Four parts. The first three are the boundary and are independent of the credential; only
the fourth is the identity mechanism, and it is the part a later ADR may supersede on its
own.

### 1. Its own route namespace, reserved and hygienic

Administrator routes live under their own reserved root segment, configured like the
private prefix (`PRIVATE_GALLERY_ROUTE_PREFIX`), validated as one lowercase segment, and
reserved against locale prefixes, story namespaces, and public assets whether the feature
is on or off. They carry the same response hygiene the private namespace already does —
`Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`,
`Referrer-Policy: no-referrer` — and `robots.txt` disallows them.

They are **not** nested under the customer prefix. The customer cookie is scoped by
`Path` to `/<prefix>/<handle>`, so nesting would not leak it, but "isolated from the
customer path" is easier to verify when the two namespaces do not overlap at all.

### 2. An administrator session that shares nothing with the customer one

The same *shape* as the customer session, deliberately reusing a reviewed design, and
none of its state:

- a 256-bit CSPRNG identifier, with only its SHA-256 hash stored;
- the **`__Host-` prefix**, which the customer cookie could not use because it needs a
  per-gallery `Path`. `__Host-` additionally forbids `Domain` and requires `Path=/`,
  making it strictly stronger here;
- `SameSite=Strict`, not `Lax` — an administrator route is never arrived at by following
  a link from elsewhere;
- a **short** lifetime, well below the customer session's seven days, with an absolute
  expiry and no sliding renewal;
- stored in the private metadata store, so it survives across instances and can be
  revoked centrally;
- re-authentication required for irreversible operations — delete, and revoke — because a
  session left open on an unlocked laptop should not be able to destroy a customer's
  gallery.

Every administrator route and **every administrator mutation** re-derives authorization
from that session on every request, exactly as §5 Stage 1 does for customers. There is no
"the admin page loaded, so the mutation is authorized" gap.

### 3. Request-boundary controls reused, not reinvented

The administrator login and every mutation reuse the boundary the contact and enquiry
endpoints already establish and this repository has reviewed twice: `POST` only,
`application/json` only, same-origin checked before anything stateful, a bounded body, a
closed field whitelist, and `no-store` responses with no CORS headers.

Login additionally gets a **persisted** rate limit rather than the in-process
best-effort one, for the same reason ADR-0014 §3 gives the exchange: an in-process
counter bounds nothing across instances, and login is the one endpoint where a
persistent counter is the actual defence rather than a supplement.

Failed login answers **one indistinguishable refusal**, and operational events carry a
correlation id, a state, and a redacted class — never the submitted secret, and never a
timing- or wording-distinguishable hint. There is no account to enumerate, but there is
still a rate-limit state and a credential to probe.

### 4. The identity mechanism: a generated secret in server-only configuration

`PRIVATE_GALLERY_ADMIN_SECRET_HASH` holds a **scrypt** hash — `node:crypto`, already on
the pinned Node 24, no dependency — of a secret the operator **generates** rather than
chooses, with its salt and parameters encoded alongside it. Verification is
constant-time.

The secret is generated at provisioning by the same kind of command the capability
keyring already uses (`openssl rand -base64 32`), stored in the operator's password
manager, and never typed from memory. That is what makes the boundary stronger than a
256-bit customer capability rather than weaker, and it is a **requirement of this
decision, not advice**: the provisioning runbook generates it, and the setting's
documentation states that a memorable passphrase is not an acceptable value.

Measured on the pinned Node major: `scryptSync` at `N = 2^15, r = 8, p = 1` costs ~74 ms
on the development machine, which is a sensible per-login cost for a single operator and
is irrelevant to request throughput because there is no login volume to speak of.

Rotation and recovery are the same operation: change the environment variable and
redeploy. **No password-reset flow exists, and that is a feature.** A reset flow would
need a mailbox, a token, an expiry, and a second delivery path — a whole attack surface
serving one person who already controls the deployment configuration.

## Options Considered

### A. Generated single-operator secret in server-only configuration *(chosen)*

No dependency, no third-party processor, no new account in the ownership boundary, no
recovery flow. The credential's strength is a provisioning decision rather than a human
habit. Its weakness is that it is a bearer secret: whoever holds it is the administrator,
and it is phishable if the operator can be induced to paste it somewhere.

### B. Generated secret plus a TOTP second factor

Adds protection against a leaked or captured secret. Does **not** add phishing resistance
— a real-time relay defeats TOTP — so it buys less than it appears to against the threat
that actually worries us. Costs: an enrolment flow, a second secret to store and back up,
clock-skew handling, recovery codes (which are themselves bearer secrets), and an
RFC 6238 implementation that would need its own published test vectors to be verified
rather than assumed. Deferred, not rejected: the boundary above is designed so this is an
addition to part 4 alone.

### C. WebAuthn / passkey

The only genuinely phishing-resistant option, browser-native, and pleasant for a single
operator on their own devices. Rejected **for now** on two grounds. Verifying an assertion
correctly involves CBOR, COSE key parsing, signature counters, and origin binding — this
is not something to hand-roll, so it means a dependency, against the repository's minimal-
dependency rule and with a real review cost. And it needs a recovery path for a lost
device, which for one operator converges on… a secret in configuration, i.e. option A
underneath. The strongest candidate to supersede this record once administration exists
and the dependency can be judged against real usage.

### D. External IdP with a session (OAuth/OIDC)

Adds a third-party processor to a project whose stated posture is privacy by default and
whose ADR-0004 ownership boundary cares about which accounts a clone must hold. Adds a
dependency and a redirect flow. Delegates the credential strength question to a provider
rather than answering it. For one operator on one deployment, the cost is real and the
benefit is mostly organisational — user management this deployment does not have.

### E. Platform-level protection (Vercel Deployment Protection)

Ruled out by ADR-0014 §4 on checked evidence, and not reopened here.

### F. Client certificates (mTLS)

Strong and phishing-resistant, but provider-dependent, awkward to enrol and rotate on the
operator's devices, and not offered as a path-scoped control by the reference host. Out.

## Trade-off Analysis

| | A (chosen) | B (+TOTP) | C (passkey) | D (IdP) |
| --- | --- | --- | --- | --- |
| Dependencies added | none | none | one, non-trivial | one, plus a provider |
| Third-party processor | none | none | none | yes |
| Phishing resistance | no | no | **yes** | depends on provider |
| Resists a leaked credential | no | yes | yes | yes |
| Recovery story | config change | config change + backup codes | needs one | provider's |
| Review cost | low | medium | high | medium |
| Strength vs a 256-bit capability | equal, **if generated** | stronger | stronger | provider's |

The decisive considerations are that the identity mechanism is the *replaceable* part of
this design, and that the boundary's other three parts carry most of the security value
regardless of which credential sits behind them. Choosing the option with the lowest
review cost first, while keeping the boundary mechanism-agnostic, gets administration
built without either shipping something weak or spending the story's remaining budget on
WebAuthn.

## Consequences

- AB#145 can start: the boundary is specified and the mechanism is decided.
- A new reserved root segment and one new Sensitive setting join the deployment contract,
  documented in `.env.example` and `docs/deployment.md` alongside the private-gallery
  settings.
- The administrator secret becomes a **provisioning artefact** with the same handling as
  the capability keyring: generated, stored in a password manager, never in the
  repository, never in a pull-request job.
- **Accepted residual: the administrator credential is a bearer secret.** Anyone holding
  it is the administrator, and no second factor stands behind it today. Compensating
  controls are the generated entropy, the persisted login rate limit, the short
  `__Host-` session with re-authentication for irreversible operations, and the fact that
  a single operator will notice unexpected changes to their own galleries. Option C is
  the documented upgrade path.
- **Accepted residual: no audit trail beyond operational events.** Administrator
  mutations are logged with a correlation id, an operation, and a state. Recording *what
  changed* is a later decision and would need its own retention rule, since an audit log
  about a customer's gallery is itself data about that customer.
- This record does **not** establish the administrator UI, its accessibility contract, or
  the notification pipeline. Those are AB#145's, under the repository's existing WCAG 2.1
  AA requirement.

## Action Items

1. [x] The project owner **accepted this record on 2026-09-02**, without amendment: the
   generated single-operator secret now, with option C (passkey) as the recorded upgrade
   path. ADR-0014 §4's action item 3 is closed by that acceptance. The same decision
   assigned the **implementation to AB#145**, which owns administration; ADR-0014's
   action item named AB#29 only because it predates that split. Items 2&ndash;5 below are
   therefore AB#145's, and item 6 belongs to whoever revisits the mechanism.
2. [ ] **(AB#145)** Implement the boundary: the reserved admin segment with its response hygiene, the
   `__Host-` session over the private metadata store, the persisted login rate limit, and
   re-authentication for irreversible operations.
3. [ ] **(AB#145)** `.env.example` and `docs/deployment.md`: the admin route prefix and
   `PRIVATE_GALLERY_ADMIN_SECRET_HASH`, with the generation command and the explicit rule
   that a memorable passphrase is not an acceptable value.
4. [x] **(AB#145)** `docs/private-gallery-data-flow.md`: replace the "the administrator-authentication
   boundary is not designed" open item with what this record decided, and add the
   administrator session to the cookie section. **Done** — the open item was
   rewritten when this record was accepted, and the session joined the cookie
   section with §2's slice on 2026-09-02, marked as a contract no route sets yet.
5. [x] **(AB#145)** `docs/architecture/application-boundaries.d2`: draw the administrator boundary as
   its own node, `planned` until it is built, and regenerate the SVG. **Done**
   2026-09-02 with §1's namespace slice; the node states what is built (the reserved
   prefix and its response hygiene) and what is not (§2&ndash;§4).
6. [ ] Revisit option C once administration exists and the dependency can be judged
   against real usage, rather than in the abstract.

## What this ADR does not establish

- It does not decide the administrator UI, its routes beyond the namespace, or its
  accessibility contract.
- It does not decide an audit trail of administrative changes.
- It does not weaken or reopen ADR-0014 §4: the boundary's existence, its route-awareness,
  its enforcement in the application, and its isolation from the customer path are that
  record's, and this one only fills in the mechanism it left open.
