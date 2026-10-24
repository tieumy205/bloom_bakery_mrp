-- Bloom Bakery MRP - OFFICIAL standalone SQL for a NEW empty database.
-- Target: PostgreSQL 18. Source SHA-256: e04e15d95e6b16d1e05495b713534f434e3ab25e4da283baffbe93fcd8aeb941
-- Versioned BOM: each order line stores bom_id; at most one active BOM per product.
-- No snapshot/requirements/migration tables. No new triggers.
-- Backend owns issue-count/BOM-quantity validation, authorization, timeline and notifications.
-- Existing stock-posting triggers remain: API must NOT post the same stock movement twice.
-- Historical source rows are retained; unknown review/creation timestamps remain NULL.
-- PostgreSQL runtime verification is recorded separately in docs/database-official-test-results.json.
BEGIN;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE SCHEMA bakery_mrp;

CREATE FUNCTION bakery_mrp.guard_bom() RETURNS trigger
LANGUAGE plpgsql SET search_path=bakery_mrp,pg_temp AS $$
DECLARE selected_bom varchar; used boolean;
BEGIN
  selected_bom:=CASE WHEN TG_OP='DELETE' THEN OLD.bom_id ELSE NEW.bom_id END;
  IF TG_TABLE_NAME='bom' THEN
    IF TG_OP='UPDATE' AND (NEW.bom_id,NEW.product_id) IS DISTINCT FROM (OLD.bom_id,OLD.product_id) THEN
      RAISE EXCEPTION 'Không đổi mã BOM hoặc sản phẩm của phiên bản BOM';
    END IF;
  ELSE
    SELECT bom_id INTO STRICT selected_bom FROM bom WHERE bom_id=selected_bom FOR UPDATE;
    IF TG_OP='UPDATE' AND (NEW.bom_id,NEW.bom_detail_id) IS DISTINCT FROM (OLD.bom_id,OLD.bom_detail_id) THEN
      RAISE EXCEPTION 'Không chuyển chi tiết sang phiên bản BOM khác';
    END IF;
  END IF;
  SELECT EXISTS(SELECT 1 FROM production_order_details WHERE bom_id=selected_bom) INTO used;
  IF used THEN
    IF TG_TABLE_NAME='bom' AND TG_OP='UPDATE' THEN
      IF (to_jsonb(NEW)-'is_active') IS DISTINCT FROM (to_jsonb(OLD)-'is_active') THEN
        RAISE EXCEPTION 'BOM đã được sử dụng: giữ nguyên phiên bản, hãy tạo phiên bản mới';
      END IF;
    ELSE
      RAISE EXCEPTION 'Không sửa/xóa định mức của phiên bản BOM đã được sử dụng';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION bakery_mrp.guard_detail() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'bakery_mrp', 'pg_temp'
    AS $_$
DECLARE j JSONB; s TEXT; k TEXT;
BEGIN
 j:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 k:=j->>TG_ARGV[1];
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)->>TG_ARGV[1] IS DISTINCT FROM k
 OR to_jsonb(OLD)->>TG_ARGV[3] IS DISTINCT FROM j->>TG_ARGV[3])
 THEN RAISE EXCEPTION 'Không đổi mã chi tiết hoặc phiếu cha'; END IF;
 EXECUTE format('SELECT status FROM %I WHERE %I=$1 FOR UPDATE',TG_ARGV[0],TG_ARGV[1]) INTO s USING k;
 IF s IS NULL THEN RAISE EXCEPTION 'Không tìm thấy phiếu cha'; END IF;
 IF TG_ARGV[0]='production_orders' AND s='pending' AND EXISTS(
 SELECT 1 FROM material_issue_requests WHERE production_id=k AND status='approved')
 THEN RAISE EXCEPTION 'Đã xuất NVL: không đổi chi tiết kế hoạch'; END IF;
 IF TG_ARGV[0]='production_orders' AND s='pending' AND TG_OP<>'DELETE' AND (j->>'completed_quantity')::INTEGER<>0
 THEN RAISE EXCEPTION 'Chưa bắt đầu: completed_quantity phải bằng 0'; END IF;
 IF TG_ARGV[0]='production_orders' AND s='in_progress' AND TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'completed_quantity') IS DISTINCT FROM (to_jsonb(OLD)-'completed_quantity')
  THEN RAISE EXCEPTION 'Đang sản xuất: chỉ cập nhật completed_quantity'; END IF;
 ELSIF s<>TG_ARGV[2] THEN RAISE EXCEPTION 'Không sửa chi tiết phiếu ở trạng thái %',s;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $_$;

CREATE OR REPLACE FUNCTION bakery_mrp.guard_document() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'bakery_mrp', 'pg_temp'
AS $$
DECLARE 
  initial TEXT; 
  valid BOOLEAN;
