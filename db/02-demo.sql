INSERT INTO users (id, wechat_openid, nickname, avatar_key, mbti, bio, show_mbti) VALUES
  (1, 'local-chestnut', '栗子', 'chestnut', 'INFJ', '喜欢电影，也喜欢安静。', TRUE),
  (2, 'local-lin', '小林', 'lin', 'INFP', '', TRUE),
  (3, 'local-zhou', '阿舟', 'zhou', 'ENFP', '', FALSE),
  (4, 'local-youzi', '柚子', 'youzi', NULL, '', TRUE);

INSERT INTO rooms (id, category_id, name, description, cover_key, announcement, announcement_updated_at) VALUES
  (1, (SELECT id FROM room_categories WHERE code='casual'), '深夜茶水间', '下班后，随便聊聊', 'tea', '今晚聊聊下班后的仪式感', UTC_TIMESTAMP(6)),
  (2, (SELECT id FROM room_categories WHERE code='mbti'), '人格观察站', '聊聊不同的性格视角', 'planet', NULL, NULL),
  (3, (SELECT id FROM room_categories WHERE code='interest'), '周末放映厅', '找人聊聊最近看的电影', 'ticket', NULL, NULL),
  (4, (SELECT id FROM room_categories WHERE code='interest'), '自习搭子', '各忙各的，休息时聊几句', 'lamp', NULL, NULL);

INSERT INTO room_members (room_id, user_id, role, joined_at, joined_seq, last_read_seq) VALUES
  (1, 1, 'admin', UTC_TIMESTAMP(6) - INTERVAL 2 DAY, 0, 0),
  (1, 2, 'member', UTC_TIMESTAMP(6) - INTERVAL 2 DAY, 0, 0),
  (1, 3, 'member', UTC_TIMESTAMP(6) - INTERVAL 2 DAY, 0, 0),
  (1, 4, 'member', UTC_TIMESTAMP(6) - INTERVAL 2 DAY, 0, 0),
  (2, 1, 'member', UTC_TIMESTAMP(6) - INTERVAL 2 DAY, 0, 0),
  (2, 2, 'member', UTC_TIMESTAMP(6) - INTERVAL 2 DAY, 0, 0),
  (3, 1, 'member', UTC_TIMESTAMP(6) - INTERVAL 2 DAY, 0, 1),
  (3, 3, 'member', UTC_TIMESTAMP(6) - INTERVAL 2 DAY, 0, 0);

INSERT INTO room_messages (room_id, seq, sender_id, client_msg_id, kind, body, created_at) VALUES
  (1, 1, 2, UUID_TO_BIN(UUID()), 'text', '你们下班后第一件事是什么？', UTC_TIMESTAMP(6) - INTERVAL 4 MINUTE),
  (1, 2, 3, UUID_TO_BIN(UUID()), 'text', '先把手机调成静音。', UTC_TIMESTAMP(6) - INTERVAL 3 MINUTE),
  (1, 3, 1, UUID_TO_BIN(UUID()), 'text', '我会先泡杯茶 🍵', UTC_TIMESTAMP(6) - INTERVAL 2 MINUTE),
  (1, 4, 4, UUID_TO_BIN(UUID()), 'text', '那我提名散步！', UTC_TIMESTAMP(6) - INTERVAL 1 MINUTE),
  (2, 1, 2, UUID_TO_BIN(UUID()), 'text', '这个角度很有意思', UTC_TIMESTAMP(6) - INTERVAL 24 MINUTE),
  (3, 1, 3, UUID_TO_BIN(UUID()), 'text', '周末一起看电影？', UTC_TIMESTAMP(6) - INTERVAL 1 DAY);

UPDATE rooms r JOIN (
  SELECT room_id, MAX(seq) AS last_seq, MAX(created_at) AS last_message_at
  FROM room_messages GROUP BY room_id
) m ON m.room_id = r.id SET r.last_seq=m.last_seq, r.last_message_at=m.last_message_at;

INSERT INTO room_favorites (user_id, room_id) VALUES (1, 1);
