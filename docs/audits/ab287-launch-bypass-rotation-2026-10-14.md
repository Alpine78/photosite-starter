# AB#287 — launch automation bypass rotation

The owner approved the AB#285 private operation on 2026-10-14, including retirement
of all four exposed entries and the three without confirmed consumers. AB#287 is
the execution task under AB#117; it remains Active pending this evidence PR.

One replacement was generated. Only the existing Azure variable group 1 secret,
the native Preview webhook's protection-bypass header and the ignored local
operational copy were updated. The replacement became the project's default
bypass. Both webhook signing configurations, the Production webhook, unrelated
group properties and the other project protection settings were preserved by native
readback. This operation retained the existing shared consumer arrangement.

[CI run 977](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=977)
was queued after the consumer update and succeeded on clean source
`b3937f0671a8f5fd314fb7a303bc00e4e4bc3b9a`, including the quality gates, Studio,
Preview deployment, access/noindex verification and stable-alias verification.
The owned READY Preview was `dpl_4HacjioZk8mgVhbVj1KqnvzLfhag`. Earlier run 975 lost
its self-hosted Studio agent and skipped Preview; it was not used as rotation proof.

After that successful CI, four single-attempt native revocations returned HTTP 200
with regeneration disabled. Each old entry disappeared from the exact inventory;
each old value subsequently received the SSO 302 challenge on the owned protected
candidate. Two propagation delays required only read-only access probes, with no
mutation retry. The final inventory contains exactly one default replacement.
The new CI Preview returns 200 and `noindex` with that replacement, and an SSO 302
challenge anonymously. Final hook, local-copy and variable-group readbacks match
the approved changes.

Secret values and native provider bodies are withheld from tracked files. Detailed
operation receipts remain in the ignored mode-700 directory with mode-600 files;
the ignored local operational environment file also retains mode 600. Tracked changes are limited to
this redacted record and maintained documentation; no application or dependency
change is included. Validation covers the actual provider inventory, four old-value
refusals, replacement access, preserved native configuration and the successful CI.
The provider operation is complete; its evidence PR awaits review and merge.
AB#117's final security/privacy acceptance and the final serving release remain open.
