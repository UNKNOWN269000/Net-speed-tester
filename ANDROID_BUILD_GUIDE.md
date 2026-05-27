# 📱 UNKNOWN SPEED TEST — Convert to Android APK

## Prerequisites (Install These First)

### 1. Install Node.js
- Download from: https://nodejs.org (v18 or higher)

### 2. Install Android Studio
- Download from: https://developer.android.com/studio
- During installation, make sure to install:
  - ✅ Android SDK
  - ✅ Android SDK Platform-Tools
  - ✅ Android Emulator (optional, for testing)
- After installing, open Android Studio → SDK Manager → install **Android API 34** (or latest)

### 3. Set Environment Variables
**Windows:**
```
set ANDROID_HOME=C:\Users\<YOUR_USERNAME>\AppData\Local\Android\Sdk
set PATH=%PATH%;%ANDROID_HOME%\platform-tools
```

**Mac/Linux:**
```bash
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

---

## Step-by-Step Build Guide

### Step 1: Install Dependencies
Open terminal in the project root folder and run:
```bash
npm install
```

### Step 2: Install Capacitor
```bash
npm install @capacitor/core @capacitor/cli
npm install @capacitor/android
```

### Step 3: Build the Web App
```bash
npm run build
```
This creates the `dist/` folder with your production-ready web app.

### Step 4: Initialize Capacitor (if not already done)
The `capacitor.config.ts` file is already created. If asked to init:
```bash
npx cap init "UNKNOWN SPEED TEST" "com.unknown.speedtest" --web-dir dist
```

### Step 5: Add Android Platform
```bash
npx cap add android
```
This creates an `android/` folder with a full Android Studio project.

### Step 6: Sync Web Files to Android
```bash
npx cap sync android
```
This copies your built web app into the Android project.

### Step 7: Open in Android Studio
```bash
npx cap open android
```
This opens the project in Android Studio.

### Step 8: Build the APK in Android Studio
1. Wait for Gradle sync to complete (bottom progress bar)
2. Go to **Build** → **Build Bundle(s)/APK(s)** → **Build APK(s)**
3. Wait for the build to finish
4. Click **"Locate"** in the popup notification
5. Your APK is at: `android/app/build/outputs/apk/debug/app-debug.apk`

### Step 9: Install on Your Phone
**Option A — USB Cable:**
1. Enable **Developer Options** on your phone:
   - Go to Settings → About Phone → tap "Build Number" 7 times
2. Enable **USB Debugging** in Developer Options
3. Connect phone via USB
4. Run: `adb install android/app/build/outputs/apk/debug/app-debug.apk`

**Option B — Transfer the APK:**
1. Copy the `app-debug.apk` file to your phone (WhatsApp, Telegram, Google Drive, etc.)
2. Open it on your phone and tap **Install**
3. You may need to allow "Install from Unknown Sources"

---

## Build a Signed Release APK (For Publishing)

### Step 1: Generate a Keystore
```bash
keytool -genkey -v -keystore unknown-speedtest.keystore -alias speedtest -keyalg RSA -keysize 2048 -validity 10000
```
Follow the prompts to set passwords and details.

### Step 2: Configure Signing in Android Studio
1. Open Android Studio
2. Go to **Build** → **Generate Signed Bundle/APK**
3. Choose **APK**
4. Select your keystore file
5. Enter your passwords
6. Choose **release** build type
7. Click **Finish**

### Step 3: Find Your Signed APK
Located at: `android/app/build/outputs/apk/release/app-release.apk`

---

## Quick Commands Reference

```bash
# Install everything
npm install
npm install @capacitor/core @capacitor/cli @capacitor/android

# Build + Sync
npm run build
npx cap sync android

# Open Android Studio
npx cap open android

# After making code changes, re-sync:
npm run build && npx cap sync android
```

---

## Changing App Icon

1. Prepare a 1024x1024 PNG icon
2. In Android Studio: right-click `android/app/src/main/res` → **New** → **Image Asset**
3. Select your icon image
4. Click **Next** → **Finish**

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `npx cap open android` fails | Make sure Android Studio is installed and in PATH |
| Gradle sync fails | Click "Sync Project with Gradle Files" button in Android Studio |
| White screen on phone | Run `npx cap sync android` again after `npm run build` |
| Network requests fail | The `androidScheme: 'https'` in capacitor.config.ts handles this |
| App crashes on launch | Check Logcat in Android Studio for error details |

---

## 🎉 Done!
Your **UNKNOWN SPEED TEST** app is now an Android APK!
