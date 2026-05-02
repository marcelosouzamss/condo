# Deploy genérico: envia docker-compose + .env para uma EC2 e executa pull + up -d --force-recreate.
# Copie esta pasta scripts/portable para outro repositório e ajuste os parâmetros ou variáveis de ambiente.
#
# Mesma VM do EngBot: use outro -RemoteDir (ex.: ~/meu-projeto). No compose do outro projeto use portas e
# container_name diferentes dos do EngBot (~/engbot usa 5000, 5432 e engbot-server / engbot-db).
#
# Exemplo:
#   .\deploy-ec2-compose.ps1 `
#     -SshKeyPath "C:\caminho\engbot-server.pem" `
#     -Ec2Host "18.191.229.62" `
#     -Ec2User "ec2-user" `
#     -RemoteDir "~/meu-backend" `
#     -ComposeLocalPath ".\docker-compose.prod.yml" `
#     -EnvLocalPath ".\.env"
#
# Variáveis de ambiente (sobrescrevem defaults dos parâmetros opcionais):
#   EC2_DEPLOY_KEY, EC2_DEPLOY_HOST, EC2_DEPLOY_USER, EC2_DEPLOY_REMOTE_DIR

param(
    [string] $SshKeyPath = $env:EC2_DEPLOY_KEY,
    [string] $Ec2Host = $env:EC2_DEPLOY_HOST,
    [string] $Ec2User = $(if ($env:EC2_DEPLOY_USER) { $env:EC2_DEPLOY_USER } else { "ec2-user" }),
    [string] $RemoteDir = $env:EC2_DEPLOY_REMOTE_DIR,
    [string] $ComposeLocalPath = "",
    [string] $RemoteComposeFileName = "",
    [string] $EnvLocalPath = "",
    [string] $EnvExampleLocalPath = "",
    [switch] $SkipUp
)

$ErrorActionPreference = "Stop"

function Escape-BashSingleQuoted {
    param([string] $Value)
    if ($null -eq $Value) { return "''" }
    return "'" + ($Value -replace "'", "'\''") + "'"
}

function Resolve-AbsolutePath {
    param([string] $PathLike)
    if ([string]::IsNullOrWhiteSpace($PathLike)) { return "" }
    if ([System.IO.Path]::IsPathRooted($PathLike)) { return (Resolve-Path -LiteralPath $PathLike).Path }
    return (Resolve-Path -LiteralPath (Join-Path (Get-Location) $PathLike)).Path
}

if ([string]::IsNullOrWhiteSpace($SshKeyPath)) {
    Write-Host "ERRO: informe -SshKeyPath ou EC2_DEPLOY_KEY." -ForegroundColor Red
    exit 1
}
if ([string]::IsNullOrWhiteSpace($Ec2Host)) {
    Write-Host "ERRO: informe -Ec2Host ou EC2_DEPLOY_HOST." -ForegroundColor Red
    exit 1
}
if ([string]::IsNullOrWhiteSpace($RemoteDir)) {
    Write-Host "ERRO: informe -RemoteDir ou EC2_DEPLOY_REMOTE_DIR (ex.: ~/meu-app)." -ForegroundColor Red
    exit 1
}
if ([string]::IsNullOrWhiteSpace($ComposeLocalPath)) {
    Write-Host "ERRO: informe -ComposeLocalPath (arquivo compose local)." -ForegroundColor Red
    exit 1
}

$keyPath = Resolve-AbsolutePath $SshKeyPath
if (-not (Test-Path -LiteralPath $keyPath)) {
    Write-Host "ERRO: chave SSH não encontrada: $keyPath" -ForegroundColor Red
    exit 1
}

$composeFile = Resolve-AbsolutePath $ComposeLocalPath
if (-not (Test-Path -LiteralPath $composeFile)) {
    Write-Host "ERRO: compose não encontrado: $composeFile" -ForegroundColor Red
    exit 1
}

