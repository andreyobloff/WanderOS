$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectPath = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectPath

if (-not (Test-Path ".env")) {
    Write-Host "Файл .env не найден." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "Виртуальное окружение .venv не найдено." -ForegroundColor Red
    exit 1
}

$env:PYTHONPATH = "$ProjectPath\src"

Write-Host "Запуск WanderOS..." -ForegroundColor Green
Write-Host "Бот @wanderos_bot работает. Для остановки нажмите Ctrl+C." -ForegroundColor Yellow

& ".\.venv\Scripts\python.exe" -m wanderos.main