BEGIN
  -- Xác định trạng thái khởi tạo
  initial := CASE 
               WHEN TG_TABLE_NAME = 'material_receipt_notes' THEN 'draft'
               ELSE 'pending'
             END;

  -- ===== INSERT =====
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> initial THEN 
      RAISE EXCEPTION 'Phải tạo chứng từ ở trạng thái %', initial; 
    END IF;

    IF TG_TABLE_NAME IN ('material_replenishment_requests', 'material_issue_requests', 'product_issue_requests') THEN
      IF NEW.approved_by IS NOT NULL 
         OR NEW.reviewed_at IS NOT NULL 
         OR NEW.rejection_reason IS NOT NULL THEN
        RAISE EXCEPTION 'Phiếu mới chưa được duyệt: không nhập thông tin xử lý';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- ===== DELETE =====
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> initial THEN 
      RAISE EXCEPTION 'Chỉ xóa chứng từ %', initial; 
    END IF;
    RETURN OLD;
  END IF;

  -- ===== Không cho sửa khi đã xử lý xong =====
  IF OLD.status IN ('completed', 'approved', 'rejected', 'fulfilled', 'cancelled')
     AND NOT (TG_TABLE_NAME = 'material_replenishment_requests' 
              AND OLD.status = 'approved' 
              AND NEW.status = 'fulfilled') THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN 
      RETURN NEW; 
    END IF;
    RAISE EXCEPTION 'Không sửa chứng từ đã xử lý: %', OLD.status;
  END IF;

  -- Không cho sửa nội dung khi đã approved (trừ chuyển fulfilled)
  IF TG_TABLE_NAME = 'material_replenishment_requests' 
     AND OLD.status = 'approved'
     AND (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'Không sửa nội dung yêu cầu đã duyệt';
  END IF;

  -- Chỉ được fulfilled sau khi có phiếu nhập completed
  IF TG_TABLE_NAME = 'material_replenishment_requests' 
     AND NEW.status = 'fulfilled' 
     AND OLD.status <> 'fulfilled'
     AND NOT EXISTS (
       SELECT 1 FROM material_receipt_notes 
       WHERE material_replenishment_request_id = (to_jsonb(NEW)->>'material_replenishment_request_id')
         AND status = 'completed'
     ) THEN
    RAISE EXCEPTION 'Chỉ fulfilled sau khi hoàn tất nhập kho';
  END IF;

  -- ===== Kiểm tra chuyển trạng thái hợp lệ =====
  IF TG_TABLE_NAME = 'production_orders' THEN
    valid := (OLD.status = NEW.status)
          OR (OLD.status = 'pending'     AND NEW.status IN ('in_progress', 'cancelled'))
          OR (OLD.status = 'in_progress' AND NEW.status = 'completed');

    IF OLD.status = 'in_progress' AND
       (NEW.created_by, NEW.assigned_to, NEW.note, NEW.created_at, NEW.production_order_id)
       IS DISTINCT FROM 
       (OLD.created_by, OLD.assigned_to, OLD.note, OLD.created_at, OLD.production_order_id) THEN
      RAISE EXCEPTION 'Không sửa thông tin lệnh đang sản xuất';
    END IF;

  ELSIF TG_TABLE_NAME = 'material_receipt_notes' THEN
    -- Bắt buộc draft → pending → completed (không được nhảy cóc)
    valid := (OLD.status = NEW.status)
          OR (OLD.status = 'draft'   AND NEW.status = 'pending')
          OR (OLD.status = 'pending' AND NEW.status = 'completed');

  ELSE
    -- Các phiếu còn lại (bổ sung, xuất NVL, xuất thành phẩm)
    valid := (OLD.status = NEW.status)
          OR (OLD.status = initial AND NEW.status IN ('approved', 'rejected'))
          OR (TG_TABLE_NAME = 'material_replenishment_requests' 
              AND OLD.status = 'approved' 
              AND NEW.status = 'fulfilled');
  END IF;

  IF NOT valid THEN 
    RAISE EXCEPTION 'Chuyển trạng thái không hợp lệ: % → %', OLD.status, NEW.status; 
  END IF;
 IF TG_TABLE_NAME = 'material_receipt_notes' AND OLD.status = 'pending' THEN
    IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.note IS DISTINCT FROM OLD.note THEN
      RAISE EXCEPTION 'Phiếu nhập đang chờ hoàn tất: không được sửa nhà cung cấp hoặc ghi chú';
    END IF;
  END IF;
  -- Không cho sửa mã chứng từ / người tạo / thời điểm tạo
  IF to_jsonb(NEW)->>TG_ARGV[0] IS DISTINCT FROM to_jsonb(OLD)->>TG_ARGV[0]
     OR NEW.created_at IS DISTINCT FROM OLD.created_at 
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Không sửa mã chứng từ/người tạo/thời điểm tạo';
  END IF;

  -- Xử lý duyệt / từ chối cho 3 loại phiếu
  IF TG_TABLE_NAME IN ('material_replenishment_requests', 'material_issue_requests', 'product_issue_requests') THEN
    IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
      IF NEW.approved_by IS NULL 
         OR NOT COALESCE(has_permission(NEW.approved_by, TG_TABLE_NAME,
              CASE WHEN NEW.status = 'approved' THEN 'approve' ELSE 'reject' END), false) THEN
        RAISE EXCEPTION 'Người xử lý không có quyền';
      END IF;

      NEW.reviewed_at := clock_timestamp();

      IF NEW.status = 'rejected' THEN
        NEW.rejection_reason := btrim(NEW.rejection_reason);
        IF NEW.rejection_reason IS NULL OR NEW.rejection_reason = '' THEN
          RAISE EXCEPTION 'Phải nhập lý do từ chối';
        END IF;
      ELSIF NEW.rejection_reason IS NOT NULL THEN
        RAISE EXCEPTION 'Phiếu được duyệt không có lý do từ chối';
      END IF;

    ELSIF NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
      RAISE EXCEPTION 'Chỉ cập nhật thông tin xử lý khi duyệt hoặc từ chối';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION bakery_mrp.handle_production() RETURNS trigger
LANGUAGE plpgsql SET search_path=bakery_mrp,pg_temp AS $$
DECLARE item record;
BEGIN
  IF OLD.status=NEW.status THEN RETURN NEW; END IF;
  IF NEW.status='cancelled' AND EXISTS(SELECT 1 FROM material_issue_requests WHERE production_id=NEW.production_order_id AND status='approved') THEN
    RAISE EXCEPTION 'Đã xuất NVL: phải xử lý hoàn trả trước khi hủy';
  END IF;
  IF NEW.status='in_progress' THEN
    IF NOT EXISTS(SELECT 1 FROM production_order_details WHERE production_order_id=NEW.production_order_id) THEN
      RAISE EXCEPTION 'Lệnh sản xuất chưa có chi tiết';
    END IF;
    -- An inactive historical version remains valid for the order that selected it.
    IF EXISTS(SELECT 1 FROM production_order_details d WHERE d.production_order_id=NEW.production_order_id
      AND NOT EXISTS(SELECT 1 FROM bom_details b WHERE b.bom_id=d.bom_id)) THEN
      RAISE EXCEPTION 'Phiên bản BOM của lệnh chưa có chi tiết';
    END IF;
    IF EXISTS(
      SELECT 1 FROM (
        SELECT b.material_id,sum(d.target_quantity*b.quantity) need
        FROM production_order_details d JOIN bom_details b ON b.bom_id=d.bom_id
        WHERE d.production_order_id=NEW.production_order_id GROUP BY b.material_id
      ) required LEFT JOIN (
        SELECT d.material_id,sum(d.request_quantity) issued
        FROM material_issue_requests h JOIN material_issue_request_details d USING(material_issue_request_id)
        WHERE h.production_id=NEW.production_order_id AND h.status='approved' GROUP BY d.material_id
      ) actual USING(material_id) WHERE coalesce(actual.issued,0)<required.need
    ) THEN RAISE EXCEPTION 'Chưa xuất đủ NVL theo phiên bản BOM của lệnh'; END IF;
  ELSIF NEW.status='completed' THEN
    IF NOT EXISTS(SELECT 1 FROM production_order_details WHERE production_order_id=NEW.production_order_id AND completed_quantity>0) THEN
      RAISE EXCEPTION 'Chưa có số lượng thành phẩm thực tế';
    END IF;
    FOR item IN SELECT * FROM production_order_details WHERE production_order_id=NEW.production_order_id AND completed_quantity>0 ORDER BY product_id LOOP
      PERFORM move_product(item.product_id,item.completed_quantity,NEW.production_order_id,'production_orders');
    END LOOP;
    NEW.completion_date:=clock_timestamp();
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION bakery_mrp.has_permission(p_user character varying, p_module text, p_action text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'bakery_mrp', 'pg_temp'
    AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN role_permissions rp USING(role_id)
 JOIN permissions p USING(permission_id) JOIN modules m USING(module_id)
 WHERE u.user_id=p_user AND u.is_active AND m.code=p_module AND p.action=p_action);
$$;

CREATE FUNCTION bakery_mrp.immutable_ledger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Không sửa/xóa nhật ký tồn kho'; END $$;

CREATE FUNCTION bakery_mrp.move_material(p_material varchar,p_delta numeric,p_record varchar,p_name text) RETURNS void
LANGUAGE plpgsql SET search_path=bakery_mrp,pg_temp AS $$
DECLARE balance numeric; delta numeric:=round(p_delta,6); day date:=(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
  SELECT stock_quantity INTO STRICT balance FROM materials WHERE material_id=p_material FOR UPDATE;
  IF delta IS NULL OR delta=0 OR balance+delta<0 THEN RAISE EXCEPTION 'Nguyên liệu %: tồn kho không đủ hoặc lượng thay đổi không hợp lệ',p_material; END IF;
  IF p_name='material_receipt_notes' THEN SELECT receipt_date INTO STRICT day FROM material_receipt_notes WHERE material_receipt_note_id=p_record; END IF;
  UPDATE materials SET stock_quantity=balance+delta WHERE material_id=p_material;
  INSERT INTO material_transactions(material_transaction_id,material_id,quantity_change,balance_before,balance_after,transaction_type,created_at,record_id,record_name,business_date)
  VALUES('MT'||nextval('transaction_number'),p_material,delta,balance,balance+delta,CASE WHEN delta>0 THEN 'receipt' ELSE 'issue' END,clock_timestamp(),p_record,p_name,day);
END $$;

CREATE FUNCTION bakery_mrp.move_product(p_product varchar,p_delta integer,p_record varchar,p_name text) RETURNS void
LANGUAGE plpgsql SET search_path=bakery_mrp,pg_temp AS $$
DECLARE balance integer;
BEGIN
  SELECT stock_quantity INTO STRICT balance FROM products WHERE product_id=p_product FOR UPDATE;
  IF p_delta IS NULL OR p_delta=0 OR balance+p_delta<0 THEN RAISE EXCEPTION 'Thành phẩm %: tồn kho không đủ hoặc lượng thay đổi không hợp lệ',p_product; END IF;
  UPDATE products SET stock_quantity=balance+p_delta WHERE product_id=p_product;
  INSERT INTO product_transactions(product_transaction_id,product_id,quantity_change,balance_before,balance_after,transaction_type,created_at,record_id,record_name,business_date)
  VALUES('PT'||nextval('transaction_number'),p_product,p_delta,balance,balance+p_delta,CASE WHEN p_delta>0 THEN 'receipt' ELSE 'issue' END,clock_timestamp(),p_record,p_name,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
END $$;

CREATE FUNCTION bakery_mrp.post_material_issue() RETURNS trigger
LANGUAGE plpgsql SET search_path=bakery_mrp,pg_temp AS $$
DECLARE state text; item record;
BEGIN
  IF NEW.status<>'approved' OR OLD.status=NEW.status THEN RETURN NEW; END IF;
  SELECT status INTO STRICT state FROM production_orders WHERE production_order_id=NEW.production_id FOR UPDATE;
  IF state<>'pending' THEN RAISE EXCEPTION 'Chỉ xuất NVL cho lệnh chưa bắt đầu'; END IF;
  IF NOT EXISTS(SELECT 1 FROM material_issue_request_details WHERE material_issue_request_id=NEW.material_issue_request_id) THEN
    RAISE EXCEPTION 'Yêu cầu xuất chưa có chi tiết';
  END IF;
  -- Backend enforces issue count, full BOM material set/quantities and ownership.
  -- This existing trigger only posts stock after a valid status transition.
  FOR item IN SELECT * FROM material_issue_request_details WHERE material_issue_request_id=NEW.material_issue_request_id ORDER BY material_id LOOP
    PERFORM move_material(item.material_id,-item.request_quantity,NEW.material_issue_request_id,'material_issue_requests');
  END LOOP;
  RETURN NEW;
END $$;

CREATE FUNCTION bakery_mrp.post_product_issue() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'bakery_mrp', 'pg_temp'
    AS $$
DECLARE d RECORD;
BEGIN
 IF NEW.status<>'approved' OR OLD.status=NEW.status THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM product_issue_request_details WHERE product_issue_request_id=NEW.product_issue_request_id)
 THEN RAISE EXCEPTION 'Yêu cầu xuất chưa có chi tiết'; END IF;
 FOR d IN SELECT * FROM product_issue_request_details WHERE product_issue_request_id=NEW.product_issue_request_id ORDER BY product_id LOOP
  PERFORM move_product(d.product_id,-d.request_quantity::INTEGER,NEW.product_issue_request_id,'product_issue_requests');
 END LOOP;
 RETURN NEW;
END $$;

CREATE FUNCTION bakery_mrp.post_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=bakery_mrp,pg_temp AS $$
DECLARE state text; item record;
BEGIN
  IF NEW.status<>'completed' OR OLD.status=NEW.status THEN RETURN NEW; END IF;
  SELECT status INTO STRICT state FROM material_replenishment_requests
  WHERE material_replenishment_request_id=NEW.material_replenishment_request_id FOR UPDATE;
  IF state<>'approved' THEN RAISE EXCEPTION 'Yêu cầu bổ sung chưa được duyệt'; END IF;
  IF NOT EXISTS(SELECT 1 FROM material_replenishment_request_details WHERE material_replenishment_request_id=NEW.material_replenishment_request_id) THEN
    RAISE EXCEPTION 'Yêu cầu bổ sung chưa có chi tiết';
  END IF;
  IF EXISTS(SELECT 1 FROM
    (SELECT material_id FROM material_replenishment_request_details WHERE material_replenishment_request_id=NEW.material_replenishment_request_id) requested
    FULL JOIN (SELECT material_id FROM material_receipt_note_details WHERE material_receipt_note_id=NEW.material_receipt_note_id) received USING(material_id)
    WHERE requested.material_id IS NULL OR received.material_id IS NULL
  ) THEN RAISE EXCEPTION 'Nguyên liệu nhập phải khớp phiếu bổ sung'; END IF;
  -- Quantity may differ from requested. Backend validates the current minimum under row locks.
  FOR item IN SELECT * FROM material_receipt_note_details WHERE material_receipt_note_id=NEW.material_receipt_note_id ORDER BY material_id LOOP
    PERFORM move_material(item.material_id,item.received_quantity,NEW.material_receipt_note_id,'material_receipt_notes');
  END LOOP;
  UPDATE material_replenishment_requests SET status='fulfilled' WHERE material_replenishment_request_id=NEW.material_replenishment_request_id;
  RETURN NEW;
END $$;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE bakery_mrp.bom (
    bom_id character varying(20) NOT NULL,
    product_id character varying(20) NOT NULL,
    version_code character varying(20) NOT NULL CHECK (btrim(version_code) <> ''),
    is_active boolean DEFAULT true NOT NULL,
    unit_id character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by character varying(20) NOT NULL
);

CREATE TABLE bakery_mrp.bom_details (
    bom_detail_id character varying(20) NOT NULL,
    bom_id character varying(20) NOT NULL,
    material_id character varying(20) NOT NULL,
    quantity numeric(16,6) NOT NULL,
    CONSTRAINT bom_details_quantity_check CHECK ((quantity > (0)::numeric))
);

CREATE TABLE bakery_mrp.material_issue_request_details (
    material_issue_request_detail_id character varying(20) CONSTRAINT material_issue_request_deta_material_issue_request_det_not_null NOT NULL,
    material_issue_request_id character varying(20) CONSTRAINT material_issue_request_detai_material_issue_request_id_not_null NOT NULL,
    material_id character varying(20) NOT NULL,
    material_requirement numeric(16,6) NOT NULL,
    request_quantity numeric(16,6) NOT NULL,
    CONSTRAINT material_issue_request_details_material_requirement_check CHECK ((material_requirement > (0)::numeric)),
    CONSTRAINT material_issue_request_details_request_quantity_check CHECK ((request_quantity > (0)::numeric))
);

CREATE TABLE bakery_mrp.material_issue_requests (
    material_issue_request_id character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by character varying(20) NOT NULL,
    approved_by character varying(20),
    reviewed_at timestamp with time zone,
    rejection_reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    production_id character varying(20) NOT NULL,
    note text,
    CONSTRAINT material_issue_requests_check CHECK (((status <> ALL (ARRAY['approved'::text, 'rejected'::text])) OR (approved_by IS NOT NULL))),
    CONSTRAINT material_issue_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

CREATE TABLE bakery_mrp.material_receipt_note_details (
    material_receipt_note_detail_id character varying(20) CONSTRAINT material_receipt_note_detai_material_receipt_note_deta_not_null NOT NULL,
    material_receipt_note_id character varying(20) NOT NULL,
    material_id character varying(20) NOT NULL,
    received_quantity numeric(16,6) NOT NULL,
    CONSTRAINT material_receipt_note_details_received_quantity_check CHECK ((received_quantity > (0)::numeric))
);

CREATE TABLE bakery_mrp.material_receipt_notes (
    material_receipt_note_id character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    receipt_date date NOT NULL,
    created_by character varying(20) NOT NULL,
    supplier_id character varying(20) NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    note text,
    material_replenishment_request_id character varying(20) CONSTRAINT material_receipt_notes_material_replenishment_request__not_null NOT NULL,
    CONSTRAINT material_receipt_notes_status_check CHECK ((status = ANY (ARRAY['draft'::text,'pending'::text, 'completed'::text])))
);

CREATE TABLE bakery_mrp.material_replenishment_request_details (
    replenishment_request_detail_id character varying(20) CONSTRAINT material_replenishment_requ_replenishment_request_deta_not_null NOT NULL,
    material_replenishment_request_id character varying(20) CONSTRAINT material_replenishment_req_material_replenishment_req_not_null1 NOT NULL,
    requirement_quantity numeric(16,6) CONSTRAINT material_replenishment_request_de_requirement_quantity_not_null NOT NULL,
    requested_quantity numeric(16,6) CONSTRAINT material_replenishment_request_deta_requested_quantity_not_null NOT NULL,
    material_id character varying(20) NOT NULL,
    CONSTRAINT material_replenishment_request_detai_requirement_quantity_check CHECK ((requirement_quantity >= (0)::numeric)),
    CONSTRAINT material_replenishment_request_details_requested_quantity_check CHECK ((requested_quantity > (0)::numeric))
);

CREATE TABLE bakery_mrp.material_replenishment_requests (
    material_replenishment_request_id character varying(20) CONSTRAINT material_replenishment_requ_material_replenishment_req_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by character varying(20) NOT NULL,
    approved_by character varying(20),
    reviewed_at timestamp with time zone,
    rejection_reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    request_type text NOT NULL,
    production_id character varying(20),
    note text,
    CONSTRAINT material_replenishment_requests_check CHECK (((status <> ALL (ARRAY['approved'::text, 'rejected'::text, 'fulfilled'::text])) OR (approved_by IS NOT NULL))),
    CONSTRAINT material_replenishment_requests_check1 CHECK ((((request_type = 'production'::text) AND (production_id IS NOT NULL)) OR ((request_type = 'minStock'::text) AND (production_id IS NULL)))),
    CONSTRAINT material_replenishment_requests_request_type_check CHECK ((request_type = ANY (ARRAY['production'::text, 'minStock'::text]))),
    CONSTRAINT material_replenishment_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'fulfilled'::text, 'rejected'::text])))
);

