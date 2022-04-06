function boot_support_roster() {
    try {
        Set-Location -Path C:\SupportRoster
        if (Test-Path "C:\SupportRoster") { Invoke-Expression -Command "pm2 start index.js" }
    }
    catch {
        write-host "error : $_" -foregroundcolor red
    }
}

boot_support_roster