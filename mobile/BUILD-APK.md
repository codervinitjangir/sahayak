# Building and installing the Android APK (Windows, local)

Read this every time before building for a phone. Two things are easy to forget:
the **live backend URL** and the **long-path build fix**.

## 1. Point the app at the live backend (do this first)

The URL is baked into the JS bundle at build time from `mobile/.env`. The app
never reads it at runtime, so a wrong `.env` means rebuilding.

`mobile/.env` must contain the Render backend, not a LAN or localhost address:

```
EXPO_PUBLIC_API_BASE_URL=https://sahayak-backend-1zzq.onrender.com/api/v1
EXPO_PUBLIC_API_URL=https://sahayak-backend-1zzq.onrender.com/api/v1
```

Check that the backend is up before you hand the phone to anyone:

```bash
curl https://sahayak-backend-1zzq.onrender.com/health
```

It should return `"status":"ok","database":"connected"`.

**Render free tier sleeps after ~15 minutes idle.** The first request after a sleep
(or right after a deploy) can take 30–60 s, and the app gives up after 15 s with
*"We could not reach Sahayak"*. Hit `/health` once to wake it, then retry in the app.

## 2. One-time build setup

The SDK's default CMake 3.22.1 ships ninja 1.10.2. That version cannot create
paths over 260 characters, and react-native-gesture-handler's codegen objects go
past that. The build fails with `ninja: error: mkdir(...): No such file or directory`.

1. Install CMake 3.31.6, which ships ninja 1.12.1. `sdkmanager` is not installed on this machine, so use
   Google's zip:
   `https://dl.google.com/android/repository/cmake-3.31.6-windows.zip`. Unzip it to
   `%LOCALAPPDATA%\Android\Sdk\cmake\3.31.6` (so `bin\cmake.exe` is directly inside).
2. Add the CMake path to `mobile/android/local.properties`. The file is not committed, so it is per machine:
   ```
   sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk
   cmake.dir=C:/Users/<you>/AppData/Local/Android/Sdk/cmake/3.31.6
   ```

If the build still hits a path error, build from a short-path copy, for example
`robocopy mobile C:\sb /MIR /XD <mobile>\android\app\build <mobile>\android\build .cxx .gradle`.
- **Do not** exclude `build` folders in general: `expo-modules-autolinking` needs
  `node_modules/expo-modules-autolinking/build`.
- `subst` drive letters break Expo autolinking, so don't use them.

## 3. Build

From `mobile/android`:

```powershell
.\gradlew.bat assembleRelease "-PreactNativeArchitectures=arm64-v8a"
```

The output is `android/app/build/outputs/apk/release/app-release.apk` (~43 MB). It is signed with the
debug key, which is fine for testing but not for the Play Store (use EAS `production` for that).
`arm64-v8a` covers modern phones. Drop the flag to build every ABI (slower).

## 4. Install on a USB-connected phone

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb devices
& $adb install -r android\app\build\outputs\apk\release\app-release.apk
& $adb shell monkey -p com.sahayak.app 1
```

To confirm which backend a built APK talks to, pull the APK and search
`assets/index.android.bundle` for `onrender.com`.

## Alternative: EAS cloud build

`eas build -p android --profile preview` produces an installable APK with no local
toolchain. It needs an Expo login and takes 15–20 min. It uses the `preview` EAS
environment variables, not `mobile/.env`, so set `EXPO_PUBLIC_API_BASE_URL` there.
