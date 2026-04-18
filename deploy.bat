@echo off
echo.
echo ============================================
echo  AdvisoryHub Deploy
echo ============================================
echo.

cd /d C:\Users\scott\OneDrive\AI.app\advisoryhub

echo [1/4] Staging all changes...
git add -A

echo [2/4] Committing...
git commit -m "deploy: %date% %time%"

echo [3/4] Pushing to GitHub...
git push origin main

echo [4/4] Deploying to Vercel...
cd client
vercel --prod

echo.
echo ============================================
echo  Done
echo ============================================
pause