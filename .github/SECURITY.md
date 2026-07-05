# Security Policy

## Reporting a Vulnerability

**Please do NOT open a public issue for security vulnerabilities.**

If you discover a security vulnerability in Edge Agents, please report it responsibly:

1. Use GitHub's [private vulnerability reporting](https://github.com/ForestHubAI/edge-agents/security/advisories/new), or
2. Email us at **root@foresthub.ai**.

We take security reports seriously and will respond as soon as we can.

## Supported Versions

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older versions | No |

## Security Update Process

- Security fixes are released as patch versions.
- Advisories are published via [GitHub Security Advisories](https://github.com/ForestHubAI/edge-agents/security/advisories).

## Scope

Edge Agents is a workflow runtime engine plus an LLM proxy. Examples of issues we consider
security-relevant:

- **Credential leakage** — LLM provider keys (OpenAI / Anthropic / Gemini / …) or
  control-plane credentials exposed through logs, error messages, or serialization.
- **Untrusted workflow config** — a deployed workflow graph or expression that escapes its
  intended sandbox (file, network, or host access beyond a node's contract).
- **Request forgery (SSRF)** — e.g. via the web-fetch or other HTTP-calling nodes.
- **Local builder server** — the HTTP server `fh-workflow open` runs on localhost: file
  access beyond the served workflow's directory, or reads/writes triggered by another
  origin (CSRF, DNS rebinding). The engine itself serves no inbound HTTP; its only
  control-plane surface is outbound (`FH_BACKEND_URL` / `ENGINE_SECRET`), covered by
  the credential-leakage item above.
- **Injection** — in config parsing, expression evaluation, or request construction.
- **Denial of service** — unbounded resource consumption in the runner.

Issues in upstream LLM providers (OpenAI, Anthropic, Google, …) should be reported to
those providers directly.
