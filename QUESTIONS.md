# Questions for Human

## [Q1] What's the target user persona -- developers using Copilot for personal projects or teams/enterprises?
Status: OPEN
Priority: HIGH
Context: This shapes everything: pricing messaging, auth flows (PAT vs SSO), feature priorities. If enterprise, you need org-level token support and audit logging. If indie developers, the "use your $10/mo subscription everywhere" angle is the killer pitch.

## [Q2] Is there risk of GitHub shutting down the internal API or blocking third-party access?
Status: OPEN
Priority: HIGH
Context: The entire library depends on reverse-engineering api.githubcopilot.com and copilot_internal endpoints. If GitHub changes these without warning, the library breaks. Understanding the risk tolerance here affects how much to invest. Any TOS language around this? Should there be a disclaimer in the README?

## [Q3] Do you want to publish to npm under `lib-copilot` or rebrand the package to match the CLI name `vcopilot`?
Status: OPEN
Priority: MEDIUM
Context: There's a naming split -- the npm package is `lib-copilot` but the CLI binary is `vcopilot`. Both names are fine, but users might search for either. A unified name reduces confusion.

## [Q4] Should the library support the Copilot Extensions API (tool use, agents) or stay focused on chat/completions?
Status: OPEN
Priority: MEDIUM
Context: GitHub Copilot Extensions let you build custom agents. Supporting this would make lib-copilot the definitive Copilot SDK, but it's a significant scope expansion. The current core is solid and shippable as-is.

## [Q5] What's the monetization strategy -- pure open source, freemium hosted service, or paid CLI?
Status: OPEN
Priority: LOW
Context: Options: (a) pure OSS with sponsorship, (b) hosted proxy service with caching and team management, (c) premium CLI with conversation history, prompt templates, multi-file context. The "use your $10/mo subscription everywhere" angle is strong for OSS virality.
