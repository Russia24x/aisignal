/**
 * OpenNext (Cloudflare) adapter config.
 *
 * The default is deliberately minimal: no R2 incremental cache, no custom
 * overrides — everything needed runs on the free Workers tier. If you later
 * want distributed ISR caching, create a free R2 bucket and see:
 * https://opennext.js.org/cloudflare/caching
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
