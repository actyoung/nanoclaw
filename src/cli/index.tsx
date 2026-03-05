#!/usr/bin/env node
/**
 * NanoClaw CLI - Ink-based React CLI
 */
import { render } from 'ink';
import { App } from './components/App.js';

const args = process.argv.slice(2);
const debug = args.includes('--debug');

render(<App debug={debug} />);
