# Independent Product Probes

See `docs/codex-ai-coach-product-e2e-evaluation-1.md` for the decision and evidence boundaries.

Run from repository root:

```powershell
npx tsx test/codex-ai-coach-product-e2e-1/product-probes.ts
npx tsx test/codex-ai-coach-product-e2e-1/domain-probes.ts
```

`product-probes.ts` uses real AI-service workflow/action rows with stubbed external boundaries, plus the real nutrition processor with model/catalog fixtures. `domain-probes.ts` uses the fitness-service environment and real import/database functions. Both create isolated random user IDs and clean their records in finally blocks. A zero exit code means observations were reproduced, not that the product passed acceptance.

`browser-probe.js` is a Playwright CLI function for the existing local Vite server. It mounts real preview components with fixture props, takes mobile screenshots, and checks the defer label. It does not authenticate or save any business action.

Generated results contain observed behavior and routine application logs. Production code is not modified by these probes. The report distinguishes executed boundaries from code inspection and unverified live provider behavior.
