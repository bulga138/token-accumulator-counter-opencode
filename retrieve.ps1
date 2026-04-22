param(
  [string]$Owner = "bulga138",
  [string]$Repo  = "shared-config",
  [int]$IssueNumber = 3
)

function Fix-Mojibake([string]$s) {
  # If string contains high-byte characters, attempt re-decode from CP1252 -> UTF8
  if ($s -match '[\x80-\xFF]') {
    $bytes = [System.Text.Encoding]::GetEncoding(1252).GetBytes($s)
    return [System.Text.Encoding]::UTF8.GetString($bytes)
  }
  return $s
}

$endpoint = "repos/$Owner/$Repo/issues/$IssueNumber/comments"
$json = gh api --paginate $endpoint -H "Accept: application/vnd.github+json"
$comments = $json | ConvertFrom-Json

if (-not $comments) { Write-Host "No comments found."; exit 0 }

foreach ($c in $comments) {
  $id = $c.id
  $body = $c.body -replace "`r",""  # normalize CRLF
  $body = Fix-Mojibake $body
  $filename = "issue-$IssueNumber-comment-$id.diff"
  # Use UTF8 without BOM
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($filename, $body, $utf8NoBom)
  Write-Host "Wrote $filename"
}
