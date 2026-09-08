$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $PSScriptRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electron)) {
    throw 'Project Electron is missing. Install desktop dependencies first.'
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist\index.html'))) {
    throw 'Desktop build is missing. Build the desktop project first.'
}
$previousKey = $env:MINIMAX_API_KEY
$previousCodexHome = $env:CODEX_HOME
try {
    if ([string]::IsNullOrWhiteSpace($env:MINIMAX_API_KEY)) {
        $secureKey = Read-Host 'MiniMax API Key (hidden, used only by this process)' -AsSecureString
        $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        try {
            $env:MINIMAX_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer).Trim()
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
            $secureKey.Dispose()
        }
    }
    if ([string]::IsNullOrWhiteSpace($env:MINIMAX_API_KEY)) { throw 'API Key cannot be empty.' }
    $env:CODEX_HOME = Join-Path $projectRoot '.project-cache\codex-home'
    Start-Process -FilePath $electron -ArgumentList ('"' + $PSScriptRoot + '"') -WorkingDirectory $PSScriptRoot
} finally {
    $env:MINIMAX_API_KEY = $previousKey
    $env:CODEX_HOME = $previousCodexHome
}
