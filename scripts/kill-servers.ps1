Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server\.js' } |
  ForEach-Object {
    Write-Output ("KILL " + $_.ProcessId + " :: " + $_.CommandLine.Substring(0, [Math]::Min(80, $_.CommandLine.Length)))
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Write-Output "done"
