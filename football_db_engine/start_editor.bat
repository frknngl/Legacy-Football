@echo off
title Football DB Engine Server
echo ==================================================
echo Football Simulation Data Engine
echo ==================================================
echo.
echo Starting the engine... The editor will automatically open in your browser shortly.
echo.
echo (Keep this black window open while using the editor. Close this window to shut down the server.)
echo.
python -m streamlit run editor_app.py
pause
