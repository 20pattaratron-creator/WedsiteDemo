# Security Policy

## Scope

ERP DEMO 3.9 is a local/static demonstration application and is not a production security boundary. Do not use it to store real production credentials or sensitive customer data.

## AI Coding Agent Safety

Before opening this repository with an AI coding agent, run:

```bash
npm run security:preflight
npm run security:verify-baseline
```

Do not enable permission bypass or broad auto-run modes for unfamiliar repositories. Review project-controlled agent configuration, MCP configuration, editor tasks, Dev Container lifecycle commands and package lifecycle scripts before trust.

See `SECURITY_AGENT_GUIDE_TH.md` for the Thai operational checklist.

## Secrets

Never commit `.env`, private keys, cloud service-account credentials, production tokens or database passwords. If a secret is committed, assume compromise and rotate it; deleting it from the latest commit is not sufficient.

## Reporting

For this demo project, stop distribution of the affected build, preserve the commit/hash for investigation, rotate exposed credentials if any, then patch and rerun security/codebase tests before redeployment.
