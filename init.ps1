<powershell>
# Chrome
Invoke-WebRequest "https://dl.google.com/chrome/install/latest/chrome_installer.exe" -OutFile "$env:TEMP\chrome_installer.exe"
Start-Process "$env:TEMP\chrome_installer.exe" -Args "/silent /install" -Wait

# Enable sound
Set-Service -Name Audiosrv -StartupType Automatic
Start-Service -Name Audiosrv
</powershell>
