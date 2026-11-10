@echo off
chcp 65001 >nul
pip install -r requirements.txt
python app.py
pause
