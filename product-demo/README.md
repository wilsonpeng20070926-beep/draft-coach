# Draft Coach Product Demonstration

This privacy-safe interactive site explains the Draft Coach desktop application to product and data-source reviewers.

Live demonstration: https://draft-coach-wilson-demo.savory-heron-7495.chatgpt.site/

The simulated draft is self-contained. It does not connect to a Riot account, the League Client, OP.GG, or Leaguepedia, and it does not fetch live data.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

## Validation

```bash
npm test
npm audit --audit-level=high
```

The public desktop application source and release policy are in the parent repository.