CREATE TABLE bakery_mrp.material_transactions (
    material_transaction_id character varying(20) NOT NULL,
    material_id character varying(20) NOT NULL,
    quantity_change numeric(16,6) NOT NULL,
    balance_before numeric(16,6) NOT NULL,
    balance_after numeric(16,6) NOT NULL,
    transaction_type text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    record_id character varying(20) NOT NULL,
    record_name character varying(50) NOT NULL,
    CONSTRAINT material_transactions_balance_after_check CHECK ((balance_after >= (0)::numeric)),
    CONSTRAINT material_transactions_balance_before_check CHECK ((balance_before >= (0)::numeric)),
    CONSTRAINT material_transactions_check CHECK ((balance_after = (balance_before + quantity_change))),
    CONSTRAINT material_transactions_check1 CHECK ((((transaction_type = 'receipt'::text) AND (quantity_change > (0)::numeric)) OR ((transaction_type = 'issue'::text) AND (quantity_change < (0)::numeric)))),
    CONSTRAINT material_transactions_quantity_change_check CHECK ((quantity_change <> (0)::numeric)),
    CONSTRAINT material_transactions_transaction_type_check CHECK ((transaction_type = ANY (ARRAY['receipt'::text, 'issue'::text]))),
    business_date date NOT NULL
);

CREATE TABLE bakery_mrp.materials (
    material_id character varying(20) NOT NULL,
    material_name character varying(100) NOT NULL,
    min_stock numeric(16,6) NOT NULL,
    stock_quantity numeric(16,6) DEFAULT 0 NOT NULL,
    unit_id character varying(20) NOT NULL,
    CONSTRAINT materials_min_stock_check CHECK ((min_stock >= (0)::numeric)),
    CONSTRAINT materials_stock_quantity_check CHECK ((stock_quantity >= (0)::numeric)),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bakery_mrp.modules (
    module_id character varying(20) NOT NULL,
    code character varying(60) NOT NULL,
    name character varying(100) NOT NULL
);

CREATE TABLE bakery_mrp.notifications (
    notification_id character varying(20) NOT NULL,
    user_id character varying(20) NOT NULL,
    message text NOT NULL,
    record_id character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    read_at timestamp with time zone,
    object_type text NOT NULL,
    CONSTRAINT notifications_object_type_check CHECK (object_type IN (
        'production_orders', 'material_replenishment_requests',
        'material_receipt_notes', 'material_issue_requests', 'product_issue_requests'
    ))
);

CREATE TABLE bakery_mrp.permissions (
    permission_id character varying(20) NOT NULL,
    module_id character varying(20) NOT NULL,
    action character varying(30) NOT NULL,
    description text
);

CREATE TABLE bakery_mrp.product_issue_request_details (
    product_issue_request_detail_id character varying(20) CONSTRAINT product_issue_request_detai_product_issue_request_deta_not_null NOT NULL,
    product_issue_request_id character varying(20) NOT NULL,
    product_id character varying(20) NOT NULL,
    request_quantity integer NOT NULL,
    CONSTRAINT product_issue_request_details_request_quantity_check CHECK ((request_quantity > 0))
);

CREATE TABLE bakery_mrp.product_issue_requests (
    product_issue_request_id character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by character varying(20) NOT NULL,
    approved_by character varying(20),
    reviewed_at timestamp with time zone,
    rejection_reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    note text,
    CONSTRAINT product_issue_requests_check CHECK (((status <> ALL (ARRAY['approved'::text, 'rejected'::text])) OR (approved_by IS NOT NULL))),
    CONSTRAINT product_issue_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

CREATE TABLE bakery_mrp.product_transactions (
    product_transaction_id character varying(20) NOT NULL,
    product_id character varying(20) NOT NULL,
    quantity_change integer NOT NULL,
    balance_before integer NOT NULL,
    balance_after integer NOT NULL,
    transaction_type text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    record_id character varying(20) NOT NULL,
    record_name character varying(50) NOT NULL,
    CONSTRAINT product_transactions_balance_after_check CHECK ((balance_after >= 0)),
    CONSTRAINT product_transactions_balance_before_check CHECK ((balance_before >= 0)),
    CONSTRAINT product_transactions_check CHECK ((balance_after = (balance_before + (quantity_change)))),
    CONSTRAINT product_transactions_check1 CHECK ((((transaction_type = 'receipt'::text) AND (quantity_change > 0)) OR ((transaction_type = 'issue'::text) AND (quantity_change < 0)))),
    CONSTRAINT product_transactions_quantity_change_check CHECK ((quantity_change <> 0)),
    CONSTRAINT product_transactions_transaction_type_check CHECK ((transaction_type = ANY (ARRAY['receipt'::text, 'issue'::text]))),
    business_date date NOT NULL
);

CREATE TABLE bakery_mrp.production_order_details (
    production_order_detail_id character varying(20) NOT NULL,
    production_order_id character varying(20) NOT NULL,
    product_id character varying(20) NOT NULL,
    bom_id character varying(20) NOT NULL,
    target_quantity integer NOT NULL,
    completed_quantity integer DEFAULT 0 NOT NULL,
    note text,
    CONSTRAINT production_order_details_check CHECK (((completed_quantity >= 0) AND (completed_quantity <= target_quantity))),
    CONSTRAINT production_order_details_target_quantity_check CHECK ((target_quantity > 0))
);

CREATE TABLE bakery_mrp.production_orders (
    production_order_id character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    due_date date,
    completion_date timestamp with time zone,
    created_by character varying(20) NOT NULL,
    assigned_to character varying(20) NOT NULL,
    note text,
    CONSTRAINT production_orders_check CHECK (((status <> 'completed'::text) OR (completion_date IS NOT NULL))),
    CONSTRAINT production_orders_check1 CHECK (((completion_date IS NULL) OR (completion_date >= created_at))),
    CONSTRAINT production_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text])))
);

