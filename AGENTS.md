# AGENTS Notes

- Current compatibility target: `@pkcprotocol/pkc-js`
- This repo is ESM only and will only run in Node.js.
- Everything in this repo should be fully typed, including tests.
- Assume this repo will be ran in node v22+

Workflow:

- Before every commit, run `npm run typecheck` and ensure it passes with no errors.
- if we add a feature, then add tests for it
- if we fix a bug, make sure to create a test to replicate the bug first and then fix it
