$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "=== WanderOS Cloudflare Webhook Setup ===" -ForegroundColor Cyan

$Token = Read-Host "TELEGRAM_BOT_TOKEN"
$WorkerUrl = Read-Host "Worker URL, например https://wanderos-bot.wanderos.workers.dev"

$Token = $Token.Trim()
$WorkerUrl = $WorkerUrl.Trim().TrimEnd("/")

if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Host "Токен пустой." -ForegroundColor Red
    exit 1
}

if ([string]::IsNullOrWhiteSpace($WorkerUrl)) {
    Write-Host "Worker URL пустой." -ForegroundColor Red
    exit 1
}

$WebhookUrl = "$WorkerUrl/webhook"

Write-Host "Устанавливаю webhook:" -ForegroundColor Cyan
Write-Host $WebhookUrl -ForegroundColor Yellow

$ApiUrl = "https://api.telegram.org/bot$Token/setWebhook"
$Response = Invoke-RestMethod -Uri $ApiUrl -Method Post -Body @{ url = $WebhookUrl; drop_pending_updates = "true" }

if ($Response.ok -eq $true) {
    Write-Host "Webhook установлен успешно." -ForegroundColor Green
} else {
    Write-Host "Ошибка установки webhook." -ForegroundColor Red
    Write-Host $Response
    exit 1
}

$InfoUrl = "https://api.telegram.org/bot$Token/getWebhookInfo"
$Info = Invoke-RestMethod -Uri $InfoUrl -Method Get
$Info | ConvertTo-Json -Depth 5
