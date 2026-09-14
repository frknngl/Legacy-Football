@echo off
REM WORLD.DB EDITORU -- her tabloya erisim, her satira duzenleme.
REM
REM Eski `editor_app.py` fm_database.db'ye bakiyordu ve yalnizca dort tablo
REM icin elle yazilmis sayfalar tasiyordu. Tek dogruluk kaynagi artik
REM data/world.db ve editor tablolari semadan OKUR.
cd /d "%~dp0\.."
streamlit run football_db_engine/world_editor.py
