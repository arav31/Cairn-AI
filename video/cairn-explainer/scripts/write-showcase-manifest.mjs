import {existsSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const hasShowcase = existsSync(
  join(process.cwd(), "public", "assets", "showcase", "cairn-showcase.mp4"),
);

writeFileSync(
  join(process.cwd(), "src", "showcaseManifest.ts"),
  `export const showcaseVideoAvailable = ${hasShowcase ? "true" : "false"};\n`,
);

console.log(
  hasShowcase
    ? "showcase manifest: using public/assets/showcase/cairn-showcase.mp4"
    : "showcase manifest: using branded placeholder",
);
