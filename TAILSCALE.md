# Tailscale Funnel Setup Guide for OLD BTC MINER V5

This guide explains how to expose your local mining pool backend to the internet using Tailscale Funnel (free, no domain required).

## Prerequisites

- Windows 10/11 PC running the backend
- Bitcoin Core running with RPC enabled
- Node.js 18+ installed

## Step 1: Install Tailscale

1. Download Tailscale for Windows from https://tailscale.com/download/windows
2. Install and sign in with your Google/Microsoft/GitHub account
3. Tailscale will assign your PC a stable hostname like `your-pc-name.tail1234.ts.net`

## Step 2: Enable Tailscale Funnel

Tailscale Funnel is available on the free Personal plan.

1. Open PowerShell as Administrator
2. Run:
   ```powershell
   tailscale funnel enable 3000
   ```
3. This creates a public HTTPS URL for your local port 3000:
   ```
   https://your-pc-name.tail1234.ts.net/
   ```
4. WebSocket connections are automatically supported at:
   ```
   wss://your-pc-name.tail1234.ts.net/ws
   ```

## Step 3: Configure Your Backend

1. Copy `.env.example` to `.env`:
   ```
   copy .env.example .env
   ```

2. Edit `.env` and set:
   ```
   BITCOIN_CLI=C:\Program Files\Bitcoin\daemon\bitcoin-cli.exe
   PAYOUT_ADDRESS=your_bitcoin_address_here
   PORT=3000
   CORS_ORIGIN=*
   ```

3. Start the backend:
   ```
   start-backend.bat
   ```

## Step 4: Configure Your Frontend

1. Edit `frontend/config.js`:
   ```javascript
   window.BACKEND_URL='wss://your-pc-name.tail1234.ts.net/ws';
   ```

2. Replace `your-pc-name.tail1234.ts.net` with your actual Tailscale hostname.

## Step 5: Deploy Frontend to Vercel

1. Install Vercel CLI:
   ```
   npm install -g vercel
   ```

2. From the project root:
   ```
   vercel
   ```

3. Follow the prompts. The `vercel.json` is already configured.

4. Your frontend will be available at `https://your-project.vercel.app`

## Step 6: Verify Connection

1. Open your Vercel frontend URL in a browser
2. Click [ START MINING ]
3. Check the browser console for:
   - "WEBSOCKET CONNECTED"
   - "MINER ID: miner_xxx"
   - "NEW JOB: xxxxxx"

4. Check your backend console for:
   - "Miner connected: miner_xxx"

## Security Notes

- Tailscale Funnel uses HTTPS with automatic TLS certificates
- Your real IP address is hidden behind Tailscale's infrastructure
- Bitcoin Core RPC is NOT exposed — only your Node.js backend is
- The `.env` file with your payout address stays on your PC only
- No credentials or private keys are sent to the browser

## Troubleshooting

### "WEBSOCKET DISCONNECTED"
- Check that `tailscale funnel enable 3000` is active
- Verify backend is running on port 3000
- Check `frontend/config.js` has the correct WSS URL

### "BACKEND_URL NOT CONFIGURED"
- Edit `frontend/config.js` and set the correct WSS URL

### Backend shows "Payout address: [NOT SET]"
- Copy `.env.example` to `.env`
- Set `PAYOUT_ADDRESS` to your Bitcoin address
- Restart the backend

### "RPC ERROR" on frontend
- Ensure Bitcoin Core is running
- Verify `bitcoin-cli getblockchaininfo` works from command line
- Check `BITCOIN_CLI` path in `.env`
