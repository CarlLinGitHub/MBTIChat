CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT COMMENT '用户 ID' PRIMARY KEY,
  wechat_openid VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '用户在该小程序下的微信 OpenID',
  nickname VARCHAR(40) NOT NULL COMMENT '显示昵称',
  avatar_key VARCHAR(512) NULL COMMENT '头像的对象存储键，未设置时为空',
  bio VARCHAR(240) NOT NULL DEFAULT '' COMMENT '个人简介',
  mbti CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'MBTI 类型，未填写时为空',
  show_mbti BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否向其他用户展示 MBTI',
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否开启消息通知，不影响未读计数',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '账号创建时间（UTC）',
  UNIQUE KEY uq_wechat_openid (wechat_openid),
  CHECK (mbti IN ('ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP',
                  'ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE room_categories (
  id SMALLINT UNSIGNED AUTO_INCREMENT COMMENT '房间分类 ID' PRIMARY KEY,
  code VARCHAR(24) NOT NULL COMMENT '分类唯一编码' UNIQUE,
  name VARCHAR(24) NOT NULL COMMENT '分类显示名称',
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '分类展示顺序，值越小越靠前'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE rooms (
  id BIGINT UNSIGNED AUTO_INCREMENT COMMENT '房间 ID' PRIMARY KEY,
  category_id SMALLINT UNSIGNED NOT NULL COMMENT '所属分类 ID',
  name VARCHAR(60) NOT NULL COMMENT '房间名称',
  description VARCHAR(240) NOT NULL DEFAULT '' COMMENT '房间简介',
  cover_key VARCHAR(512) NULL COMMENT '房间封面的对象存储键，未设置时为空',
  status ENUM('open','closed') NOT NULL DEFAULT 'open' COMMENT '房间状态：开放或关闭',
  announcement VARCHAR(500) NULL COMMENT '当前群公告，未设置时为空',
  announcement_updated_at DATETIME(6) NULL COMMENT '公告最后更新时间（UTC），未更新时为空',
  last_seq BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '房间末条消息序号，无消息时为 0',
  last_message_at DATETIME(6) NULL COMMENT '房间末条消息的发送时间（UTC），无消息时为空',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '房间创建时间（UTC）',
  KEY ix_lobby_category (category_id, status, id),
  KEY ix_lobby (status, id),
  FOREIGN KEY (category_id) REFERENCES room_categories (id),
  CHECK ((last_seq = 0 AND last_message_at IS NULL) OR
         (last_seq > 0 AND last_message_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE room_members (
  room_id BIGINT UNSIGNED NOT NULL COMMENT '所属房间 ID',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '成员用户 ID',
  role ENUM('admin','member') NOT NULL DEFAULT 'member' COMMENT '成员角色：管理员或普通成员',
  joined_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '本轮入群时间（UTC）',
  left_at DATETIME(6) NULL COMMENT '本轮退群时间（UTC），为空表示仍在群内',
  muted_until DATETIME(6) NULL COMMENT '禁言截止时间（UTC），为空表示未禁言',
  joined_seq BIGINT UNSIGNED NOT NULL COMMENT '本轮入群时的房间末条序号，只能读取之后的消息',
  last_read_seq BIGINT UNSIGNED NOT NULL COMMENT '本轮连续已读位置，入群时等于 joined_seq',
  PRIMARY KEY (room_id, user_id),
  KEY ix_member_conversations (user_id, left_at, room_id),
  KEY ix_room_active_members (room_id, left_at, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms (id),
  FOREIGN KEY (user_id) REFERENCES users (id),
  CHECK (last_read_seq >= joined_seq),
  CHECK (left_at IS NULL OR left_at >= joined_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE room_messages (
  room_id BIGINT UNSIGNED NOT NULL COMMENT '所属房间 ID',
  seq BIGINT UNSIGNED NOT NULL COMMENT '房间内递增的消息序号，从 1 开始',
  sender_id BIGINT UNSIGNED NOT NULL COMMENT '发送者的用户 ID',
  client_msg_id BINARY(16) NOT NULL COMMENT '客户端消息 UUID 的二进制值，用于重试去重',
  kind ENUM('text','image') NOT NULL COMMENT '消息类型：文本或图片',
  state ENUM('visible','recalled','hidden') NOT NULL DEFAULT 'visible' COMMENT '消息状态：可见、已撤回或已隐藏',
  body VARCHAR(2000) NULL COMMENT '可见文本消息的正文，其他情况为空',
  media_key VARCHAR(512) NULL COMMENT '可见图片消息的对象存储键，其他情况为空',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '服务端记录的发送时间（UTC）',
  PRIMARY KEY (room_id, seq),
  UNIQUE KEY uq_message_retry (room_id, sender_id, client_msg_id),
  FOREIGN KEY (room_id, sender_id) REFERENCES room_members (room_id, user_id),
  CHECK (seq > 0),
  CHECK ((state <> 'visible' AND body IS NULL AND media_key IS NULL) OR
         (state = 'visible' AND kind = 'text' AND body IS NOT NULL
          AND CHAR_LENGTH(TRIM(body)) > 0 AND media_key IS NULL) OR
         (state = 'visible' AND kind = 'image' AND body IS NULL
          AND media_key IS NOT NULL AND CHAR_LENGTH(media_key) > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE room_favorites (
  user_id BIGINT UNSIGNED NOT NULL COMMENT '发起收藏的用户 ID',
  room_id BIGINT UNSIGNED NOT NULL COMMENT '被收藏的房间 ID',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '收藏时间（UTC）',
  PRIMARY KEY (user_id, room_id),
  KEY ix_favorite_list (user_id, created_at, room_id),
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (room_id) REFERENCES rooms (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_blocks (
  user_id BIGINT UNSIGNED NOT NULL COMMENT '发起拉黑的用户 ID',
  blocked_user_id BIGINT UNSIGNED NOT NULL COMMENT '被拉黑的用户 ID',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '拉黑时间（UTC）',
  PRIMARY KEY (user_id, blocked_user_id),
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (blocked_user_id) REFERENCES users (id),
  CHECK (user_id <> blocked_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_feedback (
  id BIGINT UNSIGNED AUTO_INCREMENT COMMENT '反馈 ID' PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL COMMENT '提交反馈的用户 ID',
  body VARCHAR(2000) NOT NULL COMMENT '反馈正文',
  status ENUM('pending','resolved') NOT NULL DEFAULT 'pending' COMMENT '处理状态：待处理或已解决',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '反馈提交时间（UTC）',
  KEY ix_feedback_queue (status, created_at, id),
  FOREIGN KEY (user_id) REFERENCES users (id),
  CHECK (CHAR_LENGTH(TRIM(body)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO room_categories (code, name, sort_order) VALUES
  ('casual', '闲聊', 10), ('interest', '兴趣', 20), ('mbti', 'MBTI', 30);
