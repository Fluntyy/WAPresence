# smtc-helper.ps1 - Windows SMTC (WinRT) Media Poller
# Outputs single-line JSON to stdout for WAPresence

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' 
    })[0]

    Function Await-WinRt($WinRtTask, $ResultType) {
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(2000) | Out-Null
        return $netTask.Result
    }

    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
    $manager = Await-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

    $lastOutput = ""

    while ($true) {
        try {
            $session = $manager.GetCurrentSession()
            if ($session -ne $null) {
                $playback = $session.GetPlaybackInfo()
                $status = if ($playback) { $playback.PlaybackStatus.ToString() } else { "None" }

                if ($status -eq "Playing" -or $status -eq "Paused") {
                    $props = Await-WinRt ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
                    
                    $trackNum = 0
                    if ($props -and $props.TrackNumber) {
                        $trackNum = $props.TrackNumber
                    }

                    $obj = @{
                        title = if ($props -and $props.Title) { $props.Title } else { "" }
                        artist = if ($props -and $props.Artist) { $props.Artist } else { "" }
                        album = if ($props -and $props.AlbumTitle) { $props.AlbumTitle } else { "" }
                        track_number = $trackNum
                        status = $status
                    }
                    $json = ConvertTo-Json -Compress $obj
                    if ($json -ne $lastOutput) {
                        [Console]::WriteLine($json)
                        $lastOutput = $json
                    }
                } else {
                    $json = '{"status":"Stopped"}'
                    if ($json -ne $lastOutput) {
                        [Console]::WriteLine($json)
                        $lastOutput = $json
                    }
                }
            } else {
                $json = '{"status":"None"}'
                if ($json -ne $lastOutput) {
                    [Console]::WriteLine($json)
                    $lastOutput = $json
                }
            }
        } catch {
            # Ignore transient COM/WinRT error and keep running
        }

        Start-Sleep -Milliseconds 1000
    }
} catch {
    $errObj = @{ error = $_.Exception.Message }
    [Console]::WriteLine((ConvertTo-Json -Compress $errObj))
}
