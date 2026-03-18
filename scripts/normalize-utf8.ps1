[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$utf8Strict = [System.Text.UTF8Encoding]::new($false, $true)
$utf16Le = [System.Text.UnicodeEncoding]::new($false, $true, $true)
$utf16Be = [System.Text.UnicodeEncoding]::new($true, $true, $true)
$utf32Le = [System.Text.UTF32Encoding]::new($false, $true, $true)
$utf32Be = [System.Text.UTF32Encoding]::new($true, $true, $true)
$gb18030 = [System.Text.Encoding]::GetEncoding("GB18030")
$gbk = [System.Text.Encoding]::GetEncoding(936)
$latin1 = [System.Text.Encoding]::GetEncoding(1252)

$textExtensions = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
@(
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".jsonc", ".css", ".scss", ".less",
  ".html", ".htm", ".md", ".txt", ".toml",
  ".yml", ".yaml", ".env", ".example", ".gitignore",
  ".svg", ".xml", ".csv", ".sh", ".ps1"
) | ForEach-Object { [void]$textExtensions.Add($_) }

$textNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
@(
  ".env",
  ".env.example",
  ".gitignore",
  "README",
  "README.md",
  "LICENSE",
  "LICENSE.txt",
  "NOTICE",
  "NOTICE.txt",
  "Dockerfile"
) | ForEach-Object { [void]$textNames.Add($_) }

$excludeDirNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
@("node_modules", ".git", "dist") | ForEach-Object { [void]$excludeDirNames.Add($_) }

function Test-TextCandidate {
  param([System.IO.FileInfo]$File)

  if ($textNames.Contains($File.Name)) {
    return $true
  }

  if ($textExtensions.Contains($File.Extension)) {
    return $true
  }

  return $false
}

function Get-BomEncoding {
  param([byte[]]$Bytes)

  if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) {
    return $utf8NoBom
  }
  if ($Bytes.Length -ge 4 -and $Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xFE -and $Bytes[2] -eq 0x00 -and $Bytes[3] -eq 0x00) {
    return $utf32Le
  }
  if ($Bytes.Length -ge 4 -and $Bytes[0] -eq 0x00 -and $Bytes[1] -eq 0x00 -and $Bytes[2] -eq 0xFE -and $Bytes[3] -eq 0xFF) {
    return $utf32Be
  }
  if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xFE) {
    return $utf16Le
  }
  if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFE -and $Bytes[1] -eq 0xFF) {
    return $utf16Be
  }

  return $null
}

function Try-DecodeText {
  param(
    [byte[]]$Bytes,
    [System.Text.Encoding]$Encoding
  )

  try {
    return $Encoding.GetString($Bytes)
  } catch {
    return $null
  }
}

function Get-DecodeScore {
  param([string]$Text)

  if ($null -eq $Text) {
    return [int]::MaxValue
  }

  $score = 0
  $score += ([regex]::Matches($Text, [string][char]0xFFFD)).Count * 500
  $score += ([regex]::Matches($Text, "[\x00-\x08\x0B\x0C\x0E-\x1F]")).Count * 50
  $score += ([regex]::Matches($Text, '宸|鍏|閽|瀛|锛|浠|鎴|鏌|鍒|鏈|榛|璇|缁|缂|绋|鍔|娑|鑳|鏂|瀵|鎹|绱|闂|鍥|鍙|鐩|鎺|搴|绗|繘|榫')).Count * 20

  return $score
}

function Resolve-TextContent {
  param([byte[]]$Bytes)

  $bomEncoding = Get-BomEncoding -Bytes $Bytes
  if ($bomEncoding) {
    $decoded = Try-DecodeText -Bytes $Bytes -Encoding $bomEncoding
    return [pscustomobject]@{
      Text     = $decoded
      Encoding = $bomEncoding.EncodingName
      Score    = Get-DecodeScore -Text $decoded
    }
  }

  $candidates = New-Object System.Collections.Generic.List[object]

  try {
    $decodedUtf8 = $utf8Strict.GetString($Bytes)
    $candidates.Add([pscustomobject]@{
      Text     = $decodedUtf8
      Encoding = "UTF-8"
      Score    = Get-DecodeScore -Text $decodedUtf8
    }) | Out-Null
  } catch {
  }

  foreach ($encoding in @($gb18030, $gbk, $latin1)) {
    $decoded = Try-DecodeText -Bytes $Bytes -Encoding $encoding
    if ($null -ne $decoded) {
      $candidates.Add([pscustomobject]@{
        Text     = $decoded
        Encoding = $encoding.EncodingName
        Score    = Get-DecodeScore -Text $decoded
      }) | Out-Null
    }
  }

  if ($candidates.Count -eq 0) {
    throw "Unable to decode file content."
  }

  return $candidates | Sort-Object Score, Encoding | Select-Object -First 1
}

function Remove-LeadingBomChar {
  param([string]$Text)

  if ($null -eq $Text) {
    return $Text
  }

  if ($Text.Length -gt 0 -and $Text[0] -eq [char]0xFEFF) {
    return $Text.Substring(1)
  }

  return $Text
}


$candidateFiles = Get-ChildItem -Path $root -Recurse -File | Where-Object {
  $path = $_.FullName
  $segments = $path.Substring($root.Length).TrimStart('\', '/').Split([char[]]@('\', '/'), [System.StringSplitOptions]::RemoveEmptyEntries)
  -not ($segments | Where-Object { $excludeDirNames.Contains($_) }) -and (Test-TextCandidate $_)
}

$rewritten = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

foreach ($file in $candidateFiles) {
  $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
  if ($bytes.Length -eq 0) {
    continue
  }

  $resolved = Resolve-TextContent -Bytes $bytes
  $resolved.Text = Remove-LeadingBomChar -Text $resolved.Text
  $utf8Bytes = $utf8NoBom.GetBytes($resolved.Text)

  if ($resolved.Score -gt 0 -and $file.Name -ne 'normalize-utf8.ps1') {
    $warnings.Add("$($file.FullName) [$($resolved.Encoding)] score=$($resolved.Score)") | Out-Null
  }

  $sameLength = $bytes.Length -eq $utf8Bytes.Length
  $sameBytes = $sameLength
  if ($sameBytes) {
    for ($i = 0; $i -lt $bytes.Length; $i++) {
      if ($bytes[$i] -ne $utf8Bytes[$i]) {
        $sameBytes = $false
        break
      }
    }
  }

  if (-not $sameBytes) {
    try {
      if ($file.IsReadOnly) {
        $file.IsReadOnly = $false
      }
      [System.IO.File]::WriteAllText($file.FullName, $resolved.Text, $utf8NoBom)
      $rewritten.Add($file.FullName) | Out-Null
    } catch {
      $warnings.Add("WRITE_FAILED: $($file.FullName) :: $($_.Exception.Message)") | Out-Null
    }
  }
}

Write-Output "Scanned files: $($candidateFiles.Count)"
Write-Output "Rewritten as UTF-8: $($rewritten.Count)"
if ($warnings.Count -gt 0) {
  Write-Output "Warnings:"
  $warnings | Sort-Object | ForEach-Object { Write-Output $_ }
}
