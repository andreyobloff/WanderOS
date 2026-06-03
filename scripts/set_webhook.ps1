$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectPath = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectPath

if (-not (Test-Path ".env")) {
    Write-Host "Файл .env не найден." -ForegroundColor Red
    exit 1
}

$TokenLine = Get-Content ".env" | Where-Object { $_ -like "TELEGRAM_BOT_TOKEN=*" } | Select-Object -First 1
$SecretLine = Get-Content ".env" | Where-Object { $_ -like "WEBHOOK_SECRET=*" } | Select-Object -First 1

$Token = $TokenLine -replace "^TELEGRAM_BOT_TOKEN=", ""
$Secret = $SecretLine -replace "^WEBHOOK_SECRET=", ""

if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Host "TELEGRAM_BOT_TOKEN пустой." -ForegroundColor Red
    exit 1
}

if ([string]::IsNullOrWhiteSpace($Secret)) {
    Write-Host "WEBHOOK_SECRET пустой." -ForegroundColor Red
    exit 1
}

$PublicUrl = Read-Host "Вставь публичный HTTPS URL сервиса без слеша в конце"
$PublicUrl = $PublicUrl.TrimEnd("/")

$WebhookUrl = "$PublicUrl/webhook/$Secret"

Write-Host "Устанавливаю webhook:" -ForegroundColor Cyan
Write-Host $WebhookUrl -ForegroundColor Yellow

$ApiUrl = "https://api.telegram.org/bot$Token/setWebhook"
$Response = Invoke-RestMethod -Uri $ApiUrl -Method Post -Body @{ url = $WebhookUrl }

if ($Response.ok -eq $true) {
    Write-Host "Webhook установлен успешно." -ForegroundColor Green
} else {
    Write-Host "Ошибка установки webhook." -ForegroundColor Red
    Write-Host $Response
    exit 1
}
