# @bitsocial/voucher-challenge

Standalone voucher challenge extracted from `plebbit-js`, packaged with independent dependencies.

## How it works

Community owners configure a list of voucher codes on their community. When a user publishes for the first time, they are prompted to enter a voucher code. Once redeemed, the voucher becomes permanently bound to the user's `author.address` — that author can continue using the same voucher for future publications (posts, replies, votes), but no other author can claim it. This prevents voucher sharing across different users.

## Requirements

- Node.js `>=22`
- ESM-only environment

## Install

### With bitsocial-cli

```bash
bitsocial challenge install @bitsocial/voucher-challenge
```

Edit your community to use the challenge:

```bash
bitsocial community edit your-community.bso \
  '--settings.challenges[0].name' voucher \
  '--settings.challenges[0].options.vouchers' 'VOUCHER1,VOUCHER2,VOUCHER3'
```

### With pkc-js (TypeScript)

If you are running your own node locally without connecting over RPC, you can install via npm and register the challenge manually:

```bash
npm install @bitsocial/voucher-challenge
```

```ts
import PKC from "@pkcprotocol/pkc-js";
import { voucherChallenge } from "@bitsocial/voucher-challenge";

PKC.challenges["voucher"] = voucherChallenge;
```

Then set the challenge on your community:

```ts
await community.edit({
  settings: {
    challenges: [
      {
        name: "voucher",
        options: {
          vouchers: "VOUCHER1,VOUCHER2,VOUCHER3"
        }
      }
    ]
  }
});
```

## Challenge Options

All option values must be strings.

| Option | Default | Description |
|--------|---------|-------------|
| `question` | `"What is your voucher code?"` | The interactive prompt the user is asked to type an answer to |
| `vouchers` | *(required)* | Comma-separated list of voucher codes |
| `description` | — | Informational text shown in the UI explaining what the challenge is about |
| `invalidVoucherError` | Default message | Error shown for invalid voucher codes |
| `alreadyRedeemedError` | Default message | Error shown when a voucher is already redeemed by another author |

## Scripts

```bash
npm run typecheck
npm run build
npm test
```
