# OLD BTC MINER V5

Bitcoin Core mainnet CPU solo-mining pool. Browser Web Workers execute SHA-256d proof-of-work and submit shares to a local backend, which constructs and submits valid blocks to Bitcoin Core.

## Important
- Mainnet only: the server operates against Bitcoin Core mainnet.
- The miner is educational/experimental. A desktop CPU has an extraordinarily small chance of finding a current-difficulty Bitcoin block.
- No seed phrase/private key is ever requested.
- Payout address is server-side only — never sent to the browser.
- No fake BTC rewards — reward is 0 until Bitcoin Core accepts a block.

## Install
`npm install` then `npm test`.

## Run (local backend)
```
set BITCOIN_CLI=C:\Program Files\Bitcoin\daemon\bitcoin-cli.exe
copy .env.example .env
REM Edit .env and set PAYOUT_ADDRESS
start-backend.bat
```

Server runs at `http://0.0.0.0:3000`. WebSocket at `ws://0.0.0.0:3000/ws`.

## Deploy
See [DEPLOY.md](DEPLOY.md) for full deployment guide:
- Backend: your PC (Node.js + Bitcoin Core)
- Tunnel: Tailscale Funnel (free, no domain)
- Frontend: Vercel/Netlify (free static hosting)

## Tests
- `npm test` — SHA-256d, K constants, midstate, serialization, pool modules
- `npm run test:pool` — WebSocket protocol, share validation, stale detection
- `npm run test:integration` — Bitcoin Core mainnet integration
- `npm run bench` — SHA-256d kernel benchmark
- `npm run audit` — optional live mainnet/core audit

## Consensus design
SHA-256d kernel is single-source for Node and browser. K constants derived from primes. Miner does not alter the target. Server validates all shares by recalculating hashes.
