-- Backend extension. No schema_migrations, snapshot or material issue count constraint.
BEGIN;
SET LOCAL search_path=bakery_mrp,pg_temp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS user_permissions (
 user_id varchar(20) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 permission_id varchar(20) NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
 is_allowed boolean NOT NULL,
 updated_by varchar(20) REFERENCES users(user_id),
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,permission_id)
);
CREATE TABLE IF NOT EXISTS api_request_keys (
 user_id varchar(20) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 request_key varchar(100) NOT NULL,
 request_hash char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,request_key)
);
INSERT INTO modules(module_id,code,name) VALUES('M_DASH','dashboard','Tổng quan'),('M_NOTIFY','notifications','Thông báo') ON CONFLICT(code) DO NOTHING;
INSERT INTO permissions(permission_id,module_id,action,description)
 SELECT 'dashboard.read',module_id,'read','Xem tổng quan' FROM modules WHERE code='dashboard' ON CONFLICT DO NOTHING;
INSERT INTO permissions(permission_id,module_id,action,description)
 SELECT 'notifications.read',module_id,'read','Xem thông báo của mình' FROM modules WHERE code='notifications' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) VALUES('R02','dashboard.read'),('R02','notifications.read'),('R03','notifications.read') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION has_permission(p_user varchar,p_module text,p_action text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=bakery_mrp,pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM users u JOIN permissions p ON true JOIN modules m USING(module_id)
  LEFT JOIN user_permissions up ON up.user_id=u.user_id AND up.permission_id=p.permission_id
  WHERE u.user_id=p_user AND u.is_active AND m.code=p_module AND p.action=p_action
  AND EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=u.role_id AND rp.permission_id=p.permission_id)
  AND coalesce(up.is_allowed,true)
 );
$$;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_key ON users(lower(btrim(email))) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS material_transactions_business_idx ON material_transactions(material_id,business_date);
CREATE INDEX IF NOT EXISTS product_transactions_business_idx ON product_transactions(product_id,business_date);
COMMIT;
