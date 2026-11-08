-- يتنفذ تلقائيًا عند تشغيل السيرفر. تقدر كمان تشغله يدويًا من HeidiSQL.
CREATE TABLE IF NOT EXISTS users(
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_admin TINYINT NOT NULL DEFAULT 0,
  can_add TINYINT NOT NULL DEFAULT 1,
  can_edit TINYINT NOT NULL DEFAULT 1,
  can_delete TINYINT NOT NULL DEFAULT 0,
  can_approve TINYINT NOT NULL DEFAULT 0,
  active TINYINT NOT NULL DEFAULT 1,
  pref_sound TINYINT NOT NULL DEFAULT 1,
  pref_badges TINYINT NOT NULL DEFAULT 1,
  pref_general TINYINT NOT NULL DEFAULT 1,
  pref_poll INT NOT NULL DEFAULT 7,
  created_at VARCHAR(19)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shipments(
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(50) NOT NULL UNIQUE,
  client VARCHAR(255) NOT NULL,
  carrier VARCHAR(255),
  bl_number VARCHAR(255),
  arrival_date VARCHAR(20),
  type VARCHAR(255),
  stage INT NOT NULL DEFAULT 1,
  responsible_id INT,
  created_by VARCHAR(100), created_at VARCHAR(19),
  updated_by VARCHAR(100), updated_at VARCHAR(19),
  deleted TINYINT NOT NULL DEFAULT 0,
  order_number VARCHAR(255), location VARCHAR(255), tax_number VARCHAR(255), packages VARCHAR(100),
  weight VARCHAR(100), net_weight VARCHAR(100), invoice_value VARCHAR(100), invoice_currency VARCHAR(20),
  contract VARCHAR(255), acid VARCHAR(255), usage_purpose VARCHAR(255), tariff_item VARCHAR(255),
  origin VARCHAR(255), category VARCHAR(255), field_46 VARCHAR(255), supplier VARCHAR(255),
  INDEX idx_ship_deleted(deleted)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- الملفات نفسها بتتخزن جوه القاعدة (data) عشان الاستضافة مفيهاش تخزين دائم
CREATE TABLE IF NOT EXISTS documents(
  id INT AUTO_INCREMENT PRIMARY KEY,
  shipment_id INT NOT NULL,
  doc_type VARCHAR(100) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  size INT DEFAULT 0,
  data LONGBLOB,
  uploaded_by VARCHAR(255), uploaded_at VARCHAR(19),
  deleted TINYINT NOT NULL DEFAULT 0,
  INDEX idx_doc_ship(shipment_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notes(
  id INT AUTO_INCREMENT PRIMARY KEY,
  shipment_id INT NOT NULL,
  username VARCHAR(255), ts VARCHAR(19), text TEXT,
  INDEX idx_note_ship(shipment_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit(
  id INT AUTO_INCREMENT PRIMARY KEY,
  ts VARCHAR(19), username VARCHAR(100), action VARCHAR(255), entity VARCHAR(50), entity_id VARCHAR(50), details TEXT,
  INDEX idx_audit_entity(entity, entity_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings(
  k VARCHAR(100) PRIMARY KEY,
  v TEXT
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks(
  id INT AUTO_INCREMENT PRIMARY KEY,
  shipment_id INT NOT NULL,
  from_id INT NOT NULL, to_id INT NOT NULL,
  title VARCHAR(255) NOT NULL, details TEXT,
  status VARCHAR(50) DEFAULT 'جديد',
  created_at VARCHAR(19), read_at VARCHAR(19), started_at VARCHAR(19), done_at VARCHAR(19),
  INDEX idx_task_to(to_id), INDEX idx_task_ship(shipment_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages(
  id INT AUTO_INCREMENT PRIMARY KEY,
  sender_id INT NOT NULL, recipient_id INT NOT NULL,
  shipment_id INT, task_id INT,
  body TEXT, file_name VARCHAR(255), file_data LONGBLOB,
  created_at VARCHAR(19), read_at VARCHAR(19),
  INDEX idx_msg_pair(sender_id, recipient_id, id), INDEX idx_msg_unread(recipient_id, read_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_seen(
  user_id INT PRIMARY KEY, last_general_id INT DEFAULT 0
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS offers(
  id INT AUTO_INCREMENT PRIMARY KEY,
  shipment_id INT NOT NULL,
  provider VARCHAR(255) NOT NULL, service VARCHAR(255), price DOUBLE, currency VARCHAR(10), details TEXT,
  status VARCHAR(50) DEFAULT 'مقترح',
  added_by VARCHAR(255), added_at VARCHAR(19), approved_by VARCHAR(255), approved_at VARCHAR(19),
  deleted TINYINT NOT NULL DEFAULT 0,
  INDEX idx_offer_ship(shipment_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS doc_pulls(
  id INT AUTO_INCREMENT PRIMARY KEY,
  shipment_id INT NOT NULL,
  doc_type VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'مطلوب',
  pulled_date VARCHAR(20), responsible_id INT, note VARCHAR(500),
  updated_by VARCHAR(100), updated_at VARCHAR(19),
  UNIQUE KEY uq_pull(shipment_id, doc_type)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
