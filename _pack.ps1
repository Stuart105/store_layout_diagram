$src = 'D:\workbuddykongjian\2026-05-26-14-39-01'
$dst = 'D:\workbuddykongjian\2026-05-26-14-39-01\store-dashboard-source.zip'
$excludeDirs = @('node_modules', '.next', 'out', '.workbuddy', '.vercel')
$excludeFiles = @('project_20260524_130320.tar.gz')

$tempDir = 'D:\workbuddykongjian\2026-05-26-14-39-01\_pack_temp'
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

$items = Get-ChildItem -Path $src -Force | Where-Object {
    $_.Name -notin $excludeDirs -and $_.Name -notin $excludeFiles -and $_.Name -ne '_pack_temp'
}
foreach ($item in $items) {
    Copy-Item -Path $item.FullName -Destination (Join-Path $tempDir $item.Name) -Recurse -Force
}

Compress-Archive -Path (Join-Path $tempDir '*') -DestinationPath $dst -Force
Remove-Item $tempDir -Recurse -Force

$size = (Get-Item $dst).Length / 1MB
Write-Output "ZIP_OK $([math]::Round($size, 2)) MB"
