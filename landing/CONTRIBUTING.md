# contributing

Keep the visual engine compact and the landing app focused on Cairn.

```sh
pnpm install
pnpm --filter @cairn/wavefield build
pnpm --filter cairn-landing dev
pnpm --filter @cairn/wavefield size
```

The visual engine lives in `packages/wavefield/src`. The landing app lives in `apps/demo`.
