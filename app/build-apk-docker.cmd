@echo off
setlocal
cd /d "%~dp0"

if not exist ".env.android" (
  copy "env.android.example" ".env.android" >nul
  echo Created app\.env.android from the safe example.
  echo Edit app\.env.android and set the two public Supabase values and your EXPO_TOKEN, then run this script again.
  exit /b 1
)

findstr /B /C:"EXPO_TOKEN=" ".env.android" >nul
if errorlevel 1 (
  echo app\.env.android must contain EXPO_TOKEN=your-expo-access-token.
  exit /b 1
)

if not exist "dist-local" mkdir "dist-local"

docker build --platform linux/amd64 -f "Dockerfile.android" -t "istmiya-android-builder" .
if errorlevel 1 exit /b 1

docker run --rm --platform linux/amd64 --env-file ".env.android" --volume "%cd%:/workspace" --workdir "/workspace" --env "EAS_LOCAL_BUILD_ARTIFACTS_DIR=/workspace/dist-local" "istmiya-android-builder"
if errorlevel 1 exit /b 1

echo Local EAS build finished. APK artifacts:
dir /s /b "dist-local\*.apk"
