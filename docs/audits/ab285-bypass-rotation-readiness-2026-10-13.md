# AB#285 — coordinated bypass rotation preparation

AB#285 moved New → Active before changes under AB#117. The owner authorized
night-time release preparation, commits, pushes and PRs. This slice prepares a
concrete private credential operation; no credentials or access policy were changed.

A fresh owned-project read shows four automation-bypass entries. The current local
operational value matches one. The named CI consumer is the existing protected
`photosite-starter-vercel-preview` variable group. A separate authenticated native
Sanity GET confirms two enabled Production-dataset webhooks: the Production hook
has no bypass header; the protected Preview integration hook has one matching project
key. Raw hook/project bodies stay private; only counts, property names and fixed
readback assertions enter documentation. Three other key entries have no confirmed
consumer in this inventory and must not be silently treated as unused.

The ignored `temp/rotation-plan.md` specifies the exact project/team and consumer
inventory, refreshed baselines, replacement access check, coordinated CI/Preview-hook
header changes, preserved native signing secret, end-to-end follow-up and per-entry
old-key absence checks. It includes bounded abort/recovery behavior and forbids key
values in arguments, receipts, public documentation or logs. Frozen historical approval
packets and receipts are preserved; new operations use fresh configuration instead of
rewriting their provenance. The initial automated permission review timed out; the
allowed single retry of the read-only inventory succeeded without changing anything.

Review the operation and identify the remaining consumers before executing it. Creating
and revoking a provider key, changing a native hook header and replacing a CI secret
are independent from this preparation PR and from Git authorization. A documentation
merge grants no final security/privacy acceptance and does not close the actual
rotation gate. Existing application tests already cover origin-bounded bypass handling;
this documentation-only slice adds no runtime or dependency change.

Validation: private inventory counts and native hook header presence were checked against
the captured responses. Tracked files were checked for actual local/provider credential
values before commit. AB#285 remains Active pending review/merge; AB#117 remains Active
for final release findings, actual credential replacement and owner acceptance.