CREATE TABLE bakery_mrp.products (
    product_id character varying(20) NOT NULL,
    product_name character varying(100) NOT NULL,
    image_url text,
    unit_id character varying(20) NOT NULL,
    stock_quantity integer DEFAULT 0 NOT NULL,
    CONSTRAINT products_stock_quantity_check CHECK ((stock_quantity >= 0)),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bakery_mrp.role_permissions (
    role_id character varying(20) NOT NULL,
    permission_id character varying(20) NOT NULL
);

CREATE TABLE bakery_mrp.roles (
    role_id character varying(20) NOT NULL,
    name character varying(20) NOT NULL,
    CONSTRAINT roles_name_check CHECK (((name)::text = ANY ((ARRAY['admin'::character varying, 'manager'::character varying, 'employee'::character varying])::text[])))
);

CREATE TABLE bakery_mrp.suppliers (
    supplier_id character varying(20) NOT NULL,
    supplier_name character varying(255) NOT NULL,
    phone_number character varying(15),
    address text,
    is_active boolean DEFAULT true NOT NULL
);

CREATE SEQUENCE bakery_mrp.transaction_number
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE bakery_mrp.units (
    unit_id character varying(20) NOT NULL,
    unit_name character varying(20) NOT NULL,
    symbol character varying(20) NOT NULL
);

CREATE TABLE bakery_mrp.users (
    user_id character varying(20) NOT NULL,
    username character varying(20) NOT NULL,
    password_hash text,
    phone_number character varying(15),
    email character varying(100),
    role_id character varying(20) NOT NULL,
    full_name character varying(100) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

SELECT pg_catalog.setval('bakery_mrp.transaction_number', 12, true);

INSERT INTO bakery_mrp.bom (bom_id, product_id, version_code, is_active, unit_id, created_at, created_by) VALUES
    ('BOM01', 'B01', '1.0', 't', 'CAI', '2026-10-07 12:57:18.40949+07', 'U02'),
    ('BOM02', 'B02', '1.0', 't', 'O', '2026-10-07 12:57:18.40949+07', 'U02'),
    ('BOM03', 'B03', '1.0', 't', 'CAI', '2026-10-07 12:57:18.40949+07', 'U02');

INSERT INTO bakery_mrp.bom_details (bom_detail_id, bom_id, material_id, quantity) VALUES
    ('BD01', 'BOM01', 'M01', '0.0800'),
    ('BD02', 'BOM01', 'M02', '0.0100'),
    ('BD03', 'BOM01', 'M03', '0.0200'),
    ('BD04', 'BOM01', 'M04', '0.0300'),
    ('BD05', 'BOM02', 'M01', '0.0400'),
    ('BD06', 'BOM02', 'M02', '0.0200'),
    ('BD07', 'BOM02', 'M03', '0.0200'),
    ('BD08', 'BOM02', 'M04', '0.0400'),
    ('BD09', 'BOM03', 'M01', '0.0600'),
    ('BD10', 'BOM03', 'M02', '0.0300'),
    ('BD11', 'BOM03', 'M03', '0.0200'),
    ('BD12', 'BOM03', 'M04', '0.0500');

INSERT INTO bakery_mrp.material_issue_request_details (material_issue_request_detail_id, material_issue_request_id, material_id, material_requirement, request_quantity) VALUES
    ('MID01', 'MI01', 'M01', '10.0000', '10.0000'),
    ('MID02', 'MI01', 'M02', '2.0000', '2.0000'),
    ('MID03', 'MI01', 'M03', '3.0000', '3.0000'),
    ('MID04', 'MI01', 'M04', '5.0000', '5.0000');

INSERT INTO bakery_mrp.material_issue_requests (material_issue_request_id, created_at, created_by, approved_by, status, production_id, note) VALUES
    ('MI01', '2026-10-07 12:57:18.40949+07', 'U03', 'U02', 'approved', 'PO01', NULL);

INSERT INTO bakery_mrp.material_receipt_note_details (material_receipt_note_detail_id, material_receipt_note_id, material_id, received_quantity) VALUES
    ('RND01', 'RN01', 'M01', '100.0000'),
    ('RND02', 'RN01', 'M02', '30.0000'),
    ('RND03', 'RN01', 'M03', '20.0000'),
    ('RND04', 'RN01', 'M04', '40.0000');

INSERT INTO bakery_mrp.material_receipt_notes (material_receipt_note_id, created_at, receipt_date, created_by, supplier_id, status, note, material_replenishment_request_id) VALUES
    ('RN01', '2026-10-07 12:57:18.40949+07', '2026-10-10', 'U02', 'S01', 'completed', NULL, 'MR01');

INSERT INTO bakery_mrp.material_replenishment_request_details (replenishment_request_detail_id, material_replenishment_request_id, requirement_quantity, requested_quantity, material_id) VALUES
    ('MRD01', 'MR01', '10.0000', '100.0000', 'M01'),
    ('MRD02', 'MR01', '2.0000', '30.0000', 'M02'),
    ('MRD03', 'MR01', '3.0000', '20.0000', 'M03'),
    ('MRD04', 'MR01', '5.0000', '40.0000', 'M04'),
    ('MRD05', 'MR02', '5.0000', '10.0000', 'M05');

INSERT INTO bakery_mrp.material_replenishment_requests (material_replenishment_request_id, created_at, created_by, approved_by, status, request_type, production_id, note) VALUES
    ('MR02', '2026-10-07 12:57:18.40949+07', 'U03', NULL, 'pending', 'minStock', NULL, 'Bổ sung cacao'),
    ('MR01', '2026-10-07 12:57:18.40949+07', 'U03', 'U02', 'fulfilled', 'production', 'PO01', 'Nhập cho sản xuất và dự trữ');

INSERT INTO bakery_mrp.material_transactions (material_transaction_id, material_id, quantity_change, balance_before, balance_after, transaction_type, created_at, record_id, record_name, business_date) VALUES
    ('MT1', 'M01', '100.0000', '0.0000', '100.0000', 'receipt', '2026-10-07 12:57:19.170019+07', 'RN01', 'material_receipt_notes', '2026-10-10'),
    ('MT2', 'M02', '30.0000', '0.0000', '30.0000', 'receipt', '2026-10-07 12:57:19.17755+07', 'RN01', 'material_receipt_notes', '2026-10-10'),
    ('MT3', 'M03', '20.0000', '0.0000', '20.0000', 'receipt', '2026-10-07 12:57:19.177989+07', 'RN01', 'material_receipt_notes', '2026-10-10'),
    ('MT4', 'M04', '40.0000', '0.0000', '40.0000', 'receipt', '2026-10-07 12:57:19.178226+07', 'RN01', 'material_receipt_notes', '2026-10-10'),
    ('MT5', 'M01', '-10.0000', '100.0000', '90.0000', 'issue', '2026-10-07 12:57:19.19479+07', 'MI01', 'material_issue_requests', '2026-10-07'),
    ('MT6', 'M02', '-2.0000', '30.0000', '28.0000', 'issue', '2026-10-07 12:57:19.196486+07', 'MI01', 'material_issue_requests', '2026-10-07'),
    ('MT7', 'M03', '-3.0000', '20.0000', '17.0000', 'issue', '2026-10-07 12:57:19.197916+07', 'MI01', 'material_issue_requests', '2026-10-07'),
    ('MT8', 'M04', '-5.0000', '40.0000', '35.0000', 'issue', '2026-10-07 12:57:19.199165+07', 'MI01', 'material_issue_requests', '2026-10-07');

INSERT INTO bakery_mrp.materials (material_id, material_name, min_stock, stock_quantity, unit_id, created_at) VALUES
    ('M05', 'Bột cacao', '5.0000', '0.0000', 'KG', NULL),
    ('M01', 'Bột mì', '20.0000', '90.0000', 'KG', NULL),
    ('M02', 'Đường', '10.0000', '28.0000', 'KG', NULL),
    ('M03', 'Bơ', '5.0000', '17.0000', 'KG', NULL),
    ('M04', 'Sữa', '10.0000', '35.0000', 'LIT', NULL);

INSERT INTO bakery_mrp.modules (module_id, code, name) VALUES
    ('MOD01', 'materials', 'Nguyên liệu'),
    ('MOD02', 'products', 'Thành phẩm'),
    ('MOD03', 'production_orders', 'Lệnh sản xuất'),
    ('MOD04', 'material_replenishment_requests', 'Bổ sung NVL'),
    ('MOD05', 'material_issue_requests', 'Xuất NVL'),
    ('MOD06', 'product_issue_requests', 'Xuất thành phẩm'),
    ('MOD07', 'statistics', 'Thống kê'),
    ('MOD08', 'material_receipt_notes', 'Nhập NVL'),
    ('MOD09', 'bom', 'Định mức'),
    ('MOD10', 'users', 'Tài khoản'),
    ('MOD11', 'access_control', 'Phân quyền');

-- notifications: no source seed rows.

INSERT INTO bakery_mrp.permissions (permission_id, module_id, action, description) VALUES
    ('P01_create', 'MOD01', 'create', 'Nguyên liệu: create'),
    ('P01_read', 'MOD01', 'read', 'Nguyên liệu: read'),
    ('P01_update', 'MOD01', 'update', 'Nguyên liệu: update'),
    ('P01_delete', 'MOD01', 'delete', 'Nguyên liệu: delete'),
    ('P02_create', 'MOD02', 'create', 'Thành phẩm: create'),
    ('P02_read', 'MOD02', 'read', 'Thành phẩm: read'),
    ('P02_update', 'MOD02', 'update', 'Thành phẩm: update'),
    ('P02_delete', 'MOD02', 'delete', 'Thành phẩm: delete'),
    ('P03_create', 'MOD03', 'create', 'Lệnh sản xuất: create'),
    ('P03_read', 'MOD03', 'read', 'Lệnh sản xuất: read'),
    ('P03_update', 'MOD03', 'update', 'Lệnh sản xuất: update'),
    ('P03_cancel', 'MOD03', 'cancel', 'Lệnh sản xuất: cancel'),
    ('P03_start', 'MOD03', 'start', 'Lệnh sản xuất: start'),
    ('P03_progress', 'MOD03', 'progress', 'Update actual production quantity'),
    ('P03_complete', 'MOD03', 'complete', 'Lệnh sản xuất: complete'),
    ('P04_read', 'MOD04', 'read', 'Bổ sung NVL: read'),
    ('P04_approve', 'MOD04', 'approve', 'Bổ sung NVL: approve'),
    ('P04_reject', 'MOD04', 'reject', 'Bổ sung NVL: reject'),
    ('P04_create', 'MOD04', 'create', 'Bổ sung NVL: create'),
    ('P04_update', 'MOD04', 'update', 'Bổ sung NVL: update'),
    ('P04_delete', 'MOD04', 'delete', 'Bổ sung NVL: delete'),
    ('P05_read', 'MOD05', 'read', 'Xuất NVL: read'),
    ('P05_approve', 'MOD05', 'approve', 'Xuất NVL: approve'),
    ('P05_reject', 'MOD05', 'reject', 'Xuất NVL: reject'),
    ('P05_create', 'MOD05', 'create', 'Xuất NVL: create'),
    ('P05_update', 'MOD05', 'update', 'Xuất NVL: update'),
    ('P05_delete', 'MOD05', 'delete', 'Xuất NVL: delete'),
    ('P06_read', 'MOD06', 'read', 'Xuất thành phẩm: read'),
    ('P06_approve', 'MOD06', 'approve', 'Xuất thành phẩm: approve'),
    ('P06_reject', 'MOD06', 'reject', 'Xuất thành phẩm: reject'),
    ('P06_create', 'MOD06', 'create', 'Xuất thành phẩm: create'),
    ('P06_update', 'MOD06', 'update', 'Xuất thành phẩm: update'),
    ('P06_delete', 'MOD06', 'delete', 'Xuất thành phẩm: delete'),
    ('P07_read', 'MOD07', 'read', 'Thống kê: read'),
    ('P08_create', 'MOD08', 'create', 'Nhập NVL: create'),
    ('P08_read', 'MOD08', 'read', 'Nhập NVL: read'),
    ('P08_update', 'MOD08', 'update', 'Nhập NVL: update'),
    ('P08_delete', 'MOD08', 'delete', 'Nhập NVL: delete'),
    ('P08_complete', 'MOD08', 'complete', 'Nhập NVL: complete'),
    ('P09_create', 'MOD09', 'create', 'Định mức: create'),
    ('P09_read', 'MOD09', 'read', 'Định mức: read'),
    ('P09_update', 'MOD09', 'update', 'Định mức: update'),
    ('P09_delete', 'MOD09', 'delete', 'Định mức: delete'),
    ('P10_create', 'MOD10', 'create', 'Tài khoản: create'),
    ('P10_read', 'MOD10', 'read', 'Tài khoản: read'),
    ('P10_update', 'MOD10', 'update', 'Tài khoản: update'),
    ('P10_delete', 'MOD10', 'delete', 'Tài khoản: delete'),
    ('P11_create', 'MOD11', 'create', 'Phân quyền: create'),
    ('P11_read', 'MOD11', 'read', 'Phân quyền: read'),
    ('P11_update', 'MOD11', 'update', 'Phân quyền: update'),
    ('P11_delete', 'MOD11', 'delete', 'Phân quyền: delete');

INSERT INTO bakery_mrp.product_issue_request_details (product_issue_request_detail_id, product_issue_request_id, product_id, request_quantity) VALUES
    ('PID01', 'PI01', 'B01', '10'),
    ('PID02', 'PI01', 'B02', '5');

INSERT INTO bakery_mrp.product_issue_requests (product_issue_request_id, created_at, created_by, approved_by, status, note) VALUES
    ('PI01', '2026-10-07 12:57:18.40949+07', 'U03', 'U02', 'approved', 'Xuất 10 bánh mì, 5 bánh quy');

INSERT INTO bakery_mrp.product_transactions (product_transaction_id, product_id, quantity_change, balance_before, balance_after, transaction_type, created_at, record_id, record_name, business_date) VALUES
    ('PT9', 'B01', '100', '100', '200', 'receipt', '2026-10-07 12:57:19.20699+07', 'PO01', 'production_orders', '2026-10-07'),
    ('PT10', 'B02', '50', '50', '100', 'receipt', '2026-10-07 12:57:19.213102+07', 'PO01', 'production_orders', '2026-10-07'),
    ('PT11', 'B01', '-10', '200', '190', 'issue', '2026-10-07 12:57:19.232832+07', 'PI01', 'product_issue_requests', '2026-10-07'),
    ('PT12', 'B02', '-5', '100', '95', 'issue', '2026-10-07 12:57:19.233081+07', 'PI01', 'product_issue_requests', '2026-10-07');

INSERT INTO bakery_mrp.production_order_details (production_order_detail_id, production_order_id, product_id, target_quantity, completed_quantity, note, bom_id) VALUES
    ('POD01', 'PO01', 'B01', '100', '100', NULL, 'BOM01'),
    ('POD02', 'PO01', 'B02', '50', '50', NULL, 'BOM02');

INSERT INTO bakery_mrp.production_orders (production_order_id, created_at, status, due_date, completion_date, created_by, assigned_to, note) VALUES
    ('PO01', '2026-10-07 12:57:18.40949+07', 'completed', '2026-10-08', '2026-10-07 14:57:19.213438+07', 'U02', 'U03', '100 bánh mì và 50 bánh quy');

INSERT INTO bakery_mrp.products (product_id, product_name, image_url, unit_id, stock_quantity, created_at) VALUES
    ('B03', 'Bánh chocolate', 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600&auto=format&fit=crop', 'CAI', '0', NULL),
    ('B01', 'Croissant bơ Pháp', 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&auto=format&fit=crop', 'CAI', '190', NULL),
    ('B02', 'Bánh mì sourdough', 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&auto=format&fit=crop', 'O', '95', NULL);

INSERT INTO bakery_mrp.role_permissions (role_id, permission_id) VALUES
    ('R02', 'P01_create'),
    ('R01', 'P01_read'),
    ('R02', 'P01_read'),
    ('R03', 'P01_read'),
    ('R02', 'P01_update'),
    ('R02', 'P01_delete'),
    ('R02', 'P02_create'),
    ('R01', 'P02_read'),
    ('R02', 'P02_read'),
    ('R03', 'P02_read'),
    ('R02', 'P02_update'),
    ('R02', 'P02_delete'),
    ('R02', 'P03_create'),
    ('R01', 'P03_read'),
    ('R02', 'P03_read'),
    ('R03', 'P03_read'),
    ('R02', 'P03_update'),
    ('R02', 'P03_cancel'),
    ('R03', 'P03_start'),
    ('R03', 'P03_progress'),
    ('R03', 'P03_complete'),
    ('R01', 'P04_read'),
    ('R02', 'P04_read'),
    ('R03', 'P04_read'),
    ('R02', 'P04_approve'),
    ('R02', 'P04_reject'),
    ('R03', 'P04_create'),
    ('R03', 'P04_update'),
    ('R03', 'P04_delete'),
    ('R01', 'P05_read'),
    ('R02', 'P05_read'),
    ('R03', 'P05_read'),
    ('R02', 'P05_approve'),
    ('R02', 'P05_reject'),
    ('R03', 'P05_create'),
    ('R03', 'P05_update'),
    ('R03', 'P05_delete'),
    ('R01', 'P06_read'),
    ('R02', 'P06_read'),
    ('R03', 'P06_read'),
    ('R02', 'P06_approve'),
    ('R02', 'P06_reject'),
    ('R03', 'P06_create'),
    ('R03', 'P06_update'),
    ('R03', 'P06_delete'),
    ('R01', 'P07_read'),
    ('R02', 'P07_read'),
    ('R02', 'P08_create'),
    ('R01', 'P08_read'),
    ('R02', 'P08_read'),
    ('R02', 'P08_update'),
    ('R02', 'P08_delete'),
    ('R02', 'P08_complete'),
    ('R01', 'P09_read'),
    ('R02', 'P09_read'),
    ('R02', 'P09_create'),
    ('R02', 'P09_update'),
    ('R02', 'P09_delete'),
    ('R01', 'P10_create'),
    ('R01', 'P10_read'),
    ('R01', 'P10_update'),
    ('R01', 'P10_delete'),
    ('R01', 'P11_create'),
    ('R01', 'P11_read'),
    ('R01', 'P11_update'),
    ('R01', 'P11_delete');

INSERT INTO bakery_mrp.roles (role_id, name) VALUES
    ('R01', 'admin'),
    ('R02', 'manager'),
    ('R03', 'employee');

INSERT INTO bakery_mrp.suppliers (supplier_id, supplier_name, phone_number, address, is_active) VALUES
    ('S01', 'Nguyên liệu An Phú', '0280000001', 'TP.HCM', 't'),
    ('S02', 'Sữa và bơ Minh Phát', '0280000002', 'An Giang', 't');

INSERT INTO bakery_mrp.units (unit_id, unit_name, symbol) VALUES
    ('KG', 'Kilôgam', 'kg'),
    ('CAI', 'Cái', 'cái'),
    ('O', 'Ổ', 'ổ'),
    ('LIT', 'Lít', 'lít');

INSERT INTO bakery_mrp.users (user_id, username, password_hash, phone_number, email, role_id, full_name, is_active, created_at) VALUES
    ('U01', 'admin', NULL, '0900000001', 'admin@gmail.com', 'R01', 'Hoàng Anh', 't', '2026-10-01 12:57:18.40949+07'),
    ('U02', 'manager', NULL, '0900000002', 'mii@gmail.com', 'R02', 'Diệp Tiểu My', 't', '2026-10-02 12:57:18.40949+07'),
    ('U03', 'employee', NULL, '0900000003', 'nam@gmail.com', 'R03', 'Lê Nam', 't', '2026-10-03 12:57:18.40949+07');

ALTER TABLE ONLY bakery_mrp.bom_details
    ADD CONSTRAINT bom_details_bom_id_material_id_key UNIQUE (bom_id, material_id);

ALTER TABLE ONLY bakery_mrp.bom_details
    ADD CONSTRAINT bom_details_pkey PRIMARY KEY (bom_detail_id);

ALTER TABLE ONLY bakery_mrp.bom
    ADD CONSTRAINT bom_pkey PRIMARY KEY (bom_id);

ALTER TABLE ONLY bakery_mrp.bom
    ADD CONSTRAINT bom_product_version_key UNIQUE (product_id, version_code);

ALTER TABLE ONLY bakery_mrp.bom
    ADD CONSTRAINT bom_id_product_id_key UNIQUE (bom_id, product_id);

ALTER TABLE ONLY bakery_mrp.material_issue_request_details
    ADD CONSTRAINT material_issue_request_detail_material_issue_request_id_mat_key UNIQUE (material_issue_request_id, material_id);

ALTER TABLE ONLY bakery_mrp.material_issue_request_details
    ADD CONSTRAINT material_issue_request_details_pkey PRIMARY KEY (material_issue_request_detail_id);

ALTER TABLE ONLY bakery_mrp.material_issue_requests
    ADD CONSTRAINT material_issue_requests_pkey PRIMARY KEY (material_issue_request_id);

ALTER TABLE ONLY bakery_mrp.material_receipt_note_details
    ADD CONSTRAINT material_receipt_note_details_material_receipt_note_id_mate_key UNIQUE (material_receipt_note_id, material_id);

ALTER TABLE ONLY bakery_mrp.material_receipt_note_details
    ADD CONSTRAINT material_receipt_note_details_pkey PRIMARY KEY (material_receipt_note_detail_id);

ALTER TABLE ONLY bakery_mrp.material_receipt_notes
    ADD CONSTRAINT material_receipt_notes_material_replenishment_request_id_key UNIQUE (material_replenishment_request_id);

ALTER TABLE ONLY bakery_mrp.material_receipt_notes
    ADD CONSTRAINT material_receipt_notes_pkey PRIMARY KEY (material_receipt_note_id);

ALTER TABLE ONLY bakery_mrp.material_replenishment_request_details
    ADD CONSTRAINT material_replenishment_reques_material_replenishment_reques_key UNIQUE (material_replenishment_request_id, material_id);

ALTER TABLE ONLY bakery_mrp.material_replenishment_request_details
    ADD CONSTRAINT material_replenishment_request_details_pkey PRIMARY KEY (replenishment_request_detail_id);

ALTER TABLE ONLY bakery_mrp.material_replenishment_requests
    ADD CONSTRAINT material_replenishment_requests_pkey PRIMARY KEY (material_replenishment_request_id);

ALTER TABLE ONLY bakery_mrp.material_transactions
    ADD CONSTRAINT material_transactions_material_id_record_id_record_name_tra_key UNIQUE (material_id, record_id, record_name, transaction_type);

ALTER TABLE ONLY bakery_mrp.material_transactions
    ADD CONSTRAINT material_transactions_pkey PRIMARY KEY (material_transaction_id);

ALTER TABLE ONLY bakery_mrp.materials
    ADD CONSTRAINT materials_pkey PRIMARY KEY (material_id);

ALTER TABLE ONLY bakery_mrp.modules
    ADD CONSTRAINT modules_code_key UNIQUE (code);

ALTER TABLE ONLY bakery_mrp.modules
    ADD CONSTRAINT modules_pkey PRIMARY KEY (module_id);

ALTER TABLE ONLY bakery_mrp.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (notification_id);

ALTER TABLE ONLY bakery_mrp.permissions
    ADD CONSTRAINT permissions_module_id_action_key UNIQUE (module_id, action);

ALTER TABLE ONLY bakery_mrp.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (permission_id);

ALTER TABLE ONLY bakery_mrp.product_issue_request_details
    ADD CONSTRAINT product_issue_request_details_pkey PRIMARY KEY (product_issue_request_detail_id);

ALTER TABLE ONLY bakery_mrp.product_issue_request_details
    ADD CONSTRAINT product_issue_request_details_product_issue_request_id_prod_key UNIQUE (product_issue_request_id, product_id);

ALTER TABLE ONLY bakery_mrp.product_issue_requests
    ADD CONSTRAINT product_issue_requests_pkey PRIMARY KEY (product_issue_request_id);

ALTER TABLE ONLY bakery_mrp.product_transactions
    ADD CONSTRAINT product_transactions_pkey PRIMARY KEY (product_transaction_id);

ALTER TABLE ONLY bakery_mrp.product_transactions
    ADD CONSTRAINT product_transactions_product_id_record_id_record_name_trans_key UNIQUE (product_id, record_id, record_name, transaction_type);

ALTER TABLE ONLY bakery_mrp.production_order_details
    ADD CONSTRAINT production_order_details_pkey PRIMARY KEY (production_order_detail_id);

ALTER TABLE ONLY bakery_mrp.production_order_details
    ADD CONSTRAINT production_order_details_production_order_id_product_id_key UNIQUE (production_order_id, product_id);

ALTER TABLE ONLY bakery_mrp.production_orders
    ADD CONSTRAINT production_orders_pkey PRIMARY KEY (production_order_id);

ALTER TABLE ONLY bakery_mrp.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (product_id);

ALTER TABLE ONLY bakery_mrp.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);

ALTER TABLE ONLY bakery_mrp.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);

ALTER TABLE ONLY bakery_mrp.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (role_id);

ALTER TABLE ONLY bakery_mrp.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (supplier_id);

ALTER TABLE ONLY bakery_mrp.units
    ADD CONSTRAINT units_pkey PRIMARY KEY (unit_id);

ALTER TABLE ONLY bakery_mrp.units
    ADD CONSTRAINT units_symbol_key UNIQUE (symbol);

ALTER TABLE ONLY bakery_mrp.units
    ADD CONSTRAINT units_unit_name_key UNIQUE (unit_name);

ALTER TABLE ONLY bakery_mrp.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY bakery_mrp.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY bakery_mrp.users
    ADD CONSTRAINT users_username_key UNIQUE (username);

CREATE INDEX idx_bom_created_by ON bakery_mrp.bom USING btree (created_by);

CREATE UNIQUE INDEX idx_active_bom ON bakery_mrp.bom (product_id) WHERE is_active = true;

CREATE INDEX idx_bom_details_bom_id ON bakery_mrp.bom_details USING btree (bom_id);

CREATE INDEX idx_bom_details_material_id ON bakery_mrp.bom_details USING btree (material_id);

CREATE INDEX idx_bom_product_id ON bakery_mrp.bom USING btree (product_id);

CREATE INDEX idx_bom_unit_id ON bakery_mrp.bom USING btree (unit_id);

CREATE INDEX idx_material_issue_request_details_material_id ON bakery_mrp.material_issue_request_details USING btree (material_id);

CREATE INDEX idx_material_issue_request_details_material_issue_request_id ON bakery_mrp.material_issue_request_details USING btree (material_issue_request_id);

CREATE INDEX idx_material_issue_requests_approved_by ON bakery_mrp.material_issue_requests USING btree (approved_by);

CREATE INDEX idx_material_issue_requests_created_by ON bakery_mrp.material_issue_requests USING btree (created_by);

CREATE INDEX idx_material_issue_requests_production_id ON bakery_mrp.material_issue_requests USING btree (production_id);

CREATE INDEX idx_material_receipt_note_details_material_id ON bakery_mrp.material_receipt_note_details USING btree (material_id);

CREATE INDEX idx_material_receipt_note_details_material_receipt_note_id ON bakery_mrp.material_receipt_note_details USING btree (material_receipt_note_id);

CREATE INDEX idx_material_receipt_notes_created_by ON bakery_mrp.material_receipt_notes USING btree (created_by);

CREATE INDEX idx_material_receipt_notes_material_replenishment_request_id ON bakery_mrp.material_receipt_notes USING btree (material_replenishment_request_id);

CREATE INDEX idx_material_receipt_notes_supplier_id ON bakery_mrp.material_receipt_notes USING btree (supplier_id);

CREATE INDEX idx_material_replenishment_request_details_material_id ON bakery_mrp.material_replenishment_request_details USING btree (material_id);

CREATE INDEX idx_material_replenishment_request_details_material_replenishme ON bakery_mrp.material_replenishment_request_details USING btree (material_replenishment_request_id);

CREATE INDEX idx_material_replenishment_requests_approved_by ON bakery_mrp.material_replenishment_requests USING btree (approved_by);

CREATE INDEX idx_material_replenishment_requests_created_by ON bakery_mrp.material_replenishment_requests USING btree (created_by);

CREATE INDEX idx_material_replenishment_requests_production_id ON bakery_mrp.material_replenishment_requests USING btree (production_id);

CREATE INDEX idx_material_transactions_material_id ON bakery_mrp.material_transactions USING btree (material_id);

CREATE INDEX idx_materials_unit_id ON bakery_mrp.materials USING btree (unit_id);

CREATE INDEX idx_notifications_user_created ON bakery_mrp.notifications USING btree (user_id, created_at);

CREATE INDEX idx_product_issue_request_details_product_id ON bakery_mrp.product_issue_request_details USING btree (product_id);

CREATE INDEX idx_product_issue_request_details_product_issue_request_id ON bakery_mrp.product_issue_request_details USING btree (product_issue_request_id);

CREATE INDEX idx_product_issue_requests_approved_by ON bakery_mrp.product_issue_requests USING btree (approved_by);

CREATE INDEX idx_product_issue_requests_created_by ON bakery_mrp.product_issue_requests USING btree (created_by);

CREATE INDEX idx_product_transactions_product_id ON bakery_mrp.product_transactions USING btree (product_id);

CREATE INDEX idx_production_order_details_product_id ON bakery_mrp.production_order_details USING btree (product_id);

CREATE INDEX idx_production_order_details_production_order_id ON bakery_mrp.production_order_details USING btree (production_order_id);

CREATE INDEX idx_production_orders_assigned_to ON bakery_mrp.production_orders USING btree (assigned_to);

CREATE INDEX idx_production_orders_created_by ON bakery_mrp.production_orders USING btree (created_by);

CREATE INDEX idx_products_unit_id ON bakery_mrp.products USING btree (unit_id);

CREATE INDEX idx_role_permissions_permission_id ON bakery_mrp.role_permissions USING btree (permission_id);

CREATE INDEX idx_role_permissions_role_id ON bakery_mrp.role_permissions USING btree (role_id);

CREATE INDEX idx_users_role_id ON bakery_mrp.users USING btree (role_id);

CREATE TRIGGER detail_mi BEFORE INSERT OR DELETE OR UPDATE ON bakery_mrp.material_issue_request_details FOR EACH ROW EXECUTE FUNCTION bakery_mrp.guard_detail('material_issue_requests', 'material_issue_request_id', 'pending', 'material_issue_request_detail_id');

CREATE TRIGGER detail_mr BEFORE INSERT OR DELETE OR UPDATE ON bakery_mrp.material_replenishment_request_details FOR EACH ROW EXECUTE FUNCTION bakery_mrp.guard_detail('material_replenishment_requests', 'material_replenishment_request_id', 'pending', 'replenishment_request_detail_id');

CREATE TRIGGER detail_pi BEFORE INSERT OR DELETE OR UPDATE ON bakery_mrp.product_issue_request_details FOR EACH ROW EXECUTE FUNCTION bakery_mrp.guard_detail('product_issue_requests', 'product_issue_request_id', 'pending', 'product_issue_request_detail_id');

CREATE TRIGGER detail_po BEFORE INSERT OR DELETE OR UPDATE ON bakery_mrp.production_order_details FOR EACH ROW EXECUTE FUNCTION bakery_mrp.guard_detail('production_orders', 'production_order_id', 'pending', 'production_order_detail_id');

CREATE TRIGGER detail_rn BEFORE INSERT OR DELETE OR UPDATE ON bakery_mrp.material_receipt_note_details FOR EACH ROW EXECUTE FUNCTION bakery_mrp.guard_detail('material_receipt_notes', 'material_receipt_note_id', 'draft', 'material_receipt_note_detail_id');

CREATE TRIGGER guard_mi BEFORE INSERT OR DELETE OR UPDATE ON bakery_mrp.material_issue_requests FOR EACH ROW EXECUTE FUNCTION bakery_mrp.guard_document('material_issue_request_id');

CREATE TRIGGER guard_mr BEFORE INSERT OR DELETE OR UPDATE ON bakery_mrp.material_replenishment_requests FOR EACH ROW EXECUTE FUNCTION bakery_mrp.guard_document('material_replenishment_request_id');

CREATE TRIGGER guard_pi BEFORE INSERT OR DELETE OR UPDATE ON bakery_mrp.product_issue_requests FOR EACH ROW EXECUTE FUNCTION bakery_mrp.guard_document('product_issue_request_id');

CREATE TRIGGER guard_po BEFORE INSERT OR DELETE OR UPDATE ON bakery_mrp.production_orders FOR EACH ROW EXECUTE FUNCTION bakery_mrp.guard_document('production_order_id');

CREATE TRIGGER guard_rn BEFORE INSERT OR DELETE OR UPDATE ON bakery_mrp.material_receipt_notes FOR EACH ROW EXECUTE FUNCTION bakery_mrp.guard_document('material_receipt_note_id');

CREATE TRIGGER immutable_mt BEFORE DELETE OR UPDATE ON bakery_mrp.material_transactions FOR EACH ROW EXECUTE FUNCTION bakery_mrp.immutable_ledger();

CREATE TRIGGER immutable_pt BEFORE DELETE OR UPDATE ON bakery_mrp.product_transactions FOR EACH ROW EXECUTE FUNCTION bakery_mrp.immutable_ledger();

CREATE TRIGGER post_mi AFTER UPDATE OF status ON bakery_mrp.material_issue_requests FOR EACH ROW EXECUTE FUNCTION bakery_mrp.post_material_issue();

CREATE TRIGGER post_pi AFTER UPDATE OF status ON bakery_mrp.product_issue_requests FOR EACH ROW EXECUTE FUNCTION bakery_mrp.post_product_issue();

CREATE TRIGGER post_rn AFTER UPDATE OF status ON bakery_mrp.material_receipt_notes FOR EACH ROW EXECUTE FUNCTION bakery_mrp.post_receipt();

CREATE TRIGGER production_flow BEFORE UPDATE OF status ON bakery_mrp.production_orders FOR EACH ROW EXECUTE FUNCTION bakery_mrp.handle_production();

CREATE TRIGGER protect_bom BEFORE INSERT OR DELETE OR UPDATE ON bakery_mrp.bom FOR EACH ROW EXECUTE FUNCTION bakery_mrp.guard_bom();

CREATE TRIGGER protect_bom_detail BEFORE INSERT OR DELETE OR UPDATE ON bakery_mrp.bom_details FOR EACH ROW EXECUTE FUNCTION bakery_mrp.guard_bom();

ALTER TABLE ONLY bakery_mrp.bom
    ADD CONSTRAINT bom_created_by_fkey FOREIGN KEY (created_by) REFERENCES bakery_mrp.users(user_id);

ALTER TABLE ONLY bakery_mrp.bom_details
    ADD CONSTRAINT bom_details_bom_id_fkey FOREIGN KEY (bom_id) REFERENCES bakery_mrp.bom(bom_id);

ALTER TABLE ONLY bakery_mrp.bom_details
    ADD CONSTRAINT bom_details_material_id_fkey FOREIGN KEY (material_id) REFERENCES bakery_mrp.materials(material_id);

ALTER TABLE ONLY bakery_mrp.bom
    ADD CONSTRAINT bom_product_id_fkey FOREIGN KEY (product_id) REFERENCES bakery_mrp.products(product_id);

ALTER TABLE ONLY bakery_mrp.bom
    ADD CONSTRAINT bom_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES bakery_mrp.units(unit_id);

ALTER TABLE ONLY bakery_mrp.material_issue_request_details
    ADD CONSTRAINT material_issue_request_details_material_id_fkey FOREIGN KEY (material_id) REFERENCES bakery_mrp.materials(material_id);

ALTER TABLE ONLY bakery_mrp.material_issue_request_details
    ADD CONSTRAINT material_issue_request_details_material_issue_request_id_fkey FOREIGN KEY (material_issue_request_id) REFERENCES bakery_mrp.material_issue_requests(material_issue_request_id);

ALTER TABLE ONLY bakery_mrp.material_issue_requests
    ADD CONSTRAINT material_issue_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES bakery_mrp.users(user_id);

ALTER TABLE ONLY bakery_mrp.material_issue_requests
    ADD CONSTRAINT material_issue_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES bakery_mrp.users(user_id);

ALTER TABLE ONLY bakery_mrp.material_issue_requests
    ADD CONSTRAINT material_issue_requests_production_id_fkey FOREIGN KEY (production_id) REFERENCES bakery_mrp.production_orders(production_order_id);

ALTER TABLE ONLY bakery_mrp.material_receipt_note_details
    ADD CONSTRAINT material_receipt_note_details_material_id_fkey FOREIGN KEY (material_id) REFERENCES bakery_mrp.materials(material_id);

ALTER TABLE ONLY bakery_mrp.material_receipt_note_details
    ADD CONSTRAINT material_receipt_note_details_material_receipt_note_id_fkey FOREIGN KEY (material_receipt_note_id) REFERENCES bakery_mrp.material_receipt_notes(material_receipt_note_id);

ALTER TABLE ONLY bakery_mrp.material_receipt_notes
    ADD CONSTRAINT material_receipt_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES bakery_mrp.users(user_id);

ALTER TABLE ONLY bakery_mrp.material_receipt_notes
    ADD CONSTRAINT material_receipt_notes_material_replenishment_request_id_fkey FOREIGN KEY (material_replenishment_request_id) REFERENCES bakery_mrp.material_replenishment_requests(material_replenishment_request_id);

ALTER TABLE ONLY bakery_mrp.material_receipt_notes
    ADD CONSTRAINT material_receipt_notes_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES bakery_mrp.suppliers(supplier_id);

ALTER TABLE ONLY bakery_mrp.material_replenishment_request_details
    ADD CONSTRAINT material_replenishment_reques_material_replenishment_reque_fkey FOREIGN KEY (material_replenishment_request_id) REFERENCES bakery_mrp.material_replenishment_requests(material_replenishment_request_id);

ALTER TABLE ONLY bakery_mrp.material_replenishment_request_details
    ADD CONSTRAINT material_replenishment_request_details_material_id_fkey FOREIGN KEY (material_id) REFERENCES bakery_mrp.materials(material_id);

ALTER TABLE ONLY bakery_mrp.material_replenishment_requests
    ADD CONSTRAINT material_replenishment_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES bakery_mrp.users(user_id);

ALTER TABLE ONLY bakery_mrp.material_replenishment_requests
    ADD CONSTRAINT material_replenishment_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES bakery_mrp.users(user_id);

ALTER TABLE ONLY bakery_mrp.material_replenishment_requests
    ADD CONSTRAINT material_replenishment_requests_production_id_fkey FOREIGN KEY (production_id) REFERENCES bakery_mrp.production_orders(production_order_id);

ALTER TABLE ONLY bakery_mrp.material_transactions
    ADD CONSTRAINT material_transactions_material_id_fkey FOREIGN KEY (material_id) REFERENCES bakery_mrp.materials(material_id);

ALTER TABLE ONLY bakery_mrp.materials
    ADD CONSTRAINT materials_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES bakery_mrp.units(unit_id);

ALTER TABLE ONLY bakery_mrp.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES bakery_mrp.users(user_id);

ALTER TABLE ONLY bakery_mrp.permissions
    ADD CONSTRAINT permissions_module_id_fkey FOREIGN KEY (module_id) REFERENCES bakery_mrp.modules(module_id);

ALTER TABLE ONLY bakery_mrp.product_issue_request_details
    ADD CONSTRAINT product_issue_request_details_product_id_fkey FOREIGN KEY (product_id) REFERENCES bakery_mrp.products(product_id);

ALTER TABLE ONLY bakery_mrp.product_issue_request_details
    ADD CONSTRAINT product_issue_request_details_product_issue_request_id_fkey FOREIGN KEY (product_issue_request_id) REFERENCES bakery_mrp.product_issue_requests(product_issue_request_id);

ALTER TABLE ONLY bakery_mrp.product_issue_requests
    ADD CONSTRAINT product_issue_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES bakery_mrp.users(user_id);

ALTER TABLE ONLY bakery_mrp.product_issue_requests
    ADD CONSTRAINT product_issue_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES bakery_mrp.users(user_id);

ALTER TABLE ONLY bakery_mrp.product_transactions
    ADD CONSTRAINT product_transactions_product_id_fkey FOREIGN KEY (product_id) REFERENCES bakery_mrp.products(product_id);

ALTER TABLE ONLY bakery_mrp.production_order_details
    ADD CONSTRAINT production_order_details_product_id_fkey FOREIGN KEY (product_id) REFERENCES bakery_mrp.products(product_id);

ALTER TABLE ONLY bakery_mrp.production_order_details
    ADD CONSTRAINT production_order_details_production_order_id_fkey FOREIGN KEY (production_order_id) REFERENCES bakery_mrp.production_orders(production_order_id);

ALTER TABLE ONLY bakery_mrp.production_orders
    ADD CONSTRAINT production_orders_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES bakery_mrp.users(user_id);

ALTER TABLE ONLY bakery_mrp.production_orders
    ADD CONSTRAINT production_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES bakery_mrp.users(user_id);

ALTER TABLE ONLY bakery_mrp.products
    ADD CONSTRAINT products_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES bakery_mrp.units(unit_id);

ALTER TABLE ONLY bakery_mrp.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES bakery_mrp.permissions(permission_id);

ALTER TABLE ONLY bakery_mrp.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES bakery_mrp.roles(role_id);

ALTER TABLE ONLY bakery_mrp.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES bakery_mrp.roles(role_id);

CREATE INDEX notifications_user_unread_idx
    ON bakery_mrp.notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_object_idx
    ON bakery_mrp.notifications (object_type, record_id);
COMMENT ON COLUMN bakery_mrp.material_replenishment_requests.reviewed_at IS 'Thời điểm duyệt hoặc từ chối; lịch sử không xác định có thể NULL';
COMMENT ON COLUMN bakery_mrp.material_replenishment_requests.rejection_reason IS 'Lý do từ chối; bắt buộc khi từ chối phiếu mới';
COMMENT ON COLUMN bakery_mrp.material_issue_requests.reviewed_at IS 'Thời điểm duyệt hoặc từ chối; lịch sử không xác định có thể NULL';
COMMENT ON COLUMN bakery_mrp.material_issue_requests.rejection_reason IS 'Lý do từ chối; bắt buộc khi từ chối phiếu mới';
COMMENT ON COLUMN bakery_mrp.product_issue_requests.reviewed_at IS 'Thời điểm duyệt hoặc từ chối; lịch sử không xác định có thể NULL';
COMMENT ON COLUMN bakery_mrp.product_issue_requests.rejection_reason IS 'Lý do từ chối; bắt buộc khi từ chối phiếu mới';
COMMENT ON COLUMN bakery_mrp.notifications.object_type IS 'Loại chứng từ đích; backend kiểm tra record_id và tạo thông báo';

-- Each production line pins one immutable BOM version of the SAME product.
ALTER TABLE ONLY bakery_mrp.production_order_details
    ADD CONSTRAINT production_order_details_bom_product_fkey
    FOREIGN KEY (bom_id, product_id) REFERENCES bakery_mrp.bom(bom_id, product_id);
CREATE INDEX idx_production_order_details_bom_id ON bakery_mrp.production_order_details(bom_id);

CREATE TABLE bakery_mrp.business_events (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    object_type text NOT NULL CHECK (object_type IN ('production_orders','material_replenishment_requests','material_receipt_notes','material_issue_requests','product_issue_requests')),
    object_id varchar(20) NOT NULL,
    action text NOT NULL CHECK (btrim(action)<>''),
    from_status text,
    to_status text,
    actor_user_id varchar(20) NOT NULL REFERENCES bakery_mrp.users(user_id),
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object')
);
CREATE INDEX business_events_object_idx ON bakery_mrp.business_events(object_type,object_id,event_id);
CREATE INDEX business_events_actor_idx ON bakery_mrp.business_events(actor_user_id,occurred_at);
COMMENT ON TABLE bakery_mrp.business_events IS 'Backend ghi timeline cùng transaction; không tự tạo sự kiện lịch sử hoặc trigger mới';
COMMENT ON COLUMN bakery_mrp.bom.version_code IS 'Phiên bản bất biến khi đã được lệnh tham chiếu; tạo phiên bản mới để thay định mức';
COMMENT ON COLUMN bakery_mrp.bom.is_active IS 'Chỉ chọn mặc định cho lệnh mới; ngừng hoạt động không thay BOM đã gắn trên lệnh cũ';
COMMENT ON COLUMN bakery_mrp.production_order_details.bom_id IS 'BOM version của dòng lệnh; dữ liệu nguồn được gắn theo BOM duy nhất của sản phẩm tại lúc chuyển đổi, không khẳng định lịch sử phiên bản đã mất';
COMMENT ON COLUMN bakery_mrp.material_receipt_notes.receipt_date IS 'Ngày nhập hàng; Backend kiểm ngày tương lai và khóa khi pending';
COMMENT ON COLUMN bakery_mrp.material_transactions.business_date IS 'Ngày nghiệp vụ dùng báo cáo; balance_before/after theo thứ tự ghi sổ';
COMMENT ON COLUMN bakery_mrp.product_transactions.business_date IS 'Ngày nghiệp vụ tại Việt Nam; balance_before/after theo thứ tự ghi sổ';
COMMENT ON TABLE bakery_mrp.material_issue_requests IS 'Quy tắc số lần xuất và đủ toàn bộ BOM do Backend kiểm tra, không có unique index/trigger cho quy tắc một lần';

SET check_function_bodies = true;
COMMIT;
