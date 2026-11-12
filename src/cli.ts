#!/usr/bin/env node
import { main } from './main.js';
import { nodeIO } from './node-io.js';

delete process.env['ELECTRON_RUN_AS_NODE'];

process.exit(
  await main({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd(), io: nodeIO }),
);
