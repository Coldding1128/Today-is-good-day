@echo off
chcp 936 >nul 2>&1
title 部署 - 今天是个好日子啊
cd /d "%~dp0"

rem ============================================================
rem  一键部署：暂存改动 -> 提交 -> 推送到 GitHub，
rem  Cloudflare Pages 收到推送后自动重新构建上线。
rem
rem  两种常见环境问题这里都处理了：
rem   1. 本机没装 Git for Windows 也能跑，会自动去找 WorkBuddy
rem      自带的便携版 git。
rem   2. 仓库放在 H 盘时，文件夹属主 SID 可能和当前账户不一致，
rem      git 会以 dubious ownership 为由拒绝操作，
rem      这里会自动把本目录写进 safe.directory，可重复执行。
rem ============================================================

rem ---------- 1. 找 git ----------
set "GIT="
for /f "delims=" %%i in ('where git 2^>nul') do if not defined GIT set "GIT=%%i"
if not defined GIT if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"
if not defined GIT if exist "%ProgramFiles(x86)%\Git\cmd\git.exe" set "GIT=%ProgramFiles(x86)%\Git\cmd\git.exe"
if not defined GIT if exist "%LocalAppData%\Programs\Git\cmd\git.exe" set "GIT=%LocalAppData%\Programs\Git\cmd\git.exe"
if not defined GIT for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\PortableGit\versions\*") do if not defined GIT if exist "%%~d\cmd\git.exe" set "GIT=%%~d\cmd\git.exe"
if not defined GIT if exist "C:\WB\CN\resources\vendor\PortableGit\mingw64\bin\git.exe" set "GIT=C:\WB\CN\resources\vendor\PortableGit\mingw64\bin\git.exe"
if not defined GIT if exist "D:\WB\CN\resources\vendor\PortableGit\mingw64\bin\git.exe" set "GIT=D:\WB\CN\resources\vendor\PortableGit\mingw64\bin\git.exe"
if not defined GIT if exist "%ProgramFiles%\WorkBuddy\resources\vendor\PortableGit\mingw64\bin\git.exe" set "GIT=%ProgramFiles%\WorkBuddy\resources\vendor\PortableGit\mingw64\bin\git.exe"
if not defined GIT if exist "%LocalAppData%\Programs\WorkBuddy\resources\vendor\PortableGit\mingw64\bin\git.exe" set "GIT=%LocalAppData%\Programs\WorkBuddy\resources\vendor\PortableGit\mingw64\bin\git.exe"
if not defined GIT goto nogit
echo 使用 git: %GIT%
echo.

rem ---------- 2. 仓库授权与提交身份 ----------
"%GIT%" config --global --add safe.directory "%CD%" >nul 2>&1
"%GIT%" config --get user.name  >nul 2>&1 || "%GIT%" config user.name  "Coldding1128"
"%GIT%" config --get user.email >nul 2>&1 || "%GIT%" config user.email "232179522+Coldding1128@users.noreply.github.com"

rem ---------- 3. 暂存 / 提交 / 推送 ----------
echo [1/3] 暂存改动...
"%GIT%" add -A || goto fail

"%GIT%" diff --cached --quiet
if errorlevel 1 goto commit
echo [2/3] 没有新改动，跳过提交
goto push

:commit
echo [2/3] 提交...
"%GIT%" commit -m "update" || goto fail

:push
echo [3/3] 推送到 GitHub...
"%GIT%" push && goto done

echo.
echo [提示] 第一次推送没成功，可能是证书吊销列表访问不到，
echo        换个校验收紧度再试一次，不影响提交内容。
"%GIT%" -c http.schannelCheckRevoke=false push || goto fail

:done
echo.
echo 完成。Cloudflare Pages 大约 1 分钟后自动上线。
pause
exit /b 0

:fail
echo.
echo [X] 上一步失败了，把上面的报错原样发出来看看。
pause
exit /b 1

:nogit
echo [X] 没找到 git。
echo     装一个就行: https://git-scm.com/download/win
echo     装完关掉这个窗口，重新双击本文件。
pause
exit /b 1
