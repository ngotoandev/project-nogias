// esbuild entry: the sim's public surface, bundled to a single goja-loadable
// IIFE (global `Sim`). Keep this free of Node APIs — it ships into goja.
export { runReplay, runScriptedFight } from './replay';
export { runTileFight } from './tile-fight';
