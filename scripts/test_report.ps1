param(
    [string]$BaseUrl = "http://localhost:8000",
    [string]$Instrument = "mmse",
    [string]$PatientId = "P001",
    [string]$AudioPath = "static\\questions\\MMSE_Q1.mp3",
    [string]$OutputPath = "result.json",
    [string]$ApiUrl = "https://play-game-api.azurewebsites.net/v1.0/telemetry/info",
    [string]$PayloadPath = "data\\reports\\mock_full_result.json",
    [switch]$Submit,
    [switch]$DirectPost 
)

$ErrorActionPreference = "Stop"

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

Write-Host "Using BaseUrl: $BaseUrl"
Write-Host "Using Instrument: $Instrument"

if ($DirectPost) {
    if (-not (Test-Path $PayloadPath)) {
        throw "Payload JSON not found: $PayloadPath"
    }
    $payloadObject = Get-Content -Raw -Encoding utf8 $PayloadPath | ConvertFrom-Json
    $wrappedBody = @{ info = $payloadObject } | ConvertTo-Json -Depth 20
    $resp = Invoke-WebRequest -Method Post -Uri $ApiUrl -Body $wrappedBody -ContentType "application/json" -UseBasicParsing
    Write-Host "Direct POST status: $($resp.StatusCode)"
    Write-Host "Direct POST response: $($resp.Content)"
    return
}

if (-not (Test-Path $AudioPath)) {
    throw "Audio file not found: $AudioPath"
}

# 1) Create session
$payload = @{
    patient_id = $PatientId
    instrument = $Instrument
    config = @{}
} | ConvertTo-Json

$session = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/sessions" -Body $payload -ContentType "application/json"
Assert-True ($null -ne $session.session_id) "Failed to create session."
$sessionId = $session.session_id
Write-Host "Session ID: $sessionId"

# 2) Get next question
$question = Invoke-RestMethod -Uri "$BaseUrl/api/sessions/$sessionId/next"
Assert-True ($null -ne $question.question_id) "Failed to fetch question."
Write-Host "Question ID: $($question.question_id)"

# 3) Upload response
$uploadResponseText = & curl.exe -s -w "`n%{http_code}" -X POST `
  -F "audio=@$AudioPath" `
  -F "question_id=$($question.question_id)" `
  "$BaseUrl/api/sessions/$sessionId/responses"

$uploadLines = $uploadResponseText -split "`n"
$uploadStatus = $uploadLines[-1].Trim()
Assert-True ($uploadStatus -match "^[0-9]+$") "Upload did not return a status code."
Assert-True ([int]$uploadStatus -ge 200 -and [int]$uploadStatus -lt 300) "Upload failed with status $uploadStatus."

Start-Sleep -Milliseconds 300

# 4) Fetch report or submit
if ($Submit) {
    $submitResult = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/sessions/$sessionId/submit"
    Assert-True ($submitResult.session_id -eq $sessionId) "Submit session_id mismatch."
    Assert-True ($null -ne $submitResult.report) "Submit missing report."
    $report = $submitResult.report
} else {
    $report = Invoke-RestMethod -Uri "$BaseUrl/api/sessions/$sessionId/report"
    Assert-True ($report.session_id -eq $sessionId) "Report session_id mismatch."
}
Assert-True ($null -ne $report.responses) "Report missing responses."
Assert-True ($report.responses.Count -ge 1) "Report responses empty."

# 5) Save result
$report | ConvertTo-Json -Depth 12 | Out-File -Encoding utf8 $OutputPath
Write-Host "Report saved to: $OutputPath"
Write-Host "OK"
