<?php
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

header('Access-Control-Allow-Origin: https://relu.chat');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed.']);
    exit;
}

$email = isset($_POST['email']) ? trim($_POST['email']) : '';

if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Please provide a valid email address.']);
    exit;
}

$dbFile = __DIR__ . '/../data/subscribers.db';
$dbDir = dirname($dbFile);

if (!is_dir($dbDir)) {
    if (!mkdir($dbDir, 0750, true)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Server configuration error. Please try again later.']);
        exit;
    }
}

try {
    $db = new PDO('sqlite:' . $dbFile);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    $db->exec('
        CREATE TABLE IF NOT EXISTS subscribers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            ip_address TEXT,
            created_at TEXT DEFAULT (datetime(\'now\'))
        )
    ');

    $stmt = $db->prepare('INSERT OR IGNORE INTO subscribers (email, ip_address) VALUES (:email, :ip)');
    $stmt->execute([
        ':email' => strtolower($email),
        ':ip' => isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown'
    ]);

    if ($stmt->rowCount() > 0) {
        echo json_encode(['success' => true]);
    } else {
        http_response_code(409);
        echo json_encode(['success' => false, 'error' => 'This email is already registered.']);
    }
} catch (PDOException $e) {
    error_log('ReLU.chat SQLite error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Something went wrong. Please try again.']);
}
