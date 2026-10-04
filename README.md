# OLD BTC MINER V5

This is the V4 dashboard rebuilt as a real experimental solo CPU miner. It obtains a SegWit `getblocktemplate` from local Bitcoin Core, constructs the coinbase/header, searches the 32-bit nonce space with browser Web Workers, and submits a found block with `submitblock`. Bitcoin Core remains the consensus authority.

## Important
- Mainnet only: the server refuses to operate against a non-main chain in the live audit.
- The miner is educational/experimental. A desktop CPU has an extraordinarily small chance of finding a current-difficulty Bitcoin block.
- No seed phrase/private key is ever requested.
- Wallet sending is disabled unless `ENABLE_SEND=1` is explicitly set.
- The audit never submits a block.

## Install
`npm install` then `npm test`.

## Run
`npm start` and open `http://127.0.0.1:3000`. Bitcoin Core must be running locally with RPC enabled. Set `BITCOIN_CLI` if `bitcoin-cli` is not on PATH.

## Tests
`npm test` validates SHA-256 vectors, all 64 K constants by deriving them from primes, SHA-256d against Node crypto, nonce endianness/boundaries, target comparison including equality, and exact 2^32 worker partitioning. `npm run bench` measures the kernel. `npm run audit` performs an optional live Mainnet/Core audit and intentionally fails/skips if no synced Core is available rather than pretending it passed.

## Consensus design
The SHA-256d kernel is single-source for Node and browser. The three V4 constant errors were corrected: K[7]=0xab1c5ed5, K[20]=0x2de92c6f, K[25]=0xa831c66d. The miner does not lower difficulty, does not alter the target, and fetches a fresh GBT after submission.
