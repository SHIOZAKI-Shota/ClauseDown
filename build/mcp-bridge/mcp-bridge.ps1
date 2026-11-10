param([string]$Pipe)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$name = $Pipe -replace '^\\\\\.\\pipe\\', ''

function Send-Line([string]$text) {
    [Console]::Out.WriteLine($text)
    [Console]::Out.Flush()
}

function Fail([string]$message, [string]$line) {
    $m = [regex]::Match($line, '"id"\s*:\s*(\d+|"[^"]*")')
    if ($m.Success) { Send-Line ('{"jsonrpc":"2.0","id":' + $m.Groups[1].Value + ',"error":{"code":-32000,"message":"' + $message + '"}}') }
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ($line.Trim() -eq '') { continue }
    try {
        $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', $name, [System.IO.Pipes.PipeDirection]::InOut)
        $pipe.Connect(3000)
        $body = $utf8.GetBytes($line)
        $head = [System.Text.Encoding]::ASCII.GetBytes("POST /mcp HTTP/1.0`r`nHost: clausedown`r`nContent-Type: application/json`r`nAccept: application/json, text/event-stream`r`nContent-Length: $($body.Length)`r`n`r`n")
        $pipe.Write($head, 0, $head.Length)
        $pipe.Write($body, 0, $body.Length)
        $pipe.Flush()
        $buf = New-Object System.IO.MemoryStream
        $pipe.CopyTo($buf)
        $pipe.Dispose()
    } catch {
        Fail 'ClauseDown が起動していないか、設定の「外部の AI からつなぐ（MCP）」がオフです' $line
        continue
    }
    $text = $utf8.GetString($buf.ToArray())
    $split = $text.IndexOf("`r`n`r`n")
    $status = 0
    if ($split -gt 0) { [int]::TryParse($text.Substring(0, $text.IndexOf("`r`n")).Split(' ')[1], [ref]$status) | Out-Null }
    if ($status -ge 200 -and $status -lt 300) {
        $resp = $text.Substring($split + 4).Trim()
        if ($resp) { Send-Line $resp }
    } else {
        Fail "ClauseDown がエラーを返しました（HTTP $status）" $line
    }
}
