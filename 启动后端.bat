@echo off

title EasyYolo-Backend
echo ==========================================
echo       EasyYolo Backend Server
echo ==========================================
echo.
echo Activating conda environment: torchgpu...
call conda activate torchgpu
if %errorlevel% neq 0 (
    echo [ERROR] Failed to activate conda environment 'torchgpu'!
    echo Please ensure Anaconda/Miniconda is installed and the environment name is correct.
    pause
    exit /b
)

echo.
echo Starting backend service...
python main.py
pause
