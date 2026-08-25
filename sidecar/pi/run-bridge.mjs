// Development entry: compile reviewed TypeScript extensions, then start the
// same bridge.js that the packaged Sidecar bundles.
import { prepareReviewedTypeScript } from "./prepare-reviewed-ts.mjs";

await prepareReviewedTypeScript();
await import("./bridge.js");