if ([string]::IsNullOrWhiteSpace($RemoteComposeFileName)) {
    $RemoteComposeFileName = Split-Path -Leaf $composeFile
}

$remoteDirQ = Escape-BashSingleQuoted $RemoteDir
$remoteComposeQ = Escape-BashSingleQuoted $RemoteComposeFileName

Write-Host "Deploy EC2 (compose genérico)" -ForegroundColor Cyan
Write-Host "${Ec2User}@${Ec2Host} -> $RemoteDir | compose remoto: $RemoteComposeFileName" -ForegroundColor Gray
Write-Host ""

Write-Host "Garantindo diretório remoto..." -ForegroundColor Yellow
ssh -i $keyPath -o StrictHostKeyChecking=no "${Ec2User}@${Ec2Host}" "mkdir -p $remoteDirQ"

Write-Host "Enviando $RemoteComposeFileName..." -ForegroundColor Yellow
scp -i $keyPath -o StrictHostKeyChecking=no $composeFile "${Ec2User}@${Ec2Host}:${RemoteDir}/${RemoteComposeFileName}"

$envSent = $false
if (-not [string]::IsNullOrWhiteSpace($EnvLocalPath)) {
    $envFile = Resolve-AbsolutePath $EnvLocalPath
    if (Test-Path -LiteralPath $envFile) {
        Write-Host "Enviando .env..." -ForegroundColor Yellow
        scp -i $keyPath -o StrictHostKeyChecking=no $envFile "${Ec2User}@${Ec2Host}:${RemoteDir}/.env"
        $envSent = $true
    } else {
        Write-Host "AVISO: -EnvLocalPath não existe: $envFile" -ForegroundColor Yellow
    }
}

if (-not $envSent) {
    $envEx = ""
    if (-not [string]::IsNullOrWhiteSpace($EnvExampleLocalPath)) {
        $envEx = Resolve-AbsolutePath $EnvExampleLocalPath
    }
    if ($envEx -and (Test-Path -LiteralPath $envEx)) {
        Write-Host "Enviando .env.example..." -ForegroundColor Yellow
        scp -i $keyPath -o StrictHostKeyChecking=no $envEx "${Ec2User}@${EC2Host}:${RemoteDir}/.env.example"
        Write-Host "Na EC2: cd $RemoteDir && cp .env.example .env && edite o .env" -ForegroundColor Yellow
    } else {
        Write-Host "AVISO: nenhum .env enviado. Crie ~/.../.env na EC2 antes do up." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Arquivos em ${Ec2User}@${Ec2Host}:$RemoteDir" -ForegroundColor Green

if ($SkipUp) {
    Write-Host ""
    Write-Host "SkipUp: não executou pull/up no servidor." -ForegroundColor Cyan
    exit 0
}

Write-Host ""
Write-Host "Pull e subindo containers na EC2..." -ForegroundColor Yellow

$remoteCmd = @"
set -e
cd $remoteDirQ
if [ ! -f .env ]; then
  echo 'ERRO: .env não encontrado neste diretório remoto.'
  exit 1
fi
if command -v docker-compose >/dev/null 2>&1; then
  docker-compose -f $remoteComposeQ pull
  docker-compose -f $remoteComposeQ up -d --force-recreate
elif docker compose version >/dev/null 2>&1; then
  docker compose -f $remoteComposeQ pull
  docker compose -f $remoteComposeQ up -d --force-recreate
else
  echo 'ERRO: instale docker-compose ou o plugin docker compose'
  exit 1
fi
echo 'OK: containers atualizados.'
"@
$remoteCmd = ($remoteCmd -replace "`r`n", "`n") -replace "`r", ""
$remoteCmd | ssh -i $keyPath -o StrictHostKeyChecking=no "${Ec2User}@${Ec2Host}" bash -s
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    Write-Host ""
    Write-Host "ERRO: comando remoto falhou (código $exitCode)." -ForegroundColor Red
    exit $exitCode
}

Write-Host ""
Write-Host "Concluído." -ForegroundColor Green
