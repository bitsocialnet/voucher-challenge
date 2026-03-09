# @bitsocial/voucher-challenge

Standalone voucher challenge extracted from `plebbit-js`, packaged with independent dependencies.

## Status

- Runtime peer dependency is currently `@plebbit/plebbit-js`.
- This package is expected to migrate to `@pkc/pkc-js` soon.

## Requirements

- Node.js `>=22`
- ESM-only environment

## Install

```bash
npm install @bitsocial/voucher-challenge
```

## Usage

```ts
import Plebbit from "@plebbit/plebbit-js";
import { voucherChallenge } from "@bitsocial/voucher-challenge";

Plebbit.challenges["voucher"] = voucherChallenge;
```

## Challenge Options

- `question`: The question to ask for the voucher code (default: `What is your voucher code?`)
- `vouchers`: Comma-separated list of voucher codes available for redemption (required)
- `description`: Custom description for the challenge
- `invalidVoucherError`: Error message shown when an invalid voucher code is entered
- `alreadyRedeemedError`: Error message shown when a voucher has already been redeemed by someone else

## Scripts

```bash
npm run typecheck
npm run build
npm test
```
