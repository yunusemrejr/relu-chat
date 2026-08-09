<?php
/**
 * ReLU.chat — passive IndexNow "smart ping" beacon (event-driven, no cron).
 *
 * Loaded as an async <script src> on every page (before </body>). It is a
 * no-op for the vast majority of requests: it compares the recorded mtime of
 * sitemap.xml (stored in data/indexnow-marker.json) with the file's current
 * mtime. Only after a deploy actually changes sitemap.xml on disk does the
 * NEXT visitor fire a single, fire-and-forget IndexNow submission for the
 * full URL list, then record the mtime. No cron, no queue, no repeat pings.
 *
 * Response is a JS comment so the include is safe under the site's CSP
 * (script-src 'self') and X-Content-Type-Options: nosniff.
 */

header('Content-Type: application/javascript; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Robots-Tag: noindex, nofollow');

const SITEMAP_FILE = __DIR__ . '/../sitemap.xml';
const MARKER_FILE  = __DIR__ . '/../data/indexnow-marker.json';
const INDEXNOW_URL = 'https://api.indexnow.org/indexnow';
const INDEXNOW_KEY = '8dbf00ebf5052a221fc2e9b70e1169eb';
const HOST         = 'relu.chat';

function finish(): void
{
    echo '/* relu.chat ping ok */';
    exit;
}

// 1) No ping unless sitemap.xml was actually touched by a deploy.
$sitemapMtime = @filemtime(SITEMAP_FILE);
if ($sitemapMtime === false) {
    finish();
}

// 2) Already pinged for this sitemap version?
$lastPinged = null;
if (is_file(MARKER_FILE)) {
    $marker = @json_decode((string)@file_get_contents(MARKER_FILE), true);
    if (is_array($marker) && isset($marker['sitemap_mtime'])) {
        $lastPinged = (int)$marker['sitemap_mtime'];
    }
}
if ($lastPinged !== null && $lastPinged >= (int)$sitemapMtime) {
    finish();
}

// 3) Collect the URL list from the sitemap.
$xml = @file_get_contents(SITEMAP_FILE);
if ($xml === false || !preg_match_all('#<loc>(.*?)</loc>#s', $xml, $m)) {
    finish();
}
$urls = [];
foreach ($m[1] as $u) {
    $u = trim($u);
    if ($u !== '') {
        $urls[] = $u;
    }
}
if (count($urls) === 0) {
    finish();
}

// 4) Fire-and-forget submission (short timeouts; never block the page).
$payload = json_encode([
    'host'    => HOST,
    'key'     => INDEXNOW_KEY,
    'urlList' => $urls,
]);
$ok = false;
if (function_exists('curl_init')) {
    $ch = curl_init(INDEXNOW_URL);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json; charset=utf-8'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 5,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_USERAGENT      => 'ReLU.chat-smart-ping/1.0',
    ]);
    $response = curl_exec($ch);
    $status   = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $ok = $response !== false && ($status === 200 || $status === 202);
} else {
    // Fallback without ext-curl (best effort).
    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: application/json\r\n",
        'content' => $payload,
        'timeout' => 5,
    ]]);
    $ok = @file_get_contents(INDEXNOW_URL, false, $ctx) !== false;
}

// 5) Record success so the next visitor is a no-op; on failure, retry on the
//    next visit (bounded to one attempt per visitor).
if ($ok) {
    $data = json_encode([
        'sitemap_mtime' => (int)$sitemapMtime,
        'pinged_at'     => gmdate('c'),
        'url_count'     => count($urls),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
    $fp = @fopen(MARKER_FILE, 'c');
    if ($fp) {
        flock($fp, LOCK_EX);
        ftruncate($fp, 0);
        fwrite($fp, $data);
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

finish();
