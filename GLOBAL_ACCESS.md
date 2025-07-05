# Global Access Setup Guide

## Option 1: ngrok (Recommended for Development)

### Quick Start
1. Run the batch file:
   ```bash
   ./start-tunnel.bat
   ```

2. Or use npm script:
   ```bash
   npm run tunnel
   ```

3. Get your public URL from the ngrok terminal window (looks like: https://abc123.ngrok.io)

### Setup ngrok (One-time)
1. Sign up at https://ngrok.com
2. Get your auth token from the dashboard
3. Run: `ngrok config add-authtoken YOUR_TOKEN_HERE`

### Benefits
- ✅ Free tier available
- ✅ HTTPS automatically provided
- ✅ Easy to use
- ✅ Great for development and testing

## Option 2: Cloudflare Tunnel (Free & Production-Ready)

### Setup
1. Install cloudflared:
   ```bash
   winget install cloudflare.cloudflared
   ```

2. Login to Cloudflare:
   ```bash
   cloudflared tunnel login
   ```

3. Create a tunnel:
   ```bash
   cloudflared tunnel create my-backend
   ```

4. Create a config file at `%USERPROFILE%\.cloudflared\config.yml`:
   ```yaml
   tunnel: YOUR_TUNNEL_ID
   credentials-file: C:\Users\YourUser\.cloudflared\YOUR_TUNNEL_ID.json

   ingress:
     - hostname: your-backend.your-domain.com
       service: http://localhost:3001
     - service: http_status:404
   ```

5. Route traffic to your tunnel:
   ```bash
   cloudflared tunnel route dns my-backend your-backend.your-domain.com
   ```

6. Run the tunnel:
   ```bash
   cloudflared tunnel run my-backend
   ```

### Benefits
- ✅ Completely free
- ✅ Production-ready
- ✅ Custom domain support
- ✅ DDoS protection
- ✅ Better performance than ngrok

## Option 3: serveo.net (Simple & Free)

### Usage
```bash
ssh -R 80:localhost:3001 serveo.net
```

### Benefits
- ✅ No registration required
- ✅ Completely free
- ✅ Very simple

## Option 4: localhost.run (Alternative)

### Usage
```bash
ssh -R 80:localhost:3001 nokey@localhost.run
```

## Option 5: Port Forwarding (If you have router access)

1. Forward port 3001 on your router to your computer's local IP
2. Use your public IP address: `http://YOUR_PUBLIC_IP:3001`
3. Find your public IP: https://whatismyipaddress.com/

## Security Considerations

⚠️ **Important**: When exposing your backend globally:

1. **Use HTTPS** - ngrok and Cloudflare provide this automatically
2. **Rate limiting** - Consider adding express-rate-limit
3. **Environment variables** - Never expose secrets in your .env file
4. **Authentication** - Your Clerk JWT tokens provide security
5. **Firewall** - Consider restricting access to specific IPs if possible

## Production Deployment

For production, consider these platforms:
- **Railway** (railway.app) - Easy deployment
- **Render** (render.com) - Great free tier
- **Heroku** (heroku.com) - Popular choice
- **Vercel** (vercel.com) - Excellent for APIs
- **Netlify Functions** - Serverless option

## Updating Frontend URL

Don't forget to update your frontend's API URL to point to your tunnel URL:

```typescript
// In your frontend apiClient.ts
const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://your-ngrok-url.ngrok.io';
```
