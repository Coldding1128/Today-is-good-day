@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 部署 · 今天是个好日子啊

rem ============================================================
rem  一键部署：提交本地改动并推送到 GitHub，
rem  Cloudflare Pages 收到推送后会自动重新构建。
rem  说明：
rem   - 本机没装 Git for Windows 也能跑，会自动去找 WorkBuddy
rem     自带的便携版 git（在 %USERPROFILE%\.workbuddy\binaries 下）。
rem   - 仓库在 H 盘时属主 SID 可能和当前账户不一致，git 会拒绝操作，
rem     下面会自动把本目录加入 safe.directory（可重复执行）。
rem ============================================================

rem ---------- 1. 找 git ----------
set "GIT="
for /f "delims=" %%i in ('where git 2^>nul') do if not defined GIT set "GIT=%%i"
if not defined GIT if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"
if not defined GIT if exist "%ProgramFiles(x86)%\Git\cmd\git.exe" set "GIT=%ProgramFiles(x86)%\Git\cmd\git.exe"
if not defined GIT if exist "%LocalAppData%\Programs\Git\cmd\git.exe" set "GIT=%LocalAppData%\Programs\Git\cmd\git.exe"
if not defined GIT for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\PortableGit\versions\*") do if not defined GIT if exist "%%~d\cmd\git.exe" set "GIT=%%~d\cmd\git.exe"
if not defined GIT goto :nogit
echo 使用 git: %GIT%
echo.

rem ---------- 2. 仓库授权与提交身份 ----------
"%GIT%" config --global --add safe.directory "%CD%" >nul 2>&1
"%GIT%" config --get user.name  >nul 2>&1 || "%GIT%" config user.name  "Coldding1128"
"%GIT%" config --get user.email >nul 2>&1 || "%GIT%" config user.email "fu18476092695@163.com"

rem ---------- 3. 暂存 / 提交 / 推送 ----------
echo [1/3] 暂存改动...
"%GIT%" add -A || goto :fail

"%GIT%" diff --cached --quiet
if errorlevel 1 (
    echo [2/3] 提交...
    "%GIT%" commit -m "update" || goto :fail
) else (
    echo [2/3] 没有新改动，跳过提交
)

echo [3/3] 推送到 GitHub...
"%GIT%" push || goto :fail

echo.
echo 完成。Cloudflare Pages 大约 1 分钟后自动上线。
pause
exit /b 0

:fail
echo.
echo [X] 上一步失败，把上面的报错原样发出来看看。
pause
exit /b 1

:nogit
echo [X] 没找到 git。
echo     装一个： https://git-scm.com/download/win
echo     装完关掉这个窗口，重新双击本文件即可。
pause
exit /b 1
