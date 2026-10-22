<#
  Deploys QualiSuite eQMS to Azure App Service (Linux, Node 22) as a shared TEST environment
  with a public https://<app-name>.azurewebsites.net link.

  Prerequisites: Azure CLI installed and signed in (az login) to the subscription to use.
  Run from the project folder:
      powershell -ExecutionPolicy Bypass -File deploy\azure-test-deploy.ps1
      powershell -ExecutionPolicy Bypass -File deploy\azure-test-deploy.ps1 -Sku B1 -Location eastus

  Re-run with the same -AppName to deploy new code; the test data in /home/data is kept.
  Passwords for this environment are generated on the first run and kept in deploy\out\ (never committed).
  Remove everything again with:  az group delete --name rg-jrs-eqms-test
#>
param(
  [string]$AppName = '',
  [string]$ResourceGroup = 'rg-jrs-eqms-test',
  [string]$Location = 'eastus',
  [ValidateSet('F1', 'B1')][string]$Sku = 'F1',
  [string]$OrgName = 'Jupiter Research Services (TEST)'
)
# Azure CLI writes warnings to stderr; Windows PowerShell 5.1 would turn those into errors under 'Stop',
# so native commands are checked through their exit code instead.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $PSScriptRoot 'out'
New-Item -ItemType Directory -Force $out | Out-Null
function Invoke-Az([string]$What) {
  & az @args
  if ($LASTEXITCODE -ne 0) { throw "$What failed (az exit code $LASTEXITCODE)." }
}
function Test-Az { & az @args --output none 2>&1 | Out-Null; return ($LASTEXITCODE -eq 0) }

if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Azure CLI not found. Install it (winget install -e --id Microsoft.AzureCLI), open a new terminal and run: az login' }
if (-not (Test-Az account show)) { throw 'Not signed in to Azure. Run: az login' }

# remember the app name between runs so updates go to the same app
$nameFile = Join-Path $out 'app-name.txt'
if (-not $AppName) { if (Test-Path $nameFile) { $AppName = (Get-Content $nameFile).Trim() } else { $AppName = 'jrs-eqms-test-' + (Get-Random -Minimum 1000 -Maximum 9999) } }
Set-Content -Path $nameFile -Value $AppName -Encoding ascii

# environment passwords: letters and digits only (safe on the command line), upper + lower + digit, 18 characters
function New-TestPassword {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $bytes = New-Object byte[] 14
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return 'Jq7-' + (-join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] }))
}
$credFile = Join-Path $out "credentials-$AppName.txt"
if (Test-Path $credFile) {
  $cred = @{}; foreach ($l in Get-Content $credFile) { if ($l -match '^(ADMIN_INITIAL_PASSWORD|DEMO_PASSWORD)=(.+)$') { $cred[$Matches[1]] = $Matches[2] } }
  $adminPw = $cred.ADMIN_INITIAL_PASSWORD; $demoPw = $cred.DEMO_PASSWORD
} else {
  $adminPw = New-TestPassword; $demoPw = New-TestPassword
}

# package the application code only: no .env, data, tests, Git history or backups
$stage = Join-Path $out 'stage'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item (Join-Path $root 'server.js'), (Join-Path $root 'package.json') $stage
Copy-Item (Join-Path $root 'public') (Join-Path $stage 'public') -Recurse
$zip = Join-Path $out "$AppName.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
# zip entries with forward slashes (Compress-Archive in Windows PowerShell 5.1 writes backslashes, which Linux unpacks as file names)
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$fs = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
$za = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
foreach ($f in Get-ChildItem $stage -Recurse -File) {
  [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($za, $f.FullName, $f.FullName.Substring($stage.Length + 1).Replace('\', '/'))
}
$za.Dispose(); $fs.Dispose()

if (-not (Test-Az webapp show --name $AppName --resource-group $ResourceGroup)) {
  Write-Host "Creating $AppName ($Sku, $Location) ..."
  Invoke-Az 'Creating the resource group' group create --name $ResourceGroup --location $Location --output none
  Invoke-Az 'Creating the App Service plan' appservice plan create --name "$AppName-plan" --resource-group $ResourceGroup --location $Location --sku $Sku --is-linux --output none
  Invoke-Az "Creating the web app $AppName (the name must be unique in Azure; re-run with -AppName <another-name>)" webapp create --name $AppName --resource-group $ResourceGroup --plan "$AppName-plan" --runtime 'NODE:22-lts' --output none
}

Write-Host 'Applying settings ...'
Invoke-Az 'Applying app settings' webapp config appsettings set --name $AppName --resource-group $ResourceGroup --output none --settings `
  HOST=0.0.0.0 COOKIE_SECURE=true DATA_DIR=/home/data SQLITE_JOURNAL=DELETE SESSION_IDLE_MINUTES=60 `
  SEED_DEMO=true "DEMO_PASSWORD=$demoPw" "ADMIN_INITIAL_PASSWORD=$adminPw" "ORG_NAME=$OrgName" `
  "APP_ENV_LABEL=TEST SYSTEM - for team testing only, not for GxP records" `
  SCM_DO_BUILD_DURING_DEPLOYMENT=false WEBSITES_ENABLE_APP_SERVICE_STORAGE=true
Invoke-Az 'Setting the startup command' webapp config set --name $AppName --resource-group $ResourceGroup --startup-file 'node server.js' --output none
if ($Sku -ne 'F1') { Invoke-Az 'Enabling Always On' webapp config set --name $AppName --resource-group $ResourceGroup --always-on true --output none }
Invoke-Az 'Enforcing HTTPS' webapp update --name $AppName --resource-group $ResourceGroup --https-only true --output none

Write-Host 'Deploying code ...'
Invoke-Az "Deployment (see: az webapp log tail --name $AppName --resource-group $ResourceGroup)" webapp deploy --name $AppName --resource-group $ResourceGroup --src-path $zip --type zip --output none

$url = "https://$AppName.azurewebsites.net"
@"
QualiSuite eQMS - shared TEST environment
URL: $url

Administrator: admin  (must change the password at first sign-in)
ADMIN_INITIAL_PASSWORD=$adminPw

Demo users (one password for all, share privately with the test team):
qa.lead, qa.reviewer, author1, cs.manager, stat1, rp1, trainer1, operator1, hod.ops, pm1, director1, inspector1, docctrl1
DEMO_PASSWORD=$demoPw
"@ | Set-Content -Path $credFile -Encoding utf8

Write-Host ''
Write-Host "Done. Test link: $url"
Write-Host "Passwords for this environment: $credFile (share privately; do not e-mail them together with the link)"
