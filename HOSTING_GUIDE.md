# 🚀 Hosting UNKNOWN SPEED TEST on GitHub & Netlify

---

## Option 1: Netlify (Easiest — Recommended)

### Step 1: Create GitHub Repository

1. Go to [github.com](https://github.com) and sign in (or create account)
2. Click the **+** icon → **New repository**
3. Name it: `unknown-speed-test`
4. Keep it **Public** (or Private if you prefer)
5. Click **Create repository**

### Step 2: Push Your Code to GitHub

Open terminal in your project folder and run:

```bash
# Initialize git (if not already)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - UNKNOWN SPEED TEST"

# Add your GitHub repo as remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/unknown-speed-test.git

# Push to GitHub
git branch -M main
git push -u origin main
```

### Step 3: Deploy on Netlify

1. Go to [netlify.com](https://www.netlify.com) and sign up with GitHub
2. Click **"Add new site"** → **"Import an existing project"**
3. Choose **GitHub**
4. Select your `unknown-speed-test` repository
5. Netlify auto-detects settings from `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
6. Click **"Deploy site"**
7. Wait 1-2 minutes... ✅ **DONE!**

### Your Live URL:
Netlify gives you a URL like: `https://random-name-123.netlify.app`

**To customize the URL:**
1. Go to **Site settings** → **Domain management**
2. Click **Options** → **Edit site name**
3. Change to: `unknown-speed-test` 
4. Your URL becomes: `https://unknown-speed-test.netlify.app`

---

## Option 2: GitHub Pages (Free)

### Step 1: Create GitHub Repository
Same as above (Option 1, Step 1)

### Step 2: Push Your Code to GitHub
Same as above (Option 1, Step 2)

### Step 3: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** (tab at top)
3. Click **Pages** (left sidebar)
4. Under **Source**, select **GitHub Actions**
5. The workflow file (`.github/workflows/deploy.yml`) handles deployment automatically!

### Step 4: Wait for Deployment

1. Go to **Actions** tab in your repo
2. You'll see the workflow running
3. Wait for green checkmark ✅
4. Your site is live!

### Your Live URL:
`https://YOUR_USERNAME.github.io/unknown-speed-test/`

---

## Quick Commands Reference

```bash
# First time setup
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/unknown-speed-test.git
git branch -M main
git push -u origin main

# After making changes
git add .
git commit -m "Updated feature X"
git push
```

Netlify and GitHub Pages will **automatically redeploy** when you push changes!

---

## Comparison

| Feature | Netlify | GitHub Pages |
|---------|---------|--------------|
| **Speed** | Very Fast (CDN) | Fast |
| **Custom Domain** | Free | Free |
| **HTTPS** | Automatic | Automatic |
| **Deploy Preview** | Yes (on PRs) | No |
| **Build Time** | ~30 seconds | ~1-2 minutes |
| **Ease** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

---

## Add Custom Domain (Optional)

### On Netlify:
1. **Site settings** → **Domain management** → **Add custom domain**
2. Enter your domain: `speedtest.yourdomain.com`
3. Add DNS records as shown by Netlify

### On GitHub Pages:
1. **Settings** → **Pages** → **Custom domain**
2. Enter your domain
3. Add CNAME record pointing to `YOUR_USERNAME.github.io`

---

## 🎉 Done!

Your **UNKNOWN SPEED TEST** is now live on the internet!

- **Netlify URL**: `https://unknown-speed-test.netlify.app`
- **GitHub Pages URL**: `https://YOUR_USERNAME.github.io/unknown-speed-test/`
