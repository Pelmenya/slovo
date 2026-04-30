#!/usr/bin/env node
import { runServer } from './server';

runServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[mcp-flowise] startup failed: ${message}\n`);
    process.exit(1);
});
