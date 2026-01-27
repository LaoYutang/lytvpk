param(
    [string[]]$IpList,
    [string]$TargetUrl = "https://cdn.steamusercontent.com/ugc/10630879313735449686/EA95DD369B4DDA7E4D2DB2B7009B629BB042492D/"
)

# --- Configuration ---
# You can add or remove IPs here
$DefaultIpList = @(

)

# Use default list if no IP provided
if ($null -eq $IpList -or $IpList.Count -eq 0) {
    Write-Host "No IP list provided, using default hardcoded list." -ForegroundColor Yellow
    $IpList = $DefaultIpList
}

# Handle case where comma-separated string is passed as single argument
if ($IpList.Count -eq 1 -and $IpList[0] -match ",") {
    $IpList = $IpList[0] -split ","
}
$IpList = $IpList | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

# Function to format bytes to human readable string
function Format-FileSize {
    param([double]$Bytes)
    $sizes = "B", "KB", "MB", "GB", "TB"
    $i = 0
    while ($Bytes -ge 1024 -and $i -lt $sizes.Count - 1) {
        $Bytes /= 1024
        $i++
    }
    return "{0:N2} {1}" -f $Bytes, $sizes[$i]
}

Write-Host "Starting Network Test..." -ForegroundColor Cyan
Write-Host "Target URL: $TargetUrl" -ForegroundColor Gray
Write-Host "IP Count:   $($IpList.Count)" -ForegroundColor Gray
Write-Host ""

$results = @()

foreach ($ip in $IpList) {
    Write-Host "Testing IP: $ip" -NoNewline

    # 1. Latency Test (TCP Connect) - Run 3 times
    $uri = [System.Uri]$TargetUrl
    $port = if ($uri.Scheme -eq "https") { 443 } else { 80 }
    
    $latencies = @()
    
    Write-Host " -> Ping: " -NoNewline
    
    for ($i = 1; $i -le 3; $i++) {
        try {
            $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            $socket = New-Object System.Net.Sockets.TcpClient
            $connectTask = $socket.ConnectAsync($ip, $port)
            if ($connectTask.Wait(2000)) { # 2s timeout
                $stopwatch.Stop()
                $lat = $stopwatch.Elapsed.TotalMilliseconds
                $latencies += $lat
                $socket.Close()
                Write-Host ("{0:N0}ms " -f $lat) -ForegroundColor Green -NoNewline
            } else {
                 Write-Host "X " -ForegroundColor Red -NoNewline
            }
            $socket.Dispose()
        }
        catch {
             Write-Host "Err " -ForegroundColor Red -NoNewline
        }
        Start-Sleep -Milliseconds 100
    }

    if ($latencies.Count -eq 0) {
        Write-Host " -> Unreachable" -ForegroundColor Red
        continue
    }

    $avgLatency = ($latencies | Measure-Object -Average).Average
    Write-Host ("(Avg: {0:N0} ms)" -f $avgLatency) -ForegroundColor Green -NoNewline

    # 2. Speed Test using curl.exe - Run 3 times
    # We use curl because it supports --resolve to force specific IP with correct SNI
    
    $speeds = @()
    
    Write-Host " | Speed: " -NoNewline
    
    try {
        # Extract hostname from URL
        $hostname = $uri.Host
        
        for ($i = 1; $i -le 3; $i++) {
            # curl arguments:
            # -o NUL: discard output
            # -s: silent
            # -k: insecure (ignore cert errors if any)
            # -r 0-5242880: first 5MB
            # --resolve host:port:ip: force connection to IP
            # -w %{speed_download}: output average download speed in bytes/sec
            
            $curlArgs = @(
                "-o", "NUL",
                "-s",
                "-k",
                "-r", "0-5242880",
                "--resolve", "${hostname}:${port}:${ip}",
                "-w", "%{speed_download}",
                "$TargetUrl"
            )
            
            $pinfo = New-Object System.Diagnostics.ProcessStartInfo
            $pinfo.FileName = "curl.exe"
            $pinfo.Arguments = $curlArgs -join " "
            $pinfo.RedirectStandardOutput = $true
            $pinfo.UseShellExecute = $false
            $pinfo.CreateNoWindow = $true
            
            $p = New-Object System.Diagnostics.Process
            $p.StartInfo = $pinfo
            $p.Start() | Out-Null
            $p.WaitForExit()
            
            $output = $p.StandardOutput.ReadToEnd()
            
            if ($p.ExitCode -eq 0 -and $output -match "^\d+(\.\d+)?$") {
                $speedBps = [double]$output
                $speedMBps = $speedBps / 1024 / 1024
                $speeds += $speedMBps
                Write-Host ("{0:N2} " -f $speedMBps) -ForegroundColor Yellow -NoNewline
            } else {
                Write-Host "X " -ForegroundColor Red -NoNewline
            }
            
            # Small delay between speed tests
            Start-Sleep -Milliseconds 200
        }
        
        if ($speeds.Count -gt 0) {
            $avgSpeed = ($speeds | Measure-Object -Average).Average
            Write-Host ("MB/s (Avg: {0:N2} MB/s)" -f $avgSpeed) -ForegroundColor Yellow
            
            $results += [PSCustomObject]@{
                IP = $ip
                AvgLatencyMs = [math]::Round($avgLatency, 2)
                AvgSpeedMBps = [math]::Round($avgSpeed, 2)
            }
        } else {
            Write-Host "Failed all speed tests" -ForegroundColor Red
        }
    }
    catch {
        Write-Host " | Speed Test Error: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "--- Results (Sorted by Speed) ---" -ForegroundColor Cyan
$results | Sort-Object AvgSpeedMBps -Descending | Format-Table -AutoSize
