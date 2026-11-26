# Local Android APK build with Docker

This project uses Expo SDK 58 and EAS local builds. Docker runs the Linux build toolchain on Windows, so Android compilation does not consume the monthly EAS cloud build quota. Expo still provides the existing Android signing credentials to the local build, so the build needs a private `EXPO_TOKEN`.

## One-time setup on Windows

1. Install Docker Desktop and start it with the WSL 2 / Linux containers backend.
2. Open CMD in the repository's `app` directory:
   ```cmd
   cd /d D:\\App-Istmina\\app
   copy env.android.example .env.android
   notepad .env.android
   ```
3. Fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` with the public app values. Do not use a service-role key.
4. Create/copy an Expo access token from the Expo account that owns the project and put it in `EXPO_TOKEN`. Do not share it or commit `.env.android`.
5. Run:
   ```cmd
   build-apk-docker.cmd
   ```

The first run builds the Docker image and downloads the Android SDK/NDK; it can take a while and needs several GB of free disk space. The APK is written under `app\\dist-local`. That output directory is ignored by Git.

## Rebuilding after code changes

Pull the latest source, edit the app, then rerun `build-apk-docker.cmd`. Docker reuses its cached Android toolchain. Each preview build uses the existing EAS `preview` profile, which is configured for an APK and automatic version increment.

To install over an existing copy, the APK must be signed with the same Android keystore and have a higher `versionCode`. This builder uses the project's remote EAS credentials; do not create a new keystore for routine updates. Install with Android's package installer, or connect a device with USB debugging and use:
```cmd
adb install -r dist-local\your-build.apk
```
If Android rejects the update because the signature or version is different, do not uninstall the existing app until its data is backed up; confirm the correct EAS project and signing key first.

This app does not currently use an over-the-air update setup for ordinary JavaScript changes. Rebuild and distribute a new APK after each code change; native dependency, permission, or app configuration changes always require a new APK.

## CI and EAS cloud fallback

GitHub's quality workflow runs lint, TypeScript, unit tests, and the web export on pushes and pull requests without an Expo build. The EAS cloud APK workflow is manual only; it remains available from GitHub Actions when desired, but it uses the plan's cloud build quota.

The local build still depends on Expo for authentication and remote signing credentials. Docker removes the Expo cloud build worker from the compilation path; it does not remove the need for a valid Expo account/token or signing credentials.
