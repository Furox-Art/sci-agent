$ports = 8931, 8777, 8765, 8932
foreach ($p in $ports) {
  Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Output ("port=" + $_.LocalPort + " state=" + $_.State + " pid=" + $_.OwningProcess)
  }
}
